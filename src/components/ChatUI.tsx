"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";

type Role = "user" | "assistant";

type Message = {
  id?: string;
  role: Role;
  content: string;
};

type ChatSummary = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  language?: string | null;
};

function PencilIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

function CopyIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function RefreshIcon(props: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className ?? "h-4 w-4"}
      aria-hidden="true"
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

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
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
  const [renamingChatId, setRenamingChatId] = useState<string | null>(null);
  const [renameTitle, setRenameTitle] = useState("");

  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");

  const [toast, setToast] = useState<string | null>(null);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  function stop() {
    abortRef.current?.abort();
    abortRef.current = null;
    setLoading(false);
  }

  async function refreshChats() {
    const res = await fetch("/api/chats", { method: "GET" });
    if (!res.ok) return;
    const data = (await res.json()) as { chats?: ChatSummary[] };
    setChats(data.chats ?? []);
  }

  function showToast(text: string) {
    setToast(text);
    window.setTimeout(() => setToast(null), 1200);
  }

  async function syncChatMessages(chatId: string) {
    const res = await fetch(`/api/chats/${chatId}`, { method: "GET" });
    if (!res.ok) return;
    const data = (await res.json()) as {
      chat?: { id: string; messages: Array<{ id: string; role: string; content: string }> };
    };
    const mapped: Message[] =
      data.chat?.messages
        ?.filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({ id: m.id, role: m.role as Role, content: m.content })) ?? [];
    setMessages(ensureGreetingIfEmpty(mapped));
  }

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("Copié");
    } catch {
      // Fallback for older/locked-down contexts
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try {
        document.execCommand("copy");
        showToast("Copié");
      } finally {
        document.body.removeChild(ta);
      }
    }
  }

  function ensureGreetingIfEmpty(list: Message[]): Message[] {
    if (list.length > 0) return list;
    return [
      {
        role: "assistant",
        content:
          "Bonjour ! Je suis OptiLens. Donne-moi ta prescription (SPH / CYL) + tes besoins (écrans, extérieur, voiture) et je te propose des verres adaptés. Si tu veux, demande-moi aussi le prix ou la disponibilité.",
      },
    ];
  }

  async function loadChat(chatId: string) {
    setSelectedChatId(chatId);
    setLoading(true);
    try {
      const res = await fetch(`/api/chats/${chatId}`, { method: "GET" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        chat?: { id: string; title: string; messages: Array<{ id: string; role: string; content: string }> };
      };
      const mapped: Message[] =
        data.chat?.messages
          ?.filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({ id: m.id, role: m.role as Role, content: m.content })) ?? [];
      setMessages(ensureGreetingIfEmpty(mapped));
      setEditingMessageId(null);
      setEditingText("");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "auto" });
      });
    }
  }

  async function newChat() {
    // Create a session shell (optional) so the user can switch immediately.
    const res = await fetch("/api/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Nouveau chat" }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { chat?: { id: string } };
    await refreshChats();
    if (data.chat?.id) {
      setSelectedChatId(data.chat.id);
      setMessages(ensureGreetingIfEmpty([]));
    }
  }

  async function deleteChat(chatId: string) {
    const ok = confirm("Supprimer ce chat ?");
    if (!ok) return;
    const res = await fetch(`/api/chats/${chatId}`, { method: "DELETE" });
    if (!res.ok) return;
    await refreshChats();
    if (selectedChatId === chatId) {
      setSelectedChatId(null);
      setMessages(ensureGreetingIfEmpty([]));
    }
  }

  async function renameChat(chatId: string, title: string) {
    const res = await fetch(`/api/chats/${chatId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return;
    setRenamingChatId(null);
    setRenameTitle("");
    await refreshChats();
  }

  useEffect(() => {
    void refreshChats();
    setMessages(ensureGreetingIfEmpty([]));
  }, []);

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

    // Cancel any previous in-flight request (defensive).
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chatId: selectedChatId ?? undefined,
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
      const chatIdHeader = res.headers.get("x-chat-id");
      const userMessageIdHeader = res.headers.get("x-user-message-id");
      if (chatIdHeader && chatIdHeader !== selectedChatId) {
        setSelectedChatId(chatIdHeader);
        void refreshChats();
      }

      if (userMessageIdHeader) {
        // Attach DB id to the last user message in local state.
        setMessages((prev) => {
          const copy = [...prev];
          for (let i = copy.length - 1; i >= 0; i--) {
            if (copy[i]?.role === "user" && !copy[i]?.id) {
              copy[i] = { ...copy[i], id: userMessageIdHeader };
              break;
            }
          }
          return copy;
        });
      }
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

        // Refresh chat list timestamps.
        void refreshChats();

        // Sync IDs from DB so edit/regenerate icons become available.
        if (chatIdHeader ?? selectedChatId) {
          void syncChatMessages(chatIdHeader ?? selectedChatId!);
        }
      }
    } catch (e) {
      // User cancelled streaming.
      if (e instanceof DOMException && e.name === "AbortError") {
        return;
      }
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
      abortRef.current = null;
      setLoading(false);
    }
  }

  async function editAndRegenerate(params: { messageId: string; newText: string }) {
    if (!selectedChatId) return;
    const trimmed = params.newText.trim();
    if (!trimmed) return;

    const idx = messages.findIndex((m) => m.id === params.messageId);
    if (idx === -1) return;

    setLoading(true);
    setEditingMessageId(null);

    try {
      // 1) Update the user message content in DB.
      const patchRes = await fetch(`/api/chats/${selectedChatId}/messages/${params.messageId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: trimmed }),
      });
      if (!patchRes.ok) throw new Error(`HTTP ${patchRes.status}`);

      // 2) Delete all messages after this one (to keep the conversation consistent).
      const toDelete = messages
        .slice(idx + 1)
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      for (const id of toDelete) {
        // Best effort.
        await fetch(`/api/chats/${selectedChatId}/messages/${id}`, { method: "DELETE" });
      }

      // 3) Update local state: keep messages up to edited question + placeholder assistant.
      const updatedPrefix = messages.slice(0, idx + 1).map((m) =>
        m.id === params.messageId ? { ...m, content: trimmed } : m,
      );
      const assistantIndex = updatedPrefix.length;
      setMessages([...updatedPrefix, { role: "assistant", content: "" }]);

      // 4) Stream regenerated assistant response without duplicating the user message.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chatId: selectedChatId,
          userMessageId: params.messageId,
          messages: [{ role: "user", content: trimmed }],
          clientRequestId: nowId(),
          stream: true,
        }),
      });

      if (!res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const textBody = await res.text().catch(() => "");
        throw new Error(textBody || `HTTP ${res.status}`);
      }

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

      void refreshChats();
      void syncChatMessages(selectedChatId);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Erreur";
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.content.trim().length === 0) {
          copy[copy.length - 1] = {
            role: "assistant",
            content: `Désolé, erreur: ${msg}.`,
          };
          return copy;
        }
        return [...copy, { role: "assistant", content: `Désolé, erreur: ${msg}.` }];
      });
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  async function regenerateAnswerFromAssistant(assistantMessageId: string) {
    if (!selectedChatId) return;
    const assistantIdx = messages.findIndex((m) => m.id === assistantMessageId);
    if (assistantIdx === -1) return;

    // Find the closest previous user message.
    let userMsg: Message | undefined;
    for (let i = assistantIdx - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        userMsg = messages[i];
        break;
      }
    }
    if (!userMsg?.id) {
      showToast("Recharge le chat pour régénérer");
      return;
    }

    setLoading(true);

    try {
      // Delete assistant message and everything after it in DB (best effort).
      const toDelete = messages
        .slice(assistantIdx)
        .map((m) => m.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      for (const id of toDelete) {
        await fetch(`/api/chats/${selectedChatId}/messages/${id}`, { method: "DELETE" });
      }

      // Local state: keep up to the user message + placeholder assistant.
      const userIdx = messages.findIndex((m) => m.id === userMsg!.id);
      const prefix = messages.slice(0, userIdx + 1);
      const assistantIndex = prefix.length;
      setMessages([...prefix, { role: "assistant", content: "" }]);

      // Stream regenerated assistant answer.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          chatId: selectedChatId,
          userMessageId: userMsg.id,
          messages: [{ role: "user", content: userMsg.content }],
          clientRequestId: nowId(),
          stream: true,
        }),
      });

      if (!res.ok) {
        const ct = res.headers.get("content-type") ?? "";
        if (ct.includes("application/json")) {
          const data = (await res.json()) as { error?: string };
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        const textBody = await res.text().catch(() => "");
        throw new Error(textBody || `HTTP ${res.status}`);
      }

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

      void refreshChats();
      void syncChatMessages(selectedChatId);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      const msg = e instanceof Error ? e.message : "Erreur";
      setMessages((prev) => {
        const copy = [...prev];
        const last = copy[copy.length - 1];
        if (last?.role === "assistant" && last.content.trim().length === 0) {
          copy[copy.length - 1] = { role: "assistant", content: `Désolé, erreur: ${msg}.` };
          return copy;
        }
        return [...copy, { role: "assistant", content: `Désolé, erreur: ${msg}.` }];
      });
    } finally {
      abortRef.current = null;
      setLoading(false);
    }
  }

  return (
    <div className={props.embed ? "w-full" : "mx-auto w-full max-w-5xl"}>
      {toast ? (
        <div className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-black px-3 py-1 text-xs text-white">
          {toast}
        </div>
      ) : null}
      <div className={props.embed ? "flex flex-col gap-3" : "grid grid-cols-1 gap-3 md:grid-cols-[280px_1fr]"}>
        {props.embed ? null : (
          <div className="rounded-xl border border-black/10 bg-white p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold">Chats</div>
              <button
                className="rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white"
                onClick={() => void newChat()}
                disabled={loading}
              >
                + Nouveau
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {chats.length === 0 ? (
                <div className="text-xs text-black/60">Aucun historique pour l’instant.</div>
              ) : null}

              {chats.map((c) => (
                <div
                  key={c.id}
                  className={
                    selectedChatId === c.id
                      ? "rounded-lg border border-black/20 bg-black/5 p-2"
                      : "rounded-lg border border-black/10 bg-white p-2"
                  }
                >
                  {renamingChatId === c.id ? (
                    <div className="flex gap-2">
                      <input
                        className="w-full rounded-md border border-black/10 px-2 py-1 text-xs"
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        placeholder="Nouveau titre"
                        title="Renommer le chat"
                      />
                      <button
                        className="rounded-md bg-black px-2 py-1 text-xs text-white"
                        onClick={() => void renameChat(c.id, renameTitle.trim() || c.title)}
                      >
                        OK
                      </button>
                    </div>
                  ) : (
                    <button
                      className="w-full text-left"
                      onClick={() => void loadChat(c.id)}
                      disabled={loading}
                      title={c.title}
                    >
                      <div className="truncate text-sm font-medium">{c.title}</div>
                      <div className="mt-0.5 text-[11px] text-black/50">
                        {c.language ? c.language.toUpperCase() : "—"} • {new Date(c.updatedAt).toLocaleString()}
                      </div>
                    </button>
                  )}

                  <div className="mt-2 flex gap-2">
                    <button
                      className="rounded-md border border-black/10 px-2 py-1 text-[11px]"
                      onClick={() => {
                        setRenamingChatId(c.id);
                        setRenameTitle(c.title);
                      }}
                      disabled={loading}
                    >
                      Renommer
                    </button>
                    <button
                      className="rounded-md border border-black/10 px-2 py-1 text-[11px]"
                      onClick={() => void deleteChat(c.id)}
                      disabled={loading}
                    >
                      Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

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
                key={m.id ?? idx}
                className={
                  m.role === "user"
                    ? "self-end max-w-[85%] rounded-2xl bg-black text-white px-4 py-2"
                    : "self-start max-w-[85%] rounded-2xl bg-black/5 text-black px-4 py-2"
                }
              >
                {m.role === "user" && m.id && selectedChatId && editingMessageId === m.id ? (
                  <div className="flex flex-col gap-2">
                    <textarea
                      className="w-full rounded-md bg-white/10 p-2 text-sm outline-none"
                      value={editingText}
                      onChange={(e) => setEditingText(e.target.value)}
                      rows={3}
                      placeholder="Modifier votre message"
                      title="Modifier votre message"
                    />
                    <div className="flex gap-2">
                      <button
                        className="rounded-md border border-white/20 px-2 py-1 text-xs"
                        type="button"
                        onClick={() => {
                          setEditingMessageId(null);
                          setEditingText("");
                        }}
                        disabled={loading}
                      >
                        Annuler
                      </button>
                      <button
                        className="rounded-md bg-white px-2 py-1 text-xs font-medium text-black"
                        type="button"
                        onClick={() => void editAndRegenerate({ messageId: m.id!, newText: editingText })}
                        disabled={loading}
                        title="Enregistrer et régénérer la réponse"
                      >
                        Enregistrer & régénérer
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <MessageMarkdown content={m.content} />
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      {m.role === "user" && m.id && selectedChatId ? (
                        <button
                          type="button"
                          className="rounded-md bg-white/10 p-1 hover:bg-white/20"
                          onClick={() => {
                            setEditingMessageId(m.id!);
                            setEditingText(m.content);
                          }}
                          title="Modifier la question"
                          disabled={loading}
                        >
                          <PencilIcon className="h-4 w-4" />
                        </button>
                      ) : null}

                      {m.role === "assistant" ? (
                        <button
                          type="button"
                          className="rounded-md bg-black/5 p-1 hover:bg-black/10"
                          onClick={() => void copyToClipboard(m.content)}
                          title="Copier la réponse"
                        >
                          <CopyIcon className="h-4 w-4" />
                        </button>
                      ) : null}

                      {m.role === "assistant" && m.id && selectedChatId ? (
                        <button
                          type="button"
                          className="rounded-md bg-black/5 p-1 hover:bg-black/10"
                          onClick={() => void regenerateAnswerFromAssistant(m.id!)}
                          title="Régénérer la réponse"
                          disabled={loading}
                        >
                          <RefreshIcon className="h-4 w-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                )}
              </div>
            ))}
            {loading ? (
              <div className="self-start max-w-[85%] rounded-2xl bg-black/5 text-black px-4 py-2">
                <div className="text-sm">Réponse en cours…</div>
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
            />
            {loading ? (
              <button
                className="rounded-lg border border-black/10 bg-white px-4 py-2 text-sm font-medium"
                onClick={() => stop()}
                type="button"
              >
                Stop
              </button>
            ) : (
              <button
                className={
                  canSend
                    ? "rounded-lg bg-black px-4 py-2 text-sm font-medium text-white"
                    : "rounded-lg bg-black/30 px-4 py-2 text-sm font-medium text-white"
                }
                onClick={() => void send()}
                disabled={!canSend}
                type="button"
              >
                Envoyer
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
    </div>
  );
}
