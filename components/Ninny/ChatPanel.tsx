"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiGet, apiPost } from "@/lib/api-client";
import { Robot } from "@phosphor-icons/react";
import type { NinnyChatMessage } from "@/lib/ninny";

interface Props {
  materialId: string;
  materialTitle: string;
  materialSubject: string | null;
}

const NINNY_PURPLE = "#A855F7";
const MAX_INPUT_LENGTH = 2000;

// Suggested starter questions when chat is empty
const STARTER_QUESTIONS = [
  "Explain this in simple terms",
  "What's the most important concept here?",
  "Quiz me on this material",
  "Give me a real-world example",
];

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
}

export default function ChatPanel({ materialId, materialTitle, materialSubject }: Props) {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load history on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const res = await apiGet<{ messages: NinnyChatMessage[] }>(
        `/api/ninny/chat?materialId=${materialId}`,
      );
      if (cancelled) return;
      if (res.ok && res.data) {
        setMessages(
          res.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            content: m.content,
            created_at: m.created_at,
          })),
        );
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [materialId]);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, sending]);

  // Auto-grow textarea
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 140)}px`;
  }, [input]);

  const handleSend = useCallback(
    async (textOverride?: string) => {
      const text = (textOverride ?? input).trim();
      if (!text || sending) return;
      setError(null);
      setSending(true);
      setInput("");

      // Optimistic user message
      const tempUserMsg: UIMessage = {
        id: `temp-${Date.now()}`,
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, tempUserMsg]);

      const res = await apiPost<{
        userMessage: NinnyChatMessage;
        assistantMessage: NinnyChatMessage;
      }>("/api/ninny/chat", { materialId, message: text });

      if (!res.ok || !res.data) {
        setError(res.error ?? "Ninny didn't respond. Try again.");
        // Remove the optimistic message on failure
        setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      } else {
        // Replace optimistic with real, append assistant
        setMessages((prev) => [
          ...prev.filter((m) => m.id !== tempUserMsg.id),
          {
            id: res.data!.userMessage.id,
            role: "user",
            content: res.data!.userMessage.content,
            created_at: res.data!.userMessage.created_at,
          },
          {
            id: res.data!.assistantMessage.id,
            role: "assistant",
            content: res.data!.assistantMessage.content,
            created_at: res.data!.assistantMessage.created_at,
          },
        ]);
      }
      setSending(false);
      // Refocus input for fast follow-up
      requestAnimationFrame(() => inputRef.current?.focus());
    },
    [input, sending, materialId],
  );

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const isEmpty = !loading && messages.length === 0;

  return (
    <div className="w-full max-w-2xl mx-auto animate-slide-up flex flex-col" style={{ minHeight: "70vh" }}>
      {/* Chat surface */}
      <div
        ref={scrollRef}
        className="flex-1 rounded-2xl border-2 backdrop-blur p-5 sm:p-6 mb-3 overflow-y-auto"
        style={{
          background: "rgba(255,255,255,0.04)",
          borderColor: `${NINNY_PURPLE}25`,
          maxHeight: "60vh",
        }}
      >
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <div
              className="w-6 h-6 rounded-full border-2 animate-spin"
              style={{
                borderColor: `${NINNY_PURPLE}30`,
                borderTopColor: NINNY_PURPLE,
              }}
            />
          </div>
        ) : isEmpty ? (
          <div className="text-center py-6 sm:py-10">
            <div
              className="w-14 h-14 rounded-full inline-flex items-center justify-center mb-4"
              style={{
                background: `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
                boxShadow: `0 0 30px ${NINNY_PURPLE}33`,
                color: NINNY_PURPLE,
              }}
            >
              <Robot size={32} weight="regular" aria-hidden="true" />
            </div>
            <p className="font-bebas text-cream text-2xl tracking-wider mb-2">
              Ask Me Anything
            </p>
            <p
              className="font-syne text-sm max-w-md mx-auto leading-relaxed mb-6"
              style={{ color: `${NINNY_PURPLE}CC` }}
            >
              I&apos;ll only answer based on{" "}
              <span className="text-cream font-semibold">{materialTitle}</span>
              {materialSubject ? ` (${materialSubject})` : ""}. Try one of these:
            </p>
            <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
              {STARTER_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => handleSend(q)}
                  className="px-3 py-1.5 rounded-full font-syne text-xs
                    border bg-white/5 hover:bg-white/10 text-cream/80 hover:text-cream
                    transition-all active:scale-95"
                  style={{ borderColor: `${NINNY_PURPLE}40` }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {messages.map((msg) => (
              <ChatBubble key={msg.id} role={msg.role} content={msg.content} />
            ))}
            {sending && <TypingIndicator />}
          </div>
        )}
      </div>

      {error && (
        <div
          className="rounded-xl border px-4 py-2.5 mb-2 animate-slide-up"
          style={{
            background: "rgba(239,68,68,0.08)",
            borderColor: "rgba(239,68,68,0.30)",
          }}
        >
          <p className="text-red-400 text-xs font-syne">{error}</p>
        </div>
      )}

      {/* Input bar */}
      <div
        className="rounded-2xl border bg-white/5 backdrop-blur p-3 flex items-end gap-2"
        style={{ borderColor: `${NINNY_PURPLE}25` }}
      >
        <textarea
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value.slice(0, MAX_INPUT_LENGTH))}
          onKeyDown={handleKeyDown}
          placeholder="Ask Ninny about this material..."
          rows={1}
          disabled={sending}
          className="flex-1 bg-transparent text-cream placeholder:text-cream/30
            font-syne text-sm resize-none focus:outline-none px-2 py-2 leading-snug
            disabled:opacity-50"
          style={{ minHeight: "36px", maxHeight: "140px" }}
          autoFocus
        />
        <button
          onClick={() => handleSend()}
          disabled={!input.trim() || sending}
          className="shrink-0 w-10 h-10 rounded-xl flex items-center justify-center
            transition-all duration-200 active:scale-95
            disabled:opacity-30 disabled:cursor-not-allowed
            hover:brightness-110"
          style={{
            background: input.trim() && !sending
              ? "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)"
              : "rgba(255,255,255,0.06)",
            color: input.trim() && !sending ? "#04080F" : "rgba(238,244,255,0.40)",
            boxShadow: input.trim() && !sending ? "0 0 18px rgba(255,215,0,0.30)" : "none",
          }}
          aria-label="Send message"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            fill="currentColor"
            className="w-5 h-5"
          >
            <path d="M3.4 20.4 20.85 12.92a1 1 0 0 0 0-1.84L3.4 3.6a1 1 0 0 0-1.39 1.16l1.85 6.1a1 1 0 0 0 .86.71l8.94.85a.18.18 0 0 1 0 .36l-8.94.85a1 1 0 0 0-.86.71l-1.85 6.1a1 1 0 0 0 1.39 1.16Z" />
          </svg>
        </button>
      </div>

      {/* Subtle hint */}
      <p className="font-syne text-cream/30 text-[10px] text-center mt-2">
        Enter to send · Shift+Enter for newline
      </p>
    </div>
  );
}

// ─── Subcomponents ─────────────────────────────────────────────────────────

function ChatBubble({ role, content }: { role: "user" | "assistant"; content: string }) {
  const isUser = role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-slide-up`}>
      <div className="flex items-start gap-2 max-w-[85%]">
        {!isUser && (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
            style={{
              background: `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
              boxShadow: `0 0 0 1px ${NINNY_PURPLE}40`,
              color: NINNY_PURPLE,
            }}
          >
            <Robot size={18} weight="regular" aria-hidden="true" />
          </div>
        )}
        <div
          className="rounded-2xl px-4 py-2.5 font-syne text-sm leading-relaxed whitespace-pre-wrap"
          style={
            isUser
              ? {
                  background: "linear-gradient(135deg, rgba(255,215,0,0.18) 0%, rgba(240,192,0,0.10) 100%)",
                  border: "1px solid rgba(255,215,0,0.30)",
                  color: "#EEF4FF",
                }
              : {
                  background: `${NINNY_PURPLE}10`,
                  border: `1px solid ${NINNY_PURPLE}25`,
                  color: "#EEF4FF",
                }
          }
        >
          {content}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div className="flex justify-start animate-slide-up">
      <div className="flex items-start gap-2">
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5"
          style={{
            background: `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
            boxShadow: `0 0 0 1px ${NINNY_PURPLE}40`,
            color: NINNY_PURPLE,
          }}
        >
          <Robot size={18} weight="regular" aria-hidden="true" />
        </div>
        <div
          className="rounded-2xl px-4 py-3 flex items-center gap-1.5"
          style={{
            background: `${NINNY_PURPLE}10`,
            border: `1px solid ${NINNY_PURPLE}25`,
          }}
        >
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: NINNY_PURPLE, animationDelay: "0ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: NINNY_PURPLE, animationDelay: "200ms" }}
          />
          <span
            className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ background: NINNY_PURPLE, animationDelay: "400ms" }}
          />
        </div>
      </div>
    </div>
  );
}
