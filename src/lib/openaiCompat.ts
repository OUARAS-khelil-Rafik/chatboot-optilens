import type { OllamaMessage } from "@/lib/ollama";

// OpenAI-compatible client (local/self-hosted):
// Supports servers that expose `/v1/chat/completions` with OpenAI-like streaming SSE events.
// This is used when `LLM_PROVIDER=openai-compat`.

type OpenAICompatChatCompletion = {
  choices?: Array<{
    message?: { role?: string; content?: string };
  }>;
};

type OpenAICompatStreamChunk = {
  choices?: Array<{
    delta?: { role?: string; content?: string };
    finish_reason?: string | null;
  }>;
};

function normalizeBaseUrl(raw: string): string {
  const trimmed = raw.replace(/\/+$/, "");
  // Accept either http://host:8000 or http://host:8000/v1
  return trimmed.endsWith("/v1") ? trimmed : `${trimmed}/v1`;
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const key = process.env.OPENAI_COMPAT_API_KEY;
  if (key) headers.Authorization = `Bearer ${key}`;

  return headers;
}

export async function* openaiCompatChatStream(params: {
  messages: OllamaMessage[];
  temperature?: number;
  model?: string;
}): AsyncGenerator<string, void, void> {
  const baseUrl = normalizeBaseUrl(process.env.OPENAI_COMPAT_BASE_URL ?? "http://127.0.0.1:8000");
  const model = params.model ?? process.env.OPENAI_COMPAT_MODEL;

  if (!model) {
    throw new Error(
      "OPENAI_COMPAT_MODEL est requis quand LLM_PROVIDER=openai-compat.",
    );
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      stream: true,
      temperature: params.temperature ?? 0.2,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible error ${res.status}: ${body}`);
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

      const line = buffer.slice(0, nl).trimEnd();
      buffer = buffer.slice(nl + 1);

      const trimmed = line.trim();
      if (!trimmed) continue;
      if (!trimmed.startsWith("data:")) continue;

      const data = trimmed.slice("data:".length).trim();
      if (!data) continue;
      if (data === "[DONE]") return;

      let parsed: OpenAICompatStreamChunk;
      try {
        parsed = JSON.parse(data) as OpenAICompatStreamChunk;
      } catch {
        continue;
      }

      const delta = parsed.choices?.[0]?.delta?.content;
      if (delta) yield delta;

      const finish = parsed.choices?.[0]?.finish_reason;
      if (finish) return;
    }
  }
}

export async function openaiCompatChat(params: {
  messages: OllamaMessage[];
  temperature?: number;
  model?: string;
}): Promise<string> {
  const baseUrl = normalizeBaseUrl(process.env.OPENAI_COMPAT_BASE_URL ?? "http://127.0.0.1:8000");
  const model = params.model ?? process.env.OPENAI_COMPAT_MODEL;

  if (!model) {
    throw new Error(
      "OPENAI_COMPAT_MODEL est requis quand LLM_PROVIDER=openai-compat.",
    );
  }

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      model,
      stream: false,
      temperature: params.temperature ?? 0.2,
      messages: params.messages,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`OpenAI-compatible error ${res.status}: ${body}`);
  }

  const data = (await res.json()) as OpenAICompatChatCompletion;
  return data.choices?.[0]?.message?.content ?? "";
}
