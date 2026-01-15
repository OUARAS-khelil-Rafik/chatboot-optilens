import "dotenv/config";

import fs from "node:fs";
import path from "node:path";

import { prisma } from "../src/lib/db";

type Role = "system" | "user" | "assistant";

type ChatMessage = {
  role: Role;
  content: string;
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

function ensureDir(p: string) {
  fs.mkdirSync(p, { recursive: true });
}

function defaultSystemPrompt(): string {
  // Keep this short for training examples. The deployed app can keep its longer rules.
  return [
    "You are OptiLens, a multilingual optical-lens sales assistant for an optician.",
    "LANGUAGE RULE (highest priority): Answer in the same language as the user's last message.",
    "If the user writes in French, answer in French. If Arabic, answer in Arabic. If English, answer in English.",
    "Do not invent prices or stock. If unknown, say you don't have it.",
    "Reply in Markdown with short headings and bullet lists.",
  ].join("\n");
}

function sanitizeContent(s: string): string {
  // Very light cleaning: collapse excessive whitespace.
  return s.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function main() {
  const outArg = getArg("out") ?? "training_data/optilens_chat.jsonl";
  const maxChats = getArgNumber("maxChats", 500);
  const maxExamples = getArgNumber("maxExamples", 5000);
  const maxMessagesPerExample = getArgNumber("maxMessagesPerExample", 16);
  const includeOnlyActiveChats = !getArgBoolean("includeDeleted");

  const outPath = path.resolve(process.cwd(), outArg);
  ensureDir(path.dirname(outPath));

  const sessions = await prisma.chatSession.findMany({
    orderBy: { updatedAt: "desc" },
    take: maxChats,
    select: {
      id: true,
      language: true,
      messages: {
        orderBy: { createdAt: "asc" },
        select: { role: true, content: true },
      },
    },
  });

  let written = 0;
  const lines: string[] = [];

  for (const s of sessions) {
    if (!s.messages.length) continue;

    const system: ChatMessage = { role: "system", content: defaultSystemPrompt() };

    const convo: ChatMessage[] = [system];

    for (const m of s.messages) {
      const role = (m.role === "user" || m.role === "assistant" || m.role === "system")
        ? (m.role as Role)
        : "user";

      const content = sanitizeContent(m.content);
      if (!content) continue;

      if (role === "system") {
        // We generally don't want to learn from arbitrary system messages stored in DB.
        continue;
      }

      convo.push({ role, content });

      if (role === "assistant") {
        // Create a training sample at each assistant turn.
        const trimmed = convo.slice(-maxMessagesPerExample);
        lines.push(JSON.stringify({ messages: trimmed }));
        written += 1;
        if (written >= maxExamples) break;
      }
    }

    if (written >= maxExamples) break;
  }

  fs.writeFileSync(outPath, lines.join("\n") + (lines.length ? "\n" : ""), "utf8");

  console.log(`Wrote ${lines.length} examples to ${outArg}`);

  // Best-effort: close Prisma to avoid hanging process.
  await prisma.$disconnect().catch(() => {});
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
