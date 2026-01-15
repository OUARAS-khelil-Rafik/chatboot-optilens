import "dotenv/config";

// Compare base model vs fine-tuned model through the real /api/chat logic.
// This does NOT require starting Next.js.

import { POST } from "../src/app/api/chat/route";

type Args = {
  baseModel: string;
  ftModel: string;
  prompt: string;
  baseUrl?: string;
};

function parseArgs(argv: string[]): Partial<Args> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      i++;
    } else {
      args[key] = "true";
    }
  }

  return {
    baseModel: args.baseModel,
    ftModel: args.ftModel,
    prompt: args.prompt,
    baseUrl: args.baseUrl,
  };
}

async function callOnce(model: string, prompt: string): Promise<{ status: number; text: string }> {
  process.env.LLM_PROVIDER = "ollama";
  process.env.OLLAMA_MODEL = model;

  const req = new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const res = await POST(req);
  const text = await res.text();
  return { status: res.status, text };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const baseModel = args.baseModel ?? process.env.SMOKE_BASE_MODEL ?? "qwen2.5:7b-instruct";
  const ftModel = args.ftModel ?? process.env.SMOKE_FT_MODEL;

  if (!ftModel) {
    throw new Error(
      "Missing fine-tuned model. Provide --ftModel <name> or set SMOKE_FT_MODEL env var. Example: npx tsx scripts/smokeCompareModels.ts --ftModel optilens-qwen2.5-7b"
    );
  }

  if (args.baseUrl) process.env.OLLAMA_BASE_URL = args.baseUrl;

  const prompt =
    args.prompt ??
    "Bonjour. SPH -2.50 CYL -1.25. Beaucoup d’écrans. Je veux blue cut + antireflet. Pose-moi les questions manquantes puis propose 2 options.";

  console.log("ollama", {
    baseUrl: process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
    baseModel,
    ftModel,
  });

  const base = await callOnce(baseModel, prompt);
  const ft = await callOnce(ftModel, prompt);

  console.log("\n=== BASE (", baseModel, ") status", base.status, "===\n");
  console.log(base.text);

  console.log("\n=== FINE-TUNED (", ftModel, ") status", ft.status, "===\n");
  console.log(ft.text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
