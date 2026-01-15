import "dotenv/config";

import { POST } from "../src/app/api/chat/route";

function parseArgs(argv: string[]) {
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
  return args;
}

async function readStreamAsText(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let out = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.provider) process.env.LLM_PROVIDER = args.provider;
  if (args.baseUrl) process.env.OLLAMA_BASE_URL = args.baseUrl;
  if (args.model) process.env.OLLAMA_MODEL = args.model;

  const provider = process.env.LLM_PROVIDER ?? "ollama";
  const model = process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";

  const prompt =
    args.prompt ??
    "Bonjour. SPH -2.50 CYL -1.25. Beaucoup d’écrans. Je veux blue cut + antireflet.";

  console.log("provider", provider);
  if (provider === "ollama") {
    console.log("ollama", { baseUrl, model });
  }

  const req = new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      messages: [
        {
          role: "user",
          content: prompt,
        },
      ],
    }),
  });

  const res = await POST(req);
  const text = await readStreamAsText(res);

  console.log("status", res.status);
  console.log(text.slice(0, 500));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
