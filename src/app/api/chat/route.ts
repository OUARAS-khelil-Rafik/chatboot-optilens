import { NextResponse } from "next/server";
import { z } from "zod";
import { detectLanguageInfo, type SupportedLanguage } from "@/lib/language";
import { ollamaChat, ollamaChatStream, type OllamaMessage } from "@/lib/ollama";
import { parsePrescription, recommendFromInputs } from "@/lib/recommendation";
import { formatCatalogContextForPrompt, searchCatalog } from "@/lib/catalogSearch";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

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
  const items = await prisma.chatMemory.findMany({
    where: { scope: { in: ["global", `chat:${params.chatId}`] } },
    orderBy: { updatedAt: "desc" },
    select: { scope: true, key: true, value: true },
    take: 25,
  });

  if (items.length === 0) return "(none)";
  return items
    .map((m) => `- [${m.scope}] ${m.key}: ${m.value}`)
    .join("\n");
}

function getCommercialIntent(text: string): { price: boolean; availability: boolean } {
  // FR/EN/AR signals.
  const price =
    /(\bprix\b|\btarif\b|\bcombien\b|\bco[uû]t\b|\bprice\b|\bcost\b|\bhow\s*much\b|سعر|ثمن|كم\b|بكم)/i.test(
      text,
    );

  const availability =
    /(\bavailable\b|\bavailability\b|\bdisponible\b|\bdisponibilit[eé]\b|\ben stock\b|\bstock\b|\bquantit[eé]\b|\bquantity\b|\bin store\b|\bin\s+shop\b|متوفر|موجود|التوفر|\bالمحل\b|\bفي\s*المحل\b)/i.test(
      text,
    );

  return { price, availability };
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

  return [
    "You are OptiLens, a multilingual optical-lens sales assistant for an optician.",
    "Your job: help customers choose optical lenses and coatings.",
    "Formatting: Reply in Markdown. Use short headings (#/##), bullet lists (- or +), and **bold** for key recommendations. Use newlines for readability. Do not use HTML.",
    "Important: Do NOT mention prices unless the user explicitly asks for price.",
    "Important: Do NOT mention stock/availability unless the user explicitly asks if it is available / in stock / in store.",
    "When the user asks availability in the store/shop (e.g., 'disponible ?', 'en stock ?', 'في المحل؟', 'متوفر؟'), answer using ONLY the catalog context stock. If stock=0, say it is not available right now.",
    "When the user asks price (e.g., 'prix ?', 'combien ?', 'سعر؟'), answer using ONLY the catalog context price.",
    "If the user asks for price/availability and it is not in the catalog context, say you don't have it in the database.",
    "Never invent brands, SKUs, prices, availability, or stock.",
    "Keep conversation context limited: only use the last user message + the provided catalog context + the provided recommendation notes.",
    "When a prescription is present (SPH/CYL), give a recommendation: index (1.5/1.56/1.6/1.67/1.74) + coatings.",
    "Always recommend antireflective (AR) and typically hard coat + hydrophobic unless the user refuses.",
    "Explain photochromic technology when asked: activation by UV, temperature impact, indoor clear, car windshield limitation, and 'optimized for car' variants.",
    "Support these coatings: AR (antireflet), BLUECUT, PHOTO (photochromique), HARD (durci), HYDRO (hydrophobe).",
    "If user is outside optical lenses domain, politely say you can only help with optical lenses.",
    languageInstruction,
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

    const lang: SupportedLanguage =
      detection.confidence === "low" && storedLang
        ? storedLang
        : detection.lang;

    // Parse prescription from last user message (simple, can be expanded).
    const prescription = parsePrescription(userText);
    const recommendation = recommendFromInputs({ prescription, needs: [] });

    const intent = getCommercialIntent(userText);
    const includePrice = intent.price;
    const includeAvailability = intent.availability;

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
    const recent = await prisma.chatMessage.findMany({
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
      .filter((m) => m.role !== "system")
      .map((m) => ({ role: safeRole(m.role), content: m.content }) satisfies OllamaMessage)
      .slice(-12);

    const llmMessages: OllamaMessage[] = [{ role: "system", content: systemWithMemory }, ...history];

    if (body.stream) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          let full = "";
          try {
            for await (const chunk of ollamaChatStream({ messages: llmMessages, temperature: 0.2 })) {
              full += chunk;
              controller.enqueue(encoder.encode(chunk));
            }

            // Persist assistant answer after streaming completes.
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
            const summaryPairs = lastForSummary
              .filter((m) => m.role === "user" || m.role === "assistant")
              .map((m) => ({ role: safeRole(m.role) as "user" | "assistant", content: m.content }));

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

      return new Response(stream, {
        status: 200,
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
          "X-Chat-Id": chatId,
          "X-User-Message-Id": userMessageId,
        },
      });
    }

    const answer = await ollamaChat({ messages: llmMessages, temperature: 0.2 });

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
    const summaryPairs = lastForSummary
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({ role: safeRole(m.role) as "user" | "assistant", content: m.content }));

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
