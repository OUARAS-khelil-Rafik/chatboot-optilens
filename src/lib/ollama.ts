export type OllamaMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type OllamaChatResponse = {
  message: { role: string; content: string };
};

type OllamaChatStreamChunk = {
  message?: { role?: string; content?: string };
  done?: boolean;
};

export async function* ollamaChatStream(params: {
  messages: OllamaMessage[];
  temperature?: number;
  model?: string;
}): AsyncGenerator<string, void, void> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = params.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: true,
      messages: params.messages,
      options: {
        temperature: params.temperature ?? 0.2,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  if (!res.body) return;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    while (true) {
      const nl = buffer.indexOf("\n");
      if (nl === -1) break;

      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;

      const chunk = JSON.parse(line) as OllamaChatStreamChunk;
      const content = chunk.message?.content;
      if (content) yield content;
      if (chunk.done) return;
    }
  }
}

export async function ollamaChat(params: {
  messages: OllamaMessage[];
  temperature?: number;
  model?: string;
}): Promise<string> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  const model = params.model ?? process.env.OLLAMA_MODEL ?? "qwen2.5:7b-instruct";

  const res = await fetch(`${baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      messages: params.messages,
      options: {
        temperature: params.temperature ?? 0.2,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Ollama error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  return data.message?.content ?? "";
}
