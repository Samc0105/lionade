"use client";

import { useState } from "react";
import { ArrowRight, ArrowClockwise, Check, X, Spinner, PawPrint } from "@phosphor-icons/react";
import { apiPost } from "@/lib/api-client";

interface Question {
  bullet: string;
  ask: string;
}

interface Props {
  sessionId: string;
  questionIndex: number;
  total: number;
  question: Question;
  /** Already-accepted improved bullet for this question, if any. */
  initialImproved?: string;
  onAccept: (improved: string) => void;
  onSkip: () => void;
}

/**
 * One Socratic exchange:
 *   1. Show the original bullet + Ninny's question.
 *   2. User types a response → "Ask Ninny to rewrite".
 *   3. Show the improved bullet → Accept | Counter (=clear, rewrite) | Reject (skip).
 *
 * Accept fires onAccept(improved) which advances the parent through
 * the question stack. Skip advances WITHOUT recording an improvement.
 */
export default function SocraticBubble({
  sessionId,
  questionIndex,
  total,
  question,
  initialImproved,
  onAccept,
  onSkip,
}: Props) {
  const [response, setResponse] = useState("");
  const [improved, setImproved] = useState<string | null>(initialImproved ?? null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestRewrite() {
    if (response.trim().length < 2) {
      setError("Give Ninny something to work with — even a sentence is enough.");
      return;
    }
    setError(null);
    setBusy(true);
    const { ok, data, error: apiErr } = await apiPost<{ improvedBullet: string }>(
      "/api/coach/resume/answer",
      {
        sessionId,
        questionIndex,
        userResponse: response.trim(),
      },
    );
    setBusy(false);
    if (!ok || !data?.improvedBullet) {
      setError(apiErr ?? "Ninny couldn't rewrite that. Try again.");
      return;
    }
    setImproved(data.improvedBullet);
  }

  function counter() {
    setImproved(null);
    setError(null);
    // Keep `response` so the user can edit it instead of retyping
  }

  return (
    <div
      className="bg-white/5 backdrop-blur border border-white/10 rounded-2xl p-6 animate-slide-up"
      style={{ animationDelay: "0.04s" }}
    >
      {/* Header with question counter */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <PawPrint size={18} weight="fill" color="#A855F7" aria-hidden="true" />
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-[#A855F7]/80">
            ninny&rsquo;s ask
          </p>
        </div>
        <p className="font-mono text-[11px] tabular-nums text-cream/55">
          {questionIndex + 1} / {total}
        </p>
      </div>

      {/* Original bullet */}
      <div className="mb-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45 mb-1.5">
          your bullet
        </p>
        <p className="font-syne text-sm text-cream/85 italic border-l-2 border-white/10 pl-3 py-0.5">
          &ldquo;{question.bullet}&rdquo;
        </p>
      </div>

      {/* Ninny's ask */}
      <div className="mb-5">
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-[#A855F7]/70 mb-1.5">
          ninny asks
        </p>
        <p className="font-syne text-base text-cream leading-snug">{question.ask}</p>
      </div>

      {/* Either: response form OR improved-bullet review */}
      {improved == null ? (
        <>
          <label className="block">
            <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/55">
              your answer
            </span>
            <textarea
              value={response}
              onChange={(e) => setResponse(e.target.value)}
              rows={3}
              maxLength={1500}
              placeholder="Tell Ninny what actually happened — numbers, scale, outcome…"
              className="mt-1.5 w-full rounded-xl px-3 py-2.5 bg-white/[0.04] border border-white/10 text-cream font-syne text-sm placeholder:text-cream/35 focus:outline-none focus:ring-2 focus:ring-electric/60 resize-none"
              disabled={busy}
            />
          </label>

          {error && (
            <p role="alert" className="mt-2 font-syne text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="font-syne text-xs uppercase tracking-[0.15em] text-cream/55 hover:text-cream transition-colors disabled:opacity-50"
            >
              skip this one
            </button>
            <button
              type="button"
              onClick={requestRewrite}
              disabled={busy || response.trim().length < 2}
              className="btn-gold inline-flex items-center gap-2 px-5 py-2.5 rounded-full font-syne font-bold text-xs uppercase tracking-[0.15em] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {busy ? (
                <>
                  <Spinner size={14} weight="bold" aria-hidden="true" className="animate-spin" />
                  Rewriting
                </>
              ) : (
                <>
                  Ask Ninny to rewrite
                  <ArrowRight size={14} weight="bold" aria-hidden="true" />
                </>
              )}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="rounded-xl px-4 py-3.5 border border-gold/30 bg-gold/[0.06]">
            <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-gold/80 mb-1.5">
              ninny&rsquo;s rewrite
            </p>
            <p className="font-syne text-base text-cream leading-snug">{improved}</p>
          </div>

          {error && (
            <p role="alert" className="mt-2 font-syne text-xs text-red-300">
              {error}
            </p>
          )}

          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => onAccept(improved)}
              className="btn-gold inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-syne font-bold text-xs uppercase tracking-[0.15em]"
            >
              <Check size={14} weight="bold" aria-hidden="true" />
              Accept
            </button>
            <button
              type="button"
              onClick={counter}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-syne font-semibold text-xs uppercase tracking-[0.15em] border border-white/15 text-cream/85 hover:bg-white/[0.04] transition-colors"
            >
              <ArrowClockwise size={14} weight="bold" aria-hidden="true" />
              Counter
            </button>
            <button
              type="button"
              onClick={onSkip}
              className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-full font-syne font-semibold text-xs uppercase tracking-[0.15em] border border-white/10 text-cream/55 hover:text-cream hover:bg-white/[0.03] transition-colors"
            >
              <X size={14} weight="bold" aria-hidden="true" />
              Reject
            </button>
          </div>
        </>
      )}
    </div>
  );
}
