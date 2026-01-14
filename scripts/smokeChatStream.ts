import "dotenv/config";

import { POST } from "../src/app/api/chat/route";

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
  const req = new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      stream: true,
      messages: [
        {
          role: "user",
          content:
            "Bonjour. SPH -2.50 CYL -1.25. Beaucoup d’écrans. Je veux blue cut + antireflet.",
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
