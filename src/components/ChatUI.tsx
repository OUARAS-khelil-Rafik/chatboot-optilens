"use client";

import { useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type Role = "user" | "assistant";

type Message = {
  role: Role;
  content: string;
};

function isArabicLike(text: string): boolean {
  // Arabic blocks + Arabic Presentation Forms (covers Arabic, many dialect writings, etc.)
  return /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
}

function MessageMarkdown(props: { content: string }) {
  const rtl = isArabicLike(props.content);

  return (
    <div dir={rtl ? "rtl" : "ltr"} className={rtl ? "text-right" : "text-left"}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={{
          p: ({ children }) => <p className="whitespace-pre-wrap text-sm leading-6">{children}</p>,
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          h1: ({ children }) => <h1 className="mt-1 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mt-1 text-sm font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mt-1 text-sm font-medium">{children}</h3>,
          ul: ({ children }) => (
            <ul className="mt-1 list-disc pl-5 text-sm leading-6 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-1 list-decimal pl-5 text-sm leading-6 space-y-1">{children}</ol>
          ),
          a: ({ children, href }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="underline underline-offset-2"
            >
              {children}
            </a>
          ),
          code: ({ children }) => (
            <code className="rounded bg-black/5 px-1 py-0.5 font-mono text-[12px]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="mt-2 overflow-auto rounded bg-black/5 p-3 text-[12px] leading-5">{children}</pre>
          ),
        }}
      >
        {props.content}
      </ReactMarkdown>
    </div>
  );
}

function nowId() {
  return Math.random().toString(16).slice(2);
}

export default function ChatUI(props: { embed?: boolean }) {
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content:
        "Bonjour ! Je suis OptiLens. Donne-moi ta prescription (SPH / CYL) + tes besoins (écrans, extérieur, voiture) et je te propose des verres adaptés. Si tu veux, demande-moi aussi le prix ou la disponibilité.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;

    setInput("");
    setLoading(true);

    const userMsg: Message = { role: "user", content: text };
    const assistantMsg: Message = { role: "assistant", content: "" };
    const next = [...messages, userMsg, assistantMsg];
    const assistantIndex = next.length - 1;
    setMessages(next);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: next
            .filter((m) => m.role !== "assistant" || m.content.trim().length > 0)
            .map((m) => ({ role: m.role, content: m.content })),
          clientRequestId: nowId(),
          stream: true,
        }),
      });

      if (!res.ok) {
        // Prefer JSON error if available.
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const textBody = await res.text().catch(() => "");
        throw new Error(textBody || `HTTP ${res.status}`);
      }

      const contentType = res.headers.get("content-type") ?? "";
      if (contentType.includes("application/json")) {
        const data = (await res.json()) as { answer?: string; error?: string };
        const answer = data.answer ?? "(Réponse vide)";
        setMessages((prev) => {
          const copy = [...prev];
          if (copy[assistantIndex]) copy[assistantIndex] = { role: "assistant", content: answer };
          return copy;
        });
      } else {
        const reader = res.body?.getReader();
        if (!reader) throw new Error("Streaming non supporté par le navigateur.");

        const decoder = new TextDecoder();
        let full = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          full += decoder.decode(value, { stream: true });
          setMessages((prev) => {
            const copy = [...prev];
            if (copy[assistantIndex]) copy[assistantIndex] = { role: "assistant", content: full };
            return copy;
          });
          requestAnimationFrame(() => {
            scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
          });
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erreur";
      setMessages((prev) => {
        const copy = [...prev];
        // Replace the placeholder assistant message if present, else append.
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.content.trim().length === 0) {
          copy[copy.length - 1] = {
            role: "assistant",
            content: `Désolé, erreur: ${msg}. Vérifie que Ollama tourne et que le modèle est installé.`,
          };
          return copy;
        }
        return [
          ...copy,
          {
            role: "assistant",
            content: `Désolé, erreur: ${msg}. Vérifie que Ollama tourne et que le modèle est installé.`,
          },
        ];
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={props.embed ? "w-full" : "mx-auto w-full max-w-3xl"}>
      <div className="flex flex-col gap-3">
        <div className="rounded-xl border border-black/10 bg-white p-4">
          <div className="text-lg font-semibold">OptiLens Chat</div>
          <div className="text-sm text-black/60">
            Multilingue (FR/EN/AR/DZ) • Catalogue + prix depuis la base • Contexte limité
          </div>
        </div>

        <div
          ref={scrollRef}
          className={
            props.embed
              ? "h-130 overflow-auto rounded-xl border border-black/10 bg-white p-4"
              : "h-[60vh] overflow-auto rounded-xl border border-black/10 bg-white p-4"
          }
        >
          <div className="flex flex-col gap-3">
            {messages.map((m, idx) => (
              <div
                key={idx}
                className={
                  m.role === "user"
                    ? "self-end max-w-[85%] rounded-2xl bg-black text-white px-4 py-2"
                    : "self-start max-w-[85%] rounded-2xl bg-black/5 text-black px-4 py-2"
                }
              >
                <MessageMarkdown content={m.content} />
              </div>
            ))}
            {loading ? (
              <div className="self-start max-w-[85%] rounded-2xl bg-black/5 text-black px-4 py-2">
                <div className="text-sm">…</div>
              </div>
            ) : null}
          </div>
        </div>

        <div className="rounded-xl border border-black/10 bg-white p-3">
          <div className="flex gap-2">
            <input
              className="w-full rounded-lg border border-black/10 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-black/20"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ex: SPH -2.50 CYL -1.25 AX 180, beaucoup d’écrans, je veux blue cut + antireflet"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
              disabled={loading}
            />
            <button
              className={
                canSend
                  ? "rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
                  : "rounded-lg bg-black/30 px-4 py-2 text-sm font-medium text-white"
              }
              onClick={() => void send()}
              disabled={!canSend}
            >
              Envoyer
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
