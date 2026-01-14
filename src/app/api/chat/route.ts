import { NextResponse } from "next/server";
import { z } from "zod";
import { detectLanguage, type SupportedLanguage } from "@/lib/language";
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
  messages: z.array(MessageSchema).min(1),
  stream: z.boolean().optional(),
});

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
      ? "أجب بالعربية."
      : lang === "dz"
        ? "جاوب بالدارجة الجزائرية (Latin ولا عربية حسب سؤال الزبون)."
        : lang === "en"
          ? "Answer in English."
          : "Réponds en français.";

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
    const userText = lastUser?.content ?? "";

    const lang = detectLanguage(userText);

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

    const system = makeSystemPrompt(lang, {
      catalogContext,
      recommendation,
      prescriptionText: prescription ? JSON.stringify(prescription) : undefined,
      priceRangeText,
      includePrice,
      includeAvailability,
    });

    // Hard limit chat history to reduce context.
    const trimmedHistory = body.messages
      .filter((m) => m.role !== "system")
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }) satisfies OllamaMessage);

    const llmMessages: OllamaMessage[] = [{ role: "system", content: system }, ...trimmedHistory];

    if (body.stream) {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoder = new TextEncoder();
          try {
            for await (const chunk of ollamaChatStream({ messages: llmMessages, temperature: 0.2 })) {
              controller.enqueue(encoder.encode(chunk));
            }
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
        },
      });
    }

    const answer = await ollamaChat({ messages: llmMessages, temperature: 0.2 });

    return NextResponse.json({ language: lang, answer, catalogHits: hits, recommendation });
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
