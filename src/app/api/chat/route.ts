import { NextResponse } from "next/server";
import { z } from "zod";
import { detectLanguageInfo, type SupportedLanguage } from "@/lib/language";
import { ollamaChat, ollamaChatStream, type OllamaMessage } from "@/lib/ollama";
import { openaiCompatChat, openaiCompatChatStream } from "@/lib/openaiCompat";
import { parsePrescription, recommendFromInputs } from "@/lib/recommendation";
import { formatCatalogContextForPrompt, searchCatalog } from "@/lib/catalogSearch";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

// Chat endpoint responsibilities:
// - Accept a list of client-side messages (and optional chatId/messageId for regeneration)
// - Detect language (FR/EN/AR/DZ) and enforce a language rule in the system prompt
// - Parse prescription and derive a simple lens recommendation
// - Retrieve compact catalog context from DB (price/stock only if explicitly asked)
// - Call the LLM (Ollama by default; OpenAI-compatible if configured)
// - Persist user/assistant messages + maintain a lightweight summary and memory

const MessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1),
});

const ChatRequestSchema = z.object({
  chatId: z.string().min(1).optional(),
  userMessageId: z.string().min(1).optional(),
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional(),
  clientRequestId: z.string().optional(),
});

function safeRole(role: string): "user" | "assistant" | "system" {
  if (role === "user" || role === "assistant" || role === "system") return role;
  return "user";
}

function compactTitleFromUserText(text: string): string {
  const cleaned = text
    .replace(/\s+/g, " ")
    .replace(/[\r\n]+/g, " ")
    .trim();
  if (!cleaned) return "Nouveau chat";
  const words = cleaned.split(" ").slice(0, 7).join(" ");
  return words.length > 80 ? `${words.slice(0, 77)}...` : words;
}

function appendToSummary(prev: string | null | undefined, user: string, assistant: string): string {
  const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 280);
  const next = [
    prev?.trim() ? prev.trim() : "",
    `U: ${clip(user)}`,
    `A: ${clip(assistant)}`,
  ]
    .filter(Boolean)
    .join("\n");
  // Keep the summary bounded.
  return next.length > 2000 ? next.slice(next.length - 2000) : next;
}

function buildSummaryFromMessages(pairs: Array<{ role: "user" | "assistant"; content: string }>): string {
  let summary = "";
  for (let i = 0; i < pairs.length; i += 2) {
    const u = pairs[i];
    const a = pairs[i + 1];
    if (!u || u.role !== "user" || !a || a.role !== "assistant") continue;
    summary = appendToSummary(summary, u.content, a.content);
  }
  return summary.trim() ? summary : "";
}

async function upsertMemory(params: {
  scope: string;
  key: string;
  value: string;
}) {
  await prisma.chatMemory.upsert({
    where: { scope_key: { scope: params.scope, key: params.key } },
    create: { scope: params.scope, key: params.key, value: params.value },
    update: { value: params.value },
    select: { id: true },
  });
}

async function getMemoryText(params: { chatId: string }): Promise<string> {
  const items: Array<{ scope: string; key: string; value: string }> = await prisma.chatMemory.findMany({
    where: { scope: { in: ["global", `chat:${params.chatId}`] } },
    orderBy: { updatedAt: "desc" },
    select: { scope: true, key: true, value: true },
    take: 25,
  });

  if (items.length === 0) return "(none)";
  return items
    .map((m: { scope: string; key: string; value: string }) => `- [${m.scope}] ${m.key}: ${m.value}`)
    .join("\n");
}

function getCommercialIntent(text: string): { price: boolean; availability: boolean } {
  // FR/EN/AR signals.
  const price =
    /(\bprix\b|\btarif\b|\bcombien\b|\bco[uû]t\b|\bprice\b|\bcost\b|\bhow\s*much\b|سعر|ثمن|بكم)/i.test(
      text,
    );

  const availability =
    /(\bavailable\b|\bavailability\b|\bdisponible\b|\bdisponibilit[eé]\b|\ben stock\b|\bstock\b|\bquantit[eé]\b|\bquantity\b|\bin store\b|\bin\s+shop\b|متوفر|موجود|التوفر|\bالمحل\b|\bفي\s*المحل\b)/i.test(
      text,
    );

  return { price, availability };
}

function isGreetingLike(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // If the message is very short and mostly a greeting, don't let it flip the chat language.
  const lowered = t.toLowerCase().replace(/[^a-z\p{Script=Arabic}\s]/gu, " ").replace(/\s+/g, " ").trim();
  if (lowered.length > 18) return false;
  return /^(hi|hello|hey|salut|bonjour|bonsoir|salam|salam alaykoum|assalam|assalamu alaykum|السلام عليكم|مرحبا)$/iu.test(
    lowered,
  );
}

function detectExplicitLanguageRequest(text: string): SupportedLanguage | null {
  const t = text.toLowerCase();

  // Arabic requests (French/English/Arabic phrasing)
  if (
    /(\ben\s+arabe\b|\barabe\s+svp\b|\barabic\b|\bin\s+arabic\b|\barabic\s+please\b)/i.test(text) ||
    /(بالعربية|باللغة\s*العربية|عربي)/i.test(text)
  ) {
    return "ar";
  }

  // French requests
  if (/(\ben\s+fran[cç]ais\b|\bfran[cç]ais\s+svp\b|\bin\s+french\b|\bfrench\s+please\b)/i.test(text)) {
    return "fr";
  }

  // English requests
  if (/(\ben\s+anglais\b|\benglish\b|\bin\s+english\b|\benglish\s+please\b)/i.test(text)) {
    return "en";
  }

  // Darija requests
  if (/(\bdarija\b|\bdarja\b|\bderja\b|\bبالدارجة\b)/i.test(text)) {
    return "dz";
  }

  // Avoid unused var warning in some TS setups.
  void t;
  return null;
}

type AvailabilityQuestionType = "availability" | "quantity";

function getAvailabilityQuestionType(text: string): AvailabilityQuestionType | null {
  const t = text.trim();
  if (!t) return null;

  const isQuestionLike = (() => {
    if (/[?؟]/.test(t)) return true;
    // Interrogative phrasing in FR/EN/AR (common in chats without a question mark too).
    if (/(\best-?ce\s+que\b|\bavez-?vous\b|\bvous\s+avez\b|\bdo\s+you\s+have\b|\bis\s+it\b|\bare\s+they\b|\bhow\s+many\b|\bcan\s+you\b|\bهل\b)/i.test(t)) {
      return true;
    }
    // Very short messages like "stock", "en stock", "disponible" are usually questions.
    const short = t.toLowerCase().replace(/\s+/g, " ").trim();
    if (short.length <= 20 && /(\bstock\b|\ben\s+stock\b|\bdisponible\b|\bavailability\b|\bavailable\b|متوفر|موجود)/i.test(short)) {
      return true;
    }
    return false;
  })();

  if (!isQuestionLike) return null;

  // If it's clearly a price question (especially in Arabic), don't treat it as quantity/stock.
  if (/(سعر|ثمن|بكم)/i.test(t)) return null;

  const quantity =
    /(\bquantit[eé]\b|\bquantity\b|\bcombien\b.*\b(avez|as|a|ont)\b|\bcombien\s+en\s+stock\b|\bhow\s+many\b|\bqty\b|\bqte\b|\bch7al\b|\bchhal\b|كم\s*(?:عندكم|لديكم)|الكمية|كمية|كم\s*\(?الكمية\)?)/i.test(
      t,
    );
  if (quantity) return "quantity";

  const availability =
    /(\bavailable\b|\bavailability\b|\bdisponible\b|\bdisponibilit[eé]\b|\ben stock\b|\bstock\b|\bin store\b|\bin\s+shop\b|متوفر|موجود|التوفر|\bالمحل\b|\bفي\s*المحل\b)/i.test(
      t,
    );
  return availability ? "availability" : null;
}

function formatHitLabel(h: { brand: string; family?: string | null; index: number }): string {
  return `${h.brand}${h.family ? " " + h.family : ""} ${h.index.toFixed(2)}`;
}

function buildAvailabilityAnswer(params: {
  lang: SupportedLanguage;
  userText: string;
  hits: Array<{ brand: string; family?: string | null; index: number; sku: string; inventory: { quantity: number } | null }>;
  type: AvailabilityQuestionType;
}): string {
  const { lang, userText, hits, type } = params;

  const wantZeiss = /zeiss/i.test(userText);
  const preferred = wantZeiss ? hits.filter((h) => h.brand.toLowerCase() === "zeiss") : hits;
  const list = (preferred.length > 0 ? preferred : hits).slice(0, 3);

  if (hits.length === 0) {
    if (lang === "ar") {
      return "حالياً ما لقيتش نفس المنتج في قاعدة البيانات، وما نقدرش نأكد الستوك. إذا تعطيني المرجع/SKU ولا اسم العائلة بالضبط نتحقق لك.";
    }
    if (lang === "dz") {
      return "دروك ما لقيتش نفس المنتوج فالداتا، ما نقدرش نأكد الستوك. عطيني المرجع/SKU ولا الاسم بالضبط ونشوف لك.";
    }
    if (lang === "en") {
      return "I couldn't find that exact product in the database, so I can't confirm the current stock. If you share the SKU/reference, I can check again.";
    }
    return "Je ne retrouve pas ce produit précisément dans la base, donc je ne peux pas confirmer le stock actuel. Donne-moi la référence/SKU (ou le nom exact) et je vérifie.";
  }

  const lines = list.map((h) => {
    const qty = h.inventory?.quantity;
    const qtyText = Number.isFinite(qty) ? String(qty) : "N/A";
    return { label: formatHitLabel(h), sku: h.sku, qty: qty ?? null, qtyText };
  });

  // If user asks "is it available?" and we have one clear best match, answer directly.
  const top = lines[0];
  const topQty = top?.qty;

  if (lang === "ar") {
    if (type === "quantity") {
      if (lines.length === 1) {
        return `حسب قاعدة البيانات: الكمية الحالية لـ ${top.label} (SKU: ${top.sku}) هي ${top.qtyText}.`;
      }
      return [
        "حسب قاعدة البيانات، هاذي الكميات الحالية (أفضل نتائج):",
        ...lines.map((l) => `- ${l.label} (SKU: ${l.sku}): ${l.qtyText}`),
      ].join("\n");
    }

    if (typeof topQty === "number") {
      return topQty > 0
        ? `نعم، متوفر حالياً. الستوك لـ ${top.label} (SKU: ${top.sku}) هو ${topQty}.`
        : `حالياً غير متوفر (الستوك 0) لـ ${top.label} (SKU: ${top.sku}).`;
    }

    return [
      "ما عنديش رقم ستوك واضح لهذا المنتج في قاعدة البيانات.",
      ...lines.map((l) => `- ${l.label} (SKU: ${l.sku}): ${l.qtyText}`),
    ].join("\n");
  }

  if (lang === "dz") {
    if (type === "quantity") {
      if (lines.length === 1) {
        return `حسب الداتا: الكمية تاع ${top.label} (SKU: ${top.sku}) هي ${top.qtyText}.`;
      }
      return [
        "حسب الداتا، هذو الكميات (أفضل نتائج):",
        ...lines.map((l) => `- ${l.label} (SKU: ${l.sku}): ${l.qtyText}`),
      ].join("\n");
    }

    if (typeof topQty === "number") {
      return topQty > 0
        ? `ايه متوفر دروك. الستوك تاع ${top.label} (SKU: ${top.sku}) هو ${topQty}.`
        : `دروك راهو ماشي متوفر (ستوك 0) تاع ${top.label} (SKU: ${top.sku}).`;
    }

    return [
      "ماكانش رقم ستوك واضح فالداتا لهذا المنتوج.",
      ...lines.map((l) => `- ${l.label} (SKU: ${l.sku}): ${l.qtyText}`),
    ].join("\n");
  }

  if (lang === "en") {
    if (type === "quantity") {
      if (lines.length === 1) {
        return `According to the database: current quantity for ${top.label} (SKU: ${top.sku}) is ${top.qtyText}.`;
      }
      return [
        "According to the database, here are the current quantities (best matches):",
        ...lines.map((l) => `- ${l.label} (SKU: ${l.sku}): ${l.qtyText}`),
      ].join("\n");
    }

    if (typeof topQty === "number") {
      return topQty > 0
        ? `Yes, it's currently available. Stock for ${top.label} (SKU: ${top.sku}) is ${topQty}.`
        : `Not available right now (stock 0) for ${top.label} (SKU: ${top.sku}).`;
    }

    return [
      "I don't have a clear stock number for that item in the database.",
      ...lines.map((l) => `- ${l.label} (SKU: ${l.sku}): ${l.qtyText}`),
    ].join("\n");
  }

  // fr
  if (type === "quantity") {
    if (lines.length === 1) {
      return `D’après la base de données : la quantité actuelle pour ${top.label} (SKU : ${top.sku}) est ${top.qtyText}.`;
    }
    return [
      "D’après la base de données, voici les quantités actuelles (meilleurs résultats) :",
      ...lines.map((l) => `- ${l.label} (SKU : ${l.sku}) : ${l.qtyText}`),
    ].join("\n");
  }

  if (typeof topQty === "number") {
    return topQty > 0
      ? `Oui, c’est disponible actuellement. Stock pour ${top.label} (SKU : ${top.sku}) : ${topQty}.`
      : `Pas disponible pour le moment (stock 0) pour ${top.label} (SKU : ${top.sku}).`;
  }

  return [
    "Je n’ai pas un chiffre de stock clair dans la base pour cet article.",
    ...lines.map((l) => `- ${l.label} (SKU : ${l.sku}) : ${l.qtyText}`),
  ].join("\n");
}

function sanitizeAssistantChunk(text: string): string {
  // Streaming-safe sanitization: remove template artifacts without altering whitespace.
  return text
    .replace(/<\|im_start\|>/g, "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|assistant\|>/g, "")
    .replace(/<\|user\|>/g, "")
    .replace(/<\|system\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .replace(/\u0000/g, "")
    .replace(/\r/g, "");
}

function filterDisallowedScriptsByLanguage(text: string, lang: SupportedLanguage): string {
  // Defense-in-depth: models sometimes leak other scripts (Cyrillic/CJK/etc.) despite the prompt.
  // We keep ASCII/Latin for SKUs, numbers and units.
  const remove = (re: RegExp) => text.replace(re, "");

  switch (lang) {
    case "ar":
      // Arabic + Latin allowed; strip Cyrillic and CJK/Hangul.
      return remove(/[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
    case "dz":
      // Darija may be Arabic script or Latin; same filtering as Arabic.
      return remove(/[\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
    case "fr":
    case "en":
    default:
      // Latin only; strip Arabic, Cyrillic and CJK/Hangul.
      return remove(/[\p{Script=Arabic}\p{Script=Cyrillic}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu);
  }
}

function normalizeWhitespaceAfterFiltering(text: string): string {
  return text
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
}

function postProcessAssistantText(text: string, lang: SupportedLanguage): string {
  const cleaned = sanitizeAssistantChunk(text);
  const filtered = filterDisallowedScriptsByLanguage(cleaned, lang);
  return normalizeWhitespaceAfterFiltering(filtered).trim();
}

function postProcessAssistantChunk(text: string, lang: SupportedLanguage): string {
  // Streaming chunks must preserve leading/trailing whitespace; otherwise words get glued across chunks.
  const cleaned = sanitizeAssistantChunk(text);
  const filtered = filterDisallowedScriptsByLanguage(cleaned, lang);
  return normalizeWhitespaceAfterFiltering(filtered);
}

function makeSystemPrompt(lang: SupportedLanguage, ctx: {
  catalogContext: string;
  recommendation: ReturnType<typeof recommendFromInputs>;
  prescriptionText?: string;
  priceRangeText?: string;
  includePrice: boolean;
  includeAvailability: boolean;
}): string {
  // Keep context limited and domain-focused.
  // We inject only compact catalog lines + our rules.
  const languageInstruction =
    lang === "ar"
      ? "LANGUAGE RULE (highest priority): أجب بالعربية فقط، وبنفس أسلوب المستخدم. لا تُجب بالإنجليزية أو الفرنسية."
      : lang === "dz"
        ? "LANGUAGE RULE (highest priority): جاوب بالدارجة الجزائرية (Latin ولا عربية حسب سؤال الزبون). ما تبدلش للإنجليزية/الفرنسية إلا إذا طلبها."
        : lang === "en"
          ? "LANGUAGE RULE (highest priority): Answer in English only. Do not answer in French or Arabic."
          : "LANGUAGE RULE (priorité absolue): Réponds en français uniquement. Ne réponds pas en anglais ou en arabe.";

  const noLanguageRefusalRule =
    lang === "ar"
      ? "قاعدة مهمة: لا تقل أبدًا أنك لا تستطيع الرد باللغة العربية. أنت مساعد متعدد اللغات وتستطيع الرد بالعربية بشكل طبيعي."
      : lang === "dz"
        ? "قاعدة مهمة: ما تقولش بلي ما تقدرش تجاوب بالدارجة/العربية/الفرنسية/الإنجليزية. جاوب عادي وبنفس لغة المستخدم."
        : lang === "en"
          ? "Important: Never claim you can't answer in a language. You are multilingual; answer normally in the requested language."
          : "Important : Ne dis jamais que tu ne peux pas répondre dans une langue. Tu es multilingue ; réponds normalement dans la langue demandée.";

  return [
    "You are OptiLens, a multilingual optical-lens sales assistant for an optician.",
    "Your job: help customers choose optical lenses and coatings.",
    "Formatting: Reply in Markdown. Use short headings (#/##), bullet lists (- or +), and **bold** for key recommendations. Use newlines for readability. Do not use HTML.",
    "If you use an ordered list, write explicit numbering like 1., 2., 3. (do not repeat 1.).",
    "Never output internal model tokens such as <|im_start|>, <|im_end|>, <|assistant|>, <|user|>, or similar artifacts.",
    "Important: Do NOT mention prices unless the user explicitly asks for price.",
    "Important: Do NOT mention stock/availability unless the user explicitly asks if it is available / in stock / in store.",
    "If the user explicitly asks for a specific language (e.g., 'en arabe svp', 'in English please'), comply and answer in that language only.",
    "When the user asks availability in the store/shop (e.g., 'disponible ?', 'en stock ?', 'في المحل؟', 'متوفر؟'), answer using ONLY the catalog context stock. If stock=0, say it is not available right now.",
    "If catalog context contains stock=NUMBER for a product, do NOT say 'unknown' or 'not in the database' for stock; use that NUMBER.",
    "When the user asks price (e.g., 'prix ?', 'combien ?', 'سعر؟'), answer using ONLY the catalog context price.",
    "If the user asks for price/availability and it is not in the catalog context, say you don't have it in the database.",
    "Never invent brands, SKUs, prices, availability, or stock.",
    "Never claim 'blue light protection' unless the selected product has blueCut=yes OR coatings include BLUECUT in CATALOG_CONTEXT.",
    "Keep conversation context limited: only use the last user message + the provided catalog context + the provided recommendation notes.",
    "When a prescription is present (SPH/CYL), give a recommendation: index (1.5/1.56/1.6/1.67/1.74) + coatings.",
    "Always recommend antireflective (AR) and typically hard coat + hydrophobic unless the user refuses.",
    "Explain photochromic technology when asked: activation by UV, temperature impact, indoor clear, car windshield limitation, and 'optimized for car' variants.",
    "Support these coatings: AR (antireflet), BLUECUT, PHOTO (photochromique), HARD (durci), HYDRO (hydrophobe).",
    "If user is outside optical lenses domain, politely say you can only help with optical lenses.",
    languageInstruction,
    noLanguageRefusalRule,
    "",
    "CATALOG_CONTEXT (compact lines):",
    ctx.catalogContext,
    "",
    "RECOMMENDATION_NOTES:",
    `- Recommended index: ${ctx.recommendation.recommendedIndex ?? "(unknown)"}`,
    `- Desired coatings codes: ${ctx.recommendation.coatings.join(", ")}`,
    ...ctx.recommendation.rationale.map((r) => `- ${r}`),
    ctx.prescriptionText ? `- Prescription parsed from text: ${ctx.prescriptionText}` : "",
    ctx.includePrice && ctx.priceRangeText ? "PRICE_RANGE_IN_DB:" : "",
    ctx.includePrice && ctx.priceRangeText ? ctx.priceRangeText : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(req: Request) {
  try {
    const json = await req.json();
    const body = ChatRequestSchema.parse(json);

    const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
    const fallbackUserText = lastUser?.content ?? "";

    // Ensure we have a chat session.
    let chatId = body.chatId;
    let existingUserMessageId: string | undefined;
    let userText = fallbackUserText;

    if (body.userMessageId) {
      if (!chatId) {
        return NextResponse.json(
          { error: "chatId est requis quand userMessageId est fourni." },
          { status: 400 },
        );
      }

      const existing = await prisma.chatMessage.findUnique({
        where: { id: body.userMessageId },
        select: { id: true, chatId: true, role: true, content: true },
      });

      if (!existing || existing.chatId !== chatId || existing.role !== "user") {
        return NextResponse.json(
          { error: "Message user introuvable pour ce chat." },
          { status: 404 },
        );
      }

      existingUserMessageId = existing.id;
      userText = existing.content;
    }

    // Prefer the chat's stored language when detection is ambiguous.
    const detection = detectLanguageInfo(userText);
    let storedLang: SupportedLanguage | null = null;
    if (body.chatId) {
      const existingSession = await prisma.chatSession.findUnique({
        where: { id: body.chatId },
        select: { language: true },
      });
      storedLang = (existingSession?.language as SupportedLanguage | null) ?? null;
    }

    const explicitLang = detectExplicitLanguageRequest(userText);
    const lang: SupportedLanguage = explicitLang
      ? explicitLang
      : storedLang && (detection.confidence === "low" || isGreetingLike(userText))
        ? storedLang
        : detection.lang;

    // Parse prescription from last user message (simple, can be expanded).
    const prescription = parsePrescription(userText);
    const recommendation = recommendFromInputs({ prescription, needs: [] });

    const availabilityQuestionType = getAvailabilityQuestionType(userText);

    const intent = getCommercialIntent(userText);
    const includeAvailability = intent.availability || availabilityQuestionType !== null;
    const includePrice = intent.price && availabilityQuestionType !== "quantity";

    const hits = await searchCatalog({ userText, recommendation, limit: 6 });

    const catalogContext = formatCatalogContextForPrompt(hits, {
      includePrice,
      includeAvailability,
    });

    let priceRangeText: string | undefined;
    if (includePrice) {
      const priceAgg = await prisma.inventoryItem.aggregate({
        where: { isActive: true },
        _min: { priceCents: true, currency: true },
        _max: { priceCents: true, currency: true },
      });

      const min = priceAgg._min.priceCents ?? null;
      const max = priceAgg._max.priceCents ?? null;
      const currency = priceAgg._min.currency ?? priceAgg._max.currency ?? "DZD";
      priceRangeText =
        min !== null && max !== null
          ? `basic≈${Math.round(min / 100)} ${currency} | premium≈${Math.round(max / 100)} ${currency} (d’après la DB)`
          : "(Aucune donnée prix active dans la DB)";
    }

    // Ensure we have a chat session.
    if (!chatId) {
      const created = await prisma.chatSession.create({
        data: {
          title: compactTitleFromUserText(userText),
          language: lang,
        },
        select: { id: true },
      });
      chatId = created.id;
    }

    if (!chatId) {
      throw new Error("chatId is missing after chat session creation");
    }

    const chatScope = `chat:${chatId}`;

    // Persist the user's message (unless regenerating an existing stored message).
    let userMessageId = existingUserMessageId;
    if (!userMessageId) {
      const createdUser = await prisma.chatMessage.create({
        data: {
          chatId,
          role: "user",
          content: userText,
        },
        select: { id: true },
      });
      userMessageId = createdUser.id;
    }

    if (!userMessageId) {
      throw new Error("userMessageId is missing after user message persistence");
    }

    // Deterministic handling for stock/quantity questions to avoid hallucinations.
    // This answers ONLY from DB hits and respects the detected/stored language.
    if (availabilityQuestionType) {
      const deterministic = buildAvailabilityAnswer({
        lang,
        userText,
        hits: hits.map((h) => ({
          brand: h.brand,
          family: h.family,
          index: h.index,
          sku: h.sku,
          inventory: h.inventory ? { quantity: h.inventory.quantity } : null,
        })),
        type: availabilityQuestionType,
      });

      const answer = postProcessAssistantText(deterministic, lang);

      if (body.stream) {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            controller.enqueue(encoder.encode(answer));
            controller.close();

            await prisma.chatMessage.create({
              data: {
                chatId,
                role: "assistant",
                content: answer,
              },
              select: { id: true },
            });

            const lastForSummary = await prisma.chatMessage.findMany({
              where: { chatId },
              orderBy: { createdAt: "asc" },
              select: { role: true, content: true },
              take: 20,
            });
            const summaryPairs: Array<{ role: "user" | "assistant"; content: string }> = lastForSummary
              .filter((m: { role: string; content: string }) => m.role === "user" || m.role === "assistant")
              .map((m: { role: string; content: string }) => ({
                role: safeRole(m.role) as "user" | "assistant",
                content: m.content,
              }));

            const rebuiltSummary = buildSummaryFromMessages(summaryPairs);
            await prisma.chatSession.update({
              where: { id: chatId },
              data: { language: lang, summary: rebuiltSummary || null },
              select: { id: true },
            });
          },
        });

        const headers = new Headers({
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        });
        headers.set("X-Chat-Id", chatId);
        headers.set("X-User-Message-Id", userMessageId);
        return new Response(stream, { status: 200, headers });
      }

      await prisma.chatMessage.create({
        data: {
          chatId,
          role: "assistant",
          content: answer,
        },
        select: { id: true },
      });

      const lastForSummary = await prisma.chatMessage.findMany({
        where: { chatId },
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
        take: 20,
      });
      const summaryPairs: Array<{ role: "user" | "assistant"; content: string }> = lastForSummary
        .filter((m: { role: string; content: string }) => m.role === "user" || m.role === "assistant")
        .map((m: { role: string; content: string }) => ({
          role: safeRole(m.role) as "user" | "assistant",
          content: m.content,
        }));

      const rebuiltSummary = buildSummaryFromMessages(summaryPairs);
      await prisma.chatSession.update({
        where: { id: chatId },
        data: { language: lang, summary: rebuiltSummary || null },
        select: { id: true },
      });

      return NextResponse.json({ chatId, userMessageId, language: lang, answer, catalogHits: hits, recommendation });
    }

    // Update lightweight memory from deterministic signals.
    await upsertMemory({ scope: "global", key: "lastLanguage", value: lang });
    if (prescription) {
      await upsertMemory({
        scope: chatScope,
        key: "prescription",
        value: JSON.stringify(prescription),
      });
    }

    const system = makeSystemPrompt(lang, {
      catalogContext,
      recommendation,
      prescriptionText: prescription ? JSON.stringify(prescription) : undefined,
      priceRangeText,
      includePrice,
      includeAvailability,
    });

    // Load last messages from DB for continuity.
    const recent: Array<{ role: string; content: string }> = await prisma.chatMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
      take: 14,
    });

    const memoryText = await getMemoryText({ chatId });

    const systemWithMemory = [
      system,
      "",
      "MEMORY (facts/preferences; do not invent):",
      memoryText,
      "",
      "Use the chat history below to stay consistent with the previous conversation.",
    ].join("\n");

    const history: OllamaMessage[] = recent
      .filter((m: { role: string }) => m.role !== "system")
      .map((m: { role: string; content: string }) => ({ role: safeRole(m.role), content: m.content }) satisfies OllamaMessage)
      .slice(-12);

    const llmMessages: OllamaMessage[] = [{ role: "system", content: systemWithMemory }, ...history];

    const llmProvider = (process.env.LLM_PROVIDER ?? "ollama").toLowerCase();
    const useOpenAICompat = llmProvider === "openai-compat" || llmProvider === "openai_compat";
    const temperature = 0.2;

    if (body.stream) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          let full = "";
          try {
            const gen = useOpenAICompat
              ? openaiCompatChatStream({ messages: llmMessages, temperature })
              : ollamaChatStream({ messages: llmMessages, temperature });

            for await (const chunk of gen) {
              const cleanedChunk = postProcessAssistantChunk(chunk, lang);
              if (!cleanedChunk) continue;
              full += cleanedChunk;
              controller.enqueue(encoder.encode(cleanedChunk));
            }

            // Persist assistant answer after streaming completes.
            full = postProcessAssistantText(full, lang);
            await prisma.chatMessage.create({
              data: {
                chatId,
                role: "assistant",
                content: full,
              },
              select: { id: true },
            });

            // Update summary and chat metadata.
            const chat = await prisma.chatSession.findUnique({
              where: { id: chatId },
              select: { title: true, summary: true },
            });

            // Rebuild summary from recent messages (more consistent when regenerating).
            const lastForSummary = await prisma.chatMessage.findMany({
              where: { chatId },
              orderBy: { createdAt: "asc" },
              select: { role: true, content: true },
              take: 20,
            });
            const summaryPairs: Array<{ role: "user" | "assistant"; content: string }> = lastForSummary
              .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
              .map((m: { role: string; content: string }) => ({
                role: safeRole(m.role) as "user" | "assistant",
                content: m.content,
              }));

            const rebuiltSummary = buildSummaryFromMessages(summaryPairs);

            await prisma.chatSession.update({
              where: { id: chatId },
              data: {
                language: lang,
                summary: rebuiltSummary || chat?.summary || null,
                title:
                  chat?.title === "Nouveau chat" || !chat?.title
                    ? compactTitleFromUserText(userText)
                    : undefined,
              },
              select: { id: true },
            });

            controller.close();
          } catch (err) {
            controller.error(err);
          }
        },
      });

      const headers = new Headers({
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      });
      headers.set("X-Chat-Id", chatId);
      headers.set("X-User-Message-Id", userMessageId);

      return new Response(stream, { status: 200, headers });
    }

    const rawAnswer = useOpenAICompat
      ? await openaiCompatChat({ messages: llmMessages, temperature })
      : await ollamaChat({ messages: llmMessages, temperature });

    const answer = postProcessAssistantText(rawAnswer, lang);

    await prisma.chatMessage.create({
      data: {
        chatId,
        role: "assistant",
        content: answer,
      },
      select: { id: true },
    });

    const chat = await prisma.chatSession.findUnique({
      where: { id: chatId },
      select: { title: true, summary: true },
    });

    const lastForSummary = await prisma.chatMessage.findMany({
      where: { chatId },
      orderBy: { createdAt: "asc" },
      select: { role: true, content: true },
      take: 20,
    });
    const summaryPairs: Array<{ role: "user" | "assistant"; content: string }> = lastForSummary
      .filter((m: { role: string }) => m.role === "user" || m.role === "assistant")
      .map((m: { role: string; content: string }) => ({
        role: safeRole(m.role) as "user" | "assistant",
        content: m.content,
      }));

    const rebuiltSummary = buildSummaryFromMessages(summaryPairs);

    await prisma.chatSession.update({
      where: { id: chatId },
      data: {
        language: lang,
        summary: rebuiltSummary || chat?.summary || null,
        title:
          chat?.title === "Nouveau chat" || !chat?.title
            ? compactTitleFromUserText(userText)
            : undefined,
      },
      select: { id: true },
    });

    return NextResponse.json({ chatId, userMessageId, language: lang, answer, catalogHits: hits, recommendation });
  } catch (e) {
    console.error("[api/chat] error", e);
    const msg = e instanceof Error ? e.message : "Unknown error";

    const isSqliteOpenError =
      /Unable to open the database file/i.test(msg) || /Error code\s*14/i.test(msg);
    if (isSqliteOpenError) {
      return NextResponse.json(
        {
          error: "Base de données SQLite inaccessible (Prisma).",
          details: msg,
          hint: "Vérifie DATABASE_URL et lance `npm run db:migrate` puis `npm run db:seed`.",
        },
        { status: 500 },
      );
    }

    const isOllamaHttpError = /Ollama error\s+\d+:/i.test(msg);
    const isOllamaConnError = /ECONNREFUSED|fetch failed|getaddrinfo|ENOTFOUND/i.test(msg);
    if (isOllamaHttpError || isOllamaConnError) {
      return NextResponse.json(
        {
          error: "Ollama indisponible ou modèle non prêt.",
          details: msg,
          hint: "Vérifie que Ollama tourne et que le modèle est installé (ex: `ollama pull qwen2.5:7b-instruct`).",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
