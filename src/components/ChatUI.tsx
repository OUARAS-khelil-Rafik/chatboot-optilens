"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSanitize from "rehype-sanitize";
import {
  Bot,
  Copy,
  LoaderCircle,
  MessageCircle,
  Moon,
  Pencil,
  Plus,
  RefreshCcw,
  Send,
  Sparkles,
  Sun,
  Trash2,
  User,
  X,
} from "lucide-react";

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

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-1">
        <span className="ol-typing-dot" style={{ animationDelay: "0ms" }} />
        <span className="ol-typing-dot" style={{ animationDelay: "120ms" }} />
        <span className="ol-typing-dot" style={{ animationDelay: "240ms" }} />
      </div>
      <div className="ol-text-muted text-sm">Réponse en cours…</div>
    </div>
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
            <ul
              className={
                rtl
                  ? "mt-1 list-disc list-inside pr-5 pl-0 text-sm leading-6 space-y-1"
                  : "mt-1 list-disc pl-5 text-sm leading-6 space-y-1"
              }
            >
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol
              className={
                rtl
                  ? "mt-1 list-decimal list-inside pr-5 pl-0 text-sm leading-6 space-y-1"
                  : "mt-1 list-decimal pl-5 text-sm leading-6 space-y-1"
              }
            >
              {children}
            </ol>
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
            <code className="ol-code-bg rounded px-1 py-0.5 font-mono text-[12px]">{children}</code>
          ),
          pre: ({ children }) => (
            <pre className="ol-code-bg mt-2 overflow-auto rounded p-3 text-[12px] leading-5">{children}</pre>
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

  const [theme, setTheme] = useState<"light" | "dark" | null>(null);

  const cursorGlowRef = useRef<HTMLDivElement | null>(null);
  const cursorRafRef = useRef<number | null>(null);
  const cursorTargetRef = useRef<{ x: number; y: number }>({ x: -9999, y: -9999 });
  const cursorVisibleRef = useRef(false);

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

  useEffect(() => {
    // Theme init: localStorage override, else system.
    const saved = window.localStorage.getItem("ol-theme");
    const fromStorage = saved === "light" || saved === "dark" ? saved : null;
    const systemPrefersDark = window.matchMedia?.("(prefers-color-scheme: dark)")?.matches ?? false;
    const initial: "light" | "dark" = fromStorage ?? (systemPrefersDark ? "dark" : "light");
    document.documentElement.dataset.theme = initial;
    setTheme(initial);
  }, []);

  useEffect(() => {
    if (!theme) return;
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem("ol-theme", theme);
  }, [theme]);

  useEffect(() => {
    if (props.embed) return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    if (prefersReduced) return;

    const show = () => {
      cursorVisibleRef.current = true;
      if (cursorGlowRef.current) cursorGlowRef.current.style.opacity = "1";
    };

    const hide = () => {
      cursorVisibleRef.current = false;
      if (cursorGlowRef.current) cursorGlowRef.current.style.opacity = "0";
    };

    const onMove = (e: PointerEvent) => {
      cursorTargetRef.current = { x: e.clientX, y: e.clientY };
      if (!cursorVisibleRef.current) show();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("blur", hide);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") hide();
    });

    const tick = () => {
      const glow = cursorGlowRef.current;
      if (!glow) return;

      const { x, y } = cursorTargetRef.current;
      // Center the glow on the cursor.
      glow.style.transform = `translate3d(${x - 120}px, ${y - 120}px, 0)`;
      cursorRafRef.current = window.requestAnimationFrame(tick);
    };

    cursorRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("blur", hide);
      if (cursorRafRef.current) window.cancelAnimationFrame(cursorRafRef.current);
      cursorRafRef.current = null;
    };
  }, [props.embed]);

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
    <div className={props.embed ? "w-full" : "w-full"}>
      {props.embed ? null : (
        <div className="ol-cursor-layer">
          <div ref={cursorGlowRef} className="ol-cursor-glow" />
        </div>
      )}
      {toast ? (
        <div className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2 rounded-full bg-black px-3 py-1 text-xs text-white shadow-lg">
          <div className="ol-toast flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{toast}</span>
          </div>
        </div>
      ) : null}
      <div
        className={
          props.embed
            ? "flex flex-col gap-3"
            : "grid h-[calc(100vh-3rem)] min-h-0 grid-cols-1 gap-3 md:grid-cols-[280px_1fr]"
        }
      >
        {props.embed ? null : (
          <div className="ol-card ol-surface flex min-h-0 flex-col rounded-2xl border ol-border p-3 shadow-sm backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <MessageCircle className="h-4 w-4" aria-hidden="true" />
                <span>Chats</span>
              </div>
              <button
                className="ol-chip ol-btn-glow ol-primary-btn inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium shadow-sm disabled:opacity-60"
                onClick={() => void newChat()}
                disabled={loading}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Nouveau
              </button>
            </div>

            <div className="ol-scrollbar mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-auto pr-1">
              {chats.length === 0 ? (
                <div className="ol-shimmer rounded-xl border ol-border ol-soft-bg p-3 text-xs ol-text-muted">
                  Aucun historique pour l’instant.
                </div>
              ) : null}

              {chats.map((c) => (
                <div
                  key={c.id}
                  className={
                    selectedChatId === c.id
                      ? "ol-chat-item rounded-xl border ol-border-strong ol-soft-bg p-2 shadow-sm"
                      : "ol-chat-item rounded-xl border ol-border ol-surface-strong p-2"
                  }
                >
                  {renamingChatId === c.id ? (
                    <div className="flex gap-2">
                      <input
                        className="w-full rounded-md border ol-border ol-surface-strong px-2 py-1 text-xs"
                        value={renameTitle}
                        onChange={(e) => setRenameTitle(e.target.value)}
                        placeholder="Nouveau titre"
                        title="Renommer le chat"
                      />
                      <button
                        className="ol-primary-btn rounded-md px-2 py-1 text-xs"
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
                      <div className="ol-text-faint mt-0.5 text-[11px]">
                        {c.language ? c.language.toUpperCase() : "—"} • {new Date(c.updatedAt).toLocaleString()}
                      </div>
                    </button>
                  )}

                  <div className="mt-2 flex gap-2">
                    <button
                        className="ol-chip inline-flex items-center gap-1.5 rounded-md border ol-border ol-surface-strong px-2 py-1 text-[11px] shadow-sm"
                      onClick={() => {
                        setRenamingChatId(c.id);
                        setRenameTitle(c.title);
                      }}
                      disabled={loading}
                    >
                        <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                        Renommer
                    </button>
                    <button
                        className="ol-chip inline-flex items-center gap-1.5 rounded-md border ol-border ol-surface-strong px-2 py-1 text-[11px] shadow-sm"
                      onClick={() => void deleteChat(c.id)}
                      disabled={loading}
                    >
                        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                        Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex min-h-0 flex-col gap-3">
          <div className="ol-card rounded-2xl border ol-border ol-surface p-4 shadow-sm backdrop-blur">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <div className="ol-accent-gradient grid h-9 w-9 place-items-center rounded-xl text-white shadow-sm">
                    <Bot className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div>
                    <div className="text-lg font-semibold">OptiLens</div>
                    <div className="ol-text-muted text-sm">
                      Multilingue (FR/EN/AR/DZ) • Catalogue DB • Réponses compactes
                    </div>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {props.embed ? null : (
                  <button
                    type="button"
                    className="ol-chip ol-icon-btn inline-flex items-center gap-2 rounded-full border ol-border ol-surface-strong px-3 py-1.5 text-xs shadow-sm"
                    onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                    aria-label="Basculer thème clair/sombre"
                    title="Basculer thème clair/sombre"
                  >
                    {theme === "dark" ? (
                      <Sun className="ol-theme-icon ol-theme-icon--dark h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Moon className="ol-theme-icon ol-theme-icon--light h-4 w-4" aria-hidden="true" />
                    )}
                    <span>{theme === "dark" ? "Sombre" : "Clair"}</span>
                  </button>
                )}

                {loading ? (
                  <div className="inline-flex items-center gap-2 rounded-full border ol-border ol-surface-strong px-3 py-1.5 text-xs ol-text-muted shadow-sm">
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                    <span>En cours</span>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        <div
          ref={scrollRef}
          className={
            props.embed
              ? "ol-scrollbar h-130 overflow-auto rounded-2xl border ol-border ol-surface p-4 shadow-sm backdrop-blur"
              : "ol-scrollbar ol-chat-bg min-h-0 flex-1 overflow-auto rounded-2xl border ol-border shadow-sm"
          }
        >
          <div className={props.embed ? "flex flex-col gap-3" : "flex flex-col"}>
            {messages.map((m, idx) => (
              <div
                key={m.id ?? idx}
                className={
                  m.role === "user"
                    ? "ol-message ol-msg-row ol-msg-row--user"
                    : "ol-message ol-msg-row ol-msg-row--assistant"
                }
                style={{ animationDelay: `${Math.min(idx * 35, 210)}ms` }}
              >
                <div className={props.embed ? "flex items-start gap-2" : "ol-chat-column"}>
                  <div className={m.role === "user" ? "ol-msg-inner justify-end" : "ol-msg-inner"}>
                    {m.role === "assistant" ? (
                      <div className="ol-avatar ol-avatar--assistant mt-0.5">
                        <Bot className="h-4 w-4" aria-hidden="true" />
                      </div>
                    ) : null}

                    <div
                      className={
                        m.role === "user"
                          ? "ol-msg-content flex justify-end"
                          : "ol-msg-content"
                      }
                    >
                      <div
                        className={
                          m.role === "user"
                            ? "ol-bubble-user max-w-[720px] rounded-2xl px-4 py-2 shadow-sm"
                            : "ol-bubble-assistant max-w-[720px] px-0 py-0"
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
                        <span className="inline-flex items-center gap-1.5">
                          <X className="h-3.5 w-3.5" aria-hidden="true" />
                          Annuler
                        </span>
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
                        <div className="ol-msg-actions shrink-0 flex items-center gap-1">
                      {m.role === "user" && m.id && selectedChatId ? (
                        <button
                          type="button"
                          className="ol-chip rounded-md bg-white/10 p-1 hover:bg-white/20"
                          onClick={() => {
                            setEditingMessageId(m.id!);
                            setEditingText(m.content);
                          }}
                          title="Modifier la question"
                          disabled={loading}
                        >
                          <Pencil className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}

                      {m.role === "assistant" ? (
                        <button
                          type="button"
                          className="ol-chip ol-icon-btn rounded-md ol-soft-bg p-1"
                          onClick={() => void copyToClipboard(m.content)}
                          title="Copier la réponse"
                        >
                          <Copy className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}

                      {m.role === "assistant" && m.id && selectedChatId ? (
                        <button
                          type="button"
                          className="ol-chip ol-icon-btn rounded-md ol-soft-bg p-1"
                          onClick={() => void regenerateAnswerFromAssistant(m.id!)}
                          title="Régénérer la réponse"
                          disabled={loading}
                        >
                          <RefreshCcw className="h-4 w-4" aria-hidden="true" />
                        </button>
                      ) : null}
                        </div>
                      </div>
                    )}
                      </div>
                  </div>

                    {m.role === "user" ? (
                      <div className="ol-avatar ol-avatar--user mt-0.5">
                        <User className="h-4 w-4" aria-hidden="true" />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {loading ? (
              <div className="ol-message ol-msg-row ol-msg-row--assistant" style={{ animationDelay: "0ms" }}>
                <div className={props.embed ? "flex items-start gap-2" : "ol-chat-column"}>
                  <div className="ol-msg-inner">
                    <div className="ol-avatar ol-avatar--assistant mt-0.5">
                      <Bot className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="ol-msg-content">
                      <TypingIndicator />
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </div>

        {props.embed ? null : (
          <div className="ol-composer">
            <div className="ol-composer-inner">
              <div className="ol-composer-box p-2">
                <div className="flex items-end gap-2">
                  <textarea
                    className="ol-scrollbar w-full resize-none rounded-2xl border-0 bg-transparent px-3 py-2 text-sm leading-6 outline-none"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Message OptiLens… (Shift+Enter pour une nouvelle ligne)"
                    rows={2}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void send();
                      }
                    }}
                  />
                  {loading ? (
                    <button
                      className="ol-chip ol-icon-btn inline-flex items-center gap-2 rounded-2xl border ol-border ol-surface-strong px-3 py-2 text-sm font-medium shadow-sm"
                      onClick={() => stop()}
                      type="button"
                      title="Stop"
                      aria-label="Stop"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : (
                    <button
                      className={
                        canSend
                          ? "ol-chip ol-icon-btn ol-primary-btn inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium shadow-sm"
                          : "ol-disabled-btn inline-flex items-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium"
                      }
                      onClick={() => void send()}
                      disabled={!canSend}
                      type="button"
                      title="Envoyer"
                      aria-label="Envoyer"
                    >
                      <Send className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-2 text-center text-[11px] ol-text-faint">
                OptiLens peut se tromper. Vérifie le prix/stock avant validation.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
    </div>
  );
}
