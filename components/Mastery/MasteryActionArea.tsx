"use client";

import { useState } from "react";
import { ArrowRight, PaperPlaneTilt } from "@phosphor-icons/react";

/**
 * The bottom-of-chat action area. Its shape depends on what's pending on
 * the server side:
 *   - pending=null              → big "Continue" button → calls /next
 *   - pending.type="question"   → four option buttons → calls /answer
 *   - pending.type="socratic"   → text input → calls /socratic
 *
 * Keeps the chat thread "what's happened" and this area "what can you do
 * right now", so the UI is never ambiguous about whose turn it is.
 */

export interface LiveQuestion {
  questionId: string;
  options: string[];
  subtopicName?: string;
  difficulty?: string;
  challengeToken: string;
}

interface Props {
  pending: { type: "teach" | "question" | "socratic"; [k: string]: unknown } | null;
  liveQuestion: LiveQuestion | null;    // only populated when pending.type === 'question'
  disabled?: boolean;
  onContinue: () => Promise<void> | void;
  onAnswer: (selectedIndex: number) => Promise<void> | void;
  onSocraticSubmit: (reply: string) => Promise<void> | void;
}

export default function MasteryActionArea({
  pending, liveQuestion, disabled, onContinue, onAnswer, onSocraticSubmit,
}: Props) {
  if (pending?.type === "question" && liveQuestion) {
    return <QuestionOptions q={liveQuestion} disabled={disabled} onAnswer={onAnswer} />;
  }
  if (pending?.type === "socratic") {
    return <SocraticInput disabled={disabled} onSubmit={onSocraticSubmit} />;
  }
  return <ContinueButton disabled={disabled} onContinue={onContinue} />;
}

// ── Four option buttons for a live question ─────────────────────────────────
function QuestionOptions({
  q, disabled, onAnswer,
}: { q: LiveQuestion; disabled?: boolean; onAnswer: (i: number) => Promise<void> | void }) {
  const [picked, setPicked] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (i: number) => {
    if (disabled || submitting) return;
    setPicked(i);
    setSubmitting(true);
    try { await onAnswer(i); }
    finally { setSubmitting(false); }
  };

  return (
    <div className="flex flex-col gap-2">
      {q.options.map((opt, i) => {
        const isPicked = i === picked;
        return (
          <button
            key={i}
            onClick={() => submit(i)}
            disabled={disabled || submitting}
            className={`
              group relative flex items-start gap-3 text-left w-full
              rounded-[8px] border px-4 py-3 text-[14px] leading-relaxed
              transition-all duration-200
              ${isPicked
                ? "bg-gold/[0.08] border-gold/40 text-cream"
                : "bg-white/[0.02] border-white/[0.08] hover:border-white/[0.2] hover:bg-white/[0.04] text-cream/90"}
              disabled:opacity-50 disabled:cursor-not-allowed
            `}
          >
            <span className={`
              font-mono text-[10px] uppercase tracking-wider mt-0.5 shrink-0
              ${isPicked ? "text-gold" : "text-cream/40"}
            `}>
              {String.fromCharCode(65 + i)}
            </span>
            <span className="flex-1">{opt}</span>
          </button>
        );
      })}
    </div>
  );
}

// ── Text input for a socratic reply ─────────────────────────────────────────
function SocraticInput({ disabled, onSubmit }: { disabled?: boolean; onSubmit: (reply: string) => Promise<void> | void }) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || submitting) return;
    setSubmitting(true);
    try { await onSubmit(trimmed); setText(""); }
    finally { setSubmitting(false); }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-[#A855F7]/80">
        Your reasoning
      </label>
      <div className="flex gap-2 items-start">
        <textarea
          value={text}
          onChange={e => setText(e.target.value.slice(0, 800))}
          onKeyDown={onKey}
          placeholder="Why did you pick that? One sentence is fine."
          disabled={disabled || submitting}
          rows={3}
          className="
            flex-1 resize-none rounded-[8px] bg-white/[0.03] border border-white/[0.08]
            focus:border-[#A855F7]/50 focus:outline-none
            px-4 py-3 text-[14px] text-cream placeholder:text-cream/30 leading-relaxed
          "
        />
        <button
          onClick={send}
          disabled={disabled || submitting || !text.trim()}
          className="
            shrink-0 rounded-[8px] bg-[#A855F7] hover:bg-[#A855F7]/90
            text-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em]
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors flex items-center gap-2 h-fit
          "
        >
          <PaperPlaneTilt size={14} weight="fill" />
          Send
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/30">
          ⌘+Enter to send · {800 - text.length} chars left
        </span>
      </div>
    </div>
  );
}

// ── Continue button ─────────────────────────────────────────────────────────
function ContinueButton({ disabled, onContinue }: { disabled?: boolean; onContinue: () => Promise<void> | void }) {
  const [loading, setLoading] = useState(false);
  const handle = async () => {
    if (disabled || loading) return;
    setLoading(true);
    try { await onContinue(); }
    finally { setLoading(false); }
  };
  return (
    <div className="flex justify-center">
      <button
        onClick={handle}
        disabled={disabled || loading}
        className="
          group flex items-center gap-2 px-6 py-3 rounded-full
          bg-gold hover:bg-gold/90 text-navy font-mono text-[11px] uppercase tracking-[0.25em]
          disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
        "
      >
        {loading ? "Ninny's thinking…" : "Continue"}
        <ArrowRight size={14} weight="bold" className="transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}
