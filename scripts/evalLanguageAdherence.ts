import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

type ExpectedLang = "fr" | "en" | "ar" | "dz";

type PromptCase = {
  id: string;
  expectedLang: ExpectedLang;
  user: string;
};

type EvalResult = {
  id: string;
  expectedLang: ExpectedLang;
  detectedLang: ExpectedLang;
  ok: boolean;
  user: string;
  answerPreview: string;
  error?: string;
};

function getArg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function getArgNumber(name: string, fallback: number): number {
  const v = getArg(name);
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function getArgBoolean(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function detectLang(text: string): ExpectedLang {
  const t = text.trim();
  if (!t) return "fr";

  if (/\p{Script=Arabic}/u.test(t)) return "ar";

  const lower = t.toLowerCase();
  const darijaHints = ["wesh", "wach", "sahbi", "ch7al", "bzzaf", "kifach", "rani", "rak", "khoya", "brk"];
  if (darijaHints.some((w) => lower.includes(w))) return "dz";

  if (/[éèêàùçœ]/i.test(t)) return "fr";
  if (/(\bbonjour\b|\bsalut\b|\bsvp\b|\bmerci\b|\bverre\b|\btraitement\b|\borderonnance\b)/i.test(t)) return "fr";

  return "en";
}

function isOk(expected: ExpectedLang, detected: ExpectedLang): boolean {
  // Allow darija written in Arabic script to be detected as ar.
  if (expected === "dz" && detected === "ar") return true;
  return expected === detected;
}

async function callOpenAICompat(params: {
  baseUrl: string;
  apiKey?: string;
  model: string;
  user: string;
  temperature: number;
}): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (params.apiKey) headers.Authorization = `Bearer ${params.apiKey}`;

  const res = await fetch(`${params.baseUrl}/chat/completions`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: params.model,
      stream: false,
      temperature: params.temperature,
      messages: [
        {
          role: "system",
          content:
            "LANGUAGE RULE (highest priority): Answer in the same language as the user's message. If French -> French, Arabic -> Arabic, English -> English, Darija -> Darija.",
        },
        { role: "user", content: params.user },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return data.choices?.[0]?.message?.content ?? "";
}

async function main() {
  const inFile = getArg("in") ?? "training_data/eval/prompts.jsonl";
  const outFile = getArg("out") ?? "training_data/eval/results.json";
  const limit = getArgNumber("limit", 200);
  const concurrency = Math.min(32, getArgNumber("concurrency", 8));
  const temperature = Number(getArg("temperature") ?? "0.2");
  const verbose = getArgBoolean("verbose");

  const baseUrl = normalizeBaseUrl(process.env.OPENAI_COMPAT_BASE_URL ?? "http://127.0.0.1:8000");
  const model = process.env.OPENAI_COMPAT_MODEL ?? "Qwen/Qwen2.5-7B-Instruct";
  const apiKey = process.env.OPENAI_COMPAT_API_KEY;

  const inputPath = path.resolve(process.cwd(), inFile);
  const raw = fs.readFileSync(inputPath, "utf8");
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const prompts: PromptCase[] = [];
  for (const line of lines.slice(0, limit)) {
    try {
      const p = JSON.parse(line) as PromptCase;
      if (!p?.id || !p?.expectedLang || !p?.user) continue;
      prompts.push(p);
    } catch {
      // ignore
    }
  }

  const results: EvalResult[] = [];

  let idx = 0;
  async function worker() {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= prompts.length) return;

      const p = prompts[i];
      try {
        const answer = await callOpenAICompat({
          baseUrl,
          apiKey,
          model,
          user: p.user,
          temperature: Number.isFinite(temperature) ? temperature : 0.2,
        });

        const detectedLang = detectLang(answer) as ExpectedLang;
        const ok = isOk(p.expectedLang, detectedLang);
        const answerPreview = answer.replace(/\s+/g, " ").trim().slice(0, 240);

        results.push({
          id: p.id,
          expectedLang: p.expectedLang,
          detectedLang,
          ok,
          user: p.user,
          answerPreview,
        });

        if (verbose) {
          console.log(`${p.id} expected=${p.expectedLang} detected=${detectedLang} ok=${ok}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        results.push({
          id: p.id,
          expectedLang: p.expectedLang,
          detectedLang: p.expectedLang,
          ok: false,
          user: p.user,
          answerPreview: "",
          error: msg,
        });
        if (verbose) console.error(`${p.id} error: ${msg}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const byLang: Record<ExpectedLang, { total: number; ok: number }> = {
    fr: { total: 0, ok: 0 },
    en: { total: 0, ok: 0 },
    ar: { total: 0, ok: 0 },
    dz: { total: 0, ok: 0 },
  };

  for (const r of results) {
    byLang[r.expectedLang].total += 1;
    if (r.ok) byLang[r.expectedLang].ok += 1;
  }

  const total = results.length;
  const okCount = results.filter((r) => r.ok).length;
  const summary = {
    total,
    ok: okCount,
    passRate: total ? okCount / total : 0,
    byLang: {
      fr: byLang.fr.total ? byLang.fr.ok / byLang.fr.total : 0,
      en: byLang.en.total ? byLang.en.ok / byLang.en.total : 0,
      ar: byLang.ar.total ? byLang.ar.ok / byLang.ar.total : 0,
      dz: byLang.dz.total ? byLang.dz.ok / byLang.dz.total : 0,
    },
  };

  const outPath = path.resolve(process.cwd(), outFile);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify({ summary, results }, null, 2), "utf8");

  console.log("Language adherence summary:");
  console.log(`- total: ${summary.total}`);
  console.log(`- ok: ${summary.ok}`);
  console.log(`- passRate: ${(summary.passRate * 100).toFixed(1)}%`);
  console.log(`- fr: ${(summary.byLang.fr * 100).toFixed(1)}%`);
  console.log(`- en: ${(summary.byLang.en * 100).toFixed(1)}%`);
  console.log(`- ar: ${(summary.byLang.ar * 100).toFixed(1)}%`);
  console.log(`- dz: ${(summary.byLang.dz * 100).toFixed(1)}%`);
  console.log(`Results written to ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
