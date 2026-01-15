import fs from "node:fs";
import path from "node:path";

type Role = "system" | "user" | "assistant";

type ChatMessage = {
  role: Role;
  content: string;
};

type ChatExample = {
  messages: ChatMessage[];
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
  return Number.isFinite(n) ? n : fallback;
}

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function normalizeWhitespace(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function redactPII(s: string): string {
  // Very lightweight redaction (heuristics). If you have real PII in prod, do stronger filtering.
  let out = s;
  // Emails
  out = out.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED_EMAIL]");
  // Phone numbers (very rough)
  out = out.replace(/\+?\d[\d\s().-]{7,}\d/g, "[REDACTED_PHONE]");
  // Addresses-like (rough): street keywords
  out = out.replace(/\b(rue|avenue|bd|boulevard|lotissement|cité|cite)\b[^\n]{0,60}/gi, "[REDACTED_ADDRESS]");
  return out;
}

function stableHash(input: string): string {
  // A tiny non-crypto stable hash to dedupe exact content.
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function isBadExample(ex: ChatExample): boolean {
  if (!ex.messages || ex.messages.length < 3) return true;
  const roles = ex.messages.map((m) => m.role);
  if (!roles.includes("user") || !roles.includes("assistant")) return true;

  const totalChars = ex.messages.reduce((sum, m) => sum + (m.content?.length ?? 0), 0);
  if (totalChars < 30) return true;
  if (totalChars > 24000) return true;

  return false;
}

function splitTrainVal<T>(items: T[], valRatio: number): { train: T[]; val: T[] } {
  const valCount = Math.max(1, Math.floor(items.length * valRatio));
  const val = items.slice(0, valCount);
  const train = items.slice(valCount);
  return { train, val };
}

async function main() {
  const input = getArg("in") ?? "training_data/optilens_chat.jsonl";
  const outDir = getArg("outDir") ?? "training_data/prepared";
  const valRatio = Math.min(0.5, Math.max(0.01, getArgNumber("valRatio", 0.02)));
  const maxExamples = Math.max(1, getArgNumber("maxExamples", 50000));

  const inPath = path.resolve(process.cwd(), input);
  const dir = path.resolve(process.cwd(), outDir);
  ensureDir(dir);

  const raw = fs.readFileSync(inPath, "utf8");
  const lines = raw.split(/\n/).map((l) => l.trim()).filter(Boolean);

  const seen = new Set<string>();
  const cleaned: ChatExample[] = [];

  for (const line of lines) {
    if (cleaned.length >= maxExamples) break;

    let parsed: ChatExample;
    try {
      parsed = JSON.parse(line) as ChatExample;
    } catch {
      continue;
    }

    if (!parsed?.messages?.length) continue;

    const messages: ChatMessage[] = parsed.messages
      .filter((m) => m && (m.role === "system" || m.role === "user" || m.role === "assistant"))
      .map((m) => ({
        role: m.role,
        content: redactPII(normalizeWhitespace(String(m.content ?? ""))),
      }))
      .filter((m) => m.content.length > 0);

    const ex: ChatExample = { messages };
    if (isBadExample(ex)) continue;

    const fingerprint = stableHash(messages.map((m) => `${m.role}:${m.content}`).join("\n"));
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    cleaned.push(ex);
  }

  // Deterministic shuffle: sort by fingerprint to mix (not random) while keeping stable output.
  const withKey = cleaned.map((ex) => ({
    key: stableHash(ex.messages.map((m) => `${m.role}:${m.content}`).join("\n")),
    ex,
  }));
  withKey.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const stable = withKey.map((x) => x.ex);

  const { train, val } = splitTrainVal(stable, valRatio);

  const trainPath = path.join(dir, "train.jsonl");
  const valPath = path.join(dir, "val.jsonl");

  fs.writeFileSync(trainPath, train.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");
  fs.writeFileSync(valPath, val.map((x) => JSON.stringify(x)).join("\n") + "\n", "utf8");

  console.log(`Prepared ${stable.length} examples (train=${train.length}, val=${val.length}) -> ${outDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
