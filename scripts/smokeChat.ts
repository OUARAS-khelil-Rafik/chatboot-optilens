import "dotenv/config";

// Smoke-test the /api/chat handler without starting Next.js.
// This helps validate Prisma (SQLite) + Ollama connectivity.

import { POST } from "../src/app/api/chat/route";

async function main() {
  const req = new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      messages: [
        {
          role: "user",
          content:
            "Bonjour. SPH -2.50 CYL -1.25. Je veux blue cut pour écrans et un bon antireflet.",
        },
      ],
    }),
  });

  const res = await POST(req);
  const text = await res.text();

  console.log("status", res.status);
  console.log(text);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
