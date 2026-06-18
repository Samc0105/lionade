"use client";

import { useEffect, useId, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { ArrowRight, PaperPlaneTilt } from "@phosphor-icons/react";
import Confetti from "@/components/Confetti";
import { pickThinkingPhrase } from "@/lib/mastery/thinking-phrases";

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

/**
 * Optional return shape from onAnswer — when present, the option-card animation
 * uses it to flash green (correct) or shake red (wrong). The page's doAnswer
 * already has these from the /answer response, so it just propagates them.
 *
 * On a failed submit the page returns `{ ok: false }` so the option body can
 * clear its picked/outcome state and re-enable the buttons for a retry (instead
 * of stranding the user with permanently-disabled options). A successful submit
 * returns the AnswerOutcome (wasCorrect + correctIndex) for the reveal animation.
 */
export type AnswerOutcome = { wasCorrect: boolean; correctIndex: number };
export type AnswerResult = AnswerOutcome | { ok: false } | void;

interface Props {
  pending: { type: "teach" | "question" | "socratic"; [k: string]: unknown } | null;
  liveQuestion: LiveQuestion | null;    // only populated when pending.type === 'question'
  disabled?: boolean;
  onContinue: () => Promise<void> | void;
  onAnswer: (selectedIndex: number) => Promise<AnswerResult> | AnswerResult;
  onSocraticSubmit: (reply: string) => Promise<void> | void;
  /**
   * Optional initial value for the socratic textarea. Used by the parent page
   * to restore a partial reply persisted via /api/mastery/sessions/:id/state
   * across a refresh. Re-applied any time the value changes (e.g. on
   * page-mount GET resolution).
   */
  socraticInitial?: string;
  /**
   * Fires on every keystroke inside the socratic textarea. Parent debounces
   * + POSTs to /api/mastery/sessions/:id/state so a refresh can restore.
   */
  onSocraticChange?: (text: string) => void;
}

export default function MasteryActionArea({
  pending, liveQuestion, disabled, onContinue, onAnswer, onSocraticSubmit,
  socraticInitial, onSocraticChange,
}: Props) {
  if (pending?.type === "question" && liveQuestion) {
    return <QuestionOptions q={liveQuestion} disabled={disabled} onAnswer={onAnswer} />;
  }
  if (pending?.type === "socratic") {
    return (
      <SocraticInput
        disabled={disabled}
        onSubmit={onSocraticSubmit}
        initialValue={socraticInitial}
        onChange={onSocraticChange}
      />
    );
  }
  return <ContinueButton disabled={disabled} onContinue={onContinue} />;
}

// ── Four option buttons for a live question ─────────────────────────────────
// The wrapper just keys the body by questionId so all per-question state
// (picked, outcome, submitting) resets cleanly when the next question arrives.
function QuestionOptions(props: {
  q: LiveQuestion;
  disabled?: boolean;
  onAnswer: (i: number) => Promise<AnswerResult> | AnswerResult;
}) {
  return <QuestionOptionsBody key={props.q.questionId} {...props} />;
}

function QuestionOptionsBody({
  q, disabled, onAnswer,
}: {
  q: LiveQuestion;
  disabled?: boolean;
  onAnswer: (i: number) => Promise<AnswerResult> | AnswerResult;
}) {
  const [picked, setPicked] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState<AnswerOutcome | null>(null);
  const reducedMotion = useReducedMotion();

  const onPick = async (i: number) => {
    if (disabled || submitting || picked !== null) return;
    setPicked(i);
    setSubmitting(true);
    try {
      const result = await onAnswer(i);
      if (result && typeof result === "object" && "wasCorrect" in result) {
        setOutcome(result);
      } else if (result && typeof result === "object" && "ok" in result && result.ok === false) {
        // Submit failed (network / 401 / 409 / 500). The page surfaced the
        // error banner; here we reset the per-question UI so the options
        // re-enable and the user can retry their pick.
        setPicked(null);
        setOutcome(null);
      }
    } catch {
      // onAnswer threw — same recovery path: re-enable the buttons.
      setPicked(null);
      setOutcome(null);
    } finally { setSubmitting(false); }
  };

  return (
    <div className="relative flex flex-col gap-2">
      {q.options.map((opt, i) => {
        const isPicked = i === picked;
        const revealed = outcome !== null && picked !== null;
        const isCorrectReveal = revealed && isPicked && outcome.wasCorrect;
        const isWrongReveal = revealed && isPicked && !outcome.wasCorrect;
        const isCorrectIndexReveal = revealed && i === outcome.correctIndex && i !== picked;

        const animateProps = reducedMotion
          ? undefined
          : isCorrectReveal
            ? { scale: [1, 1.04, 1] }
            : isWrongReveal
              ? { x: [0, -6, 6, -4, 4, 0] }
              : undefined;

        const transitionProps = isCorrectReveal
          ? { duration: 0.25, ease: "easeOut" as const }
          : isWrongReveal
            ? { duration: 0.28, ease: "easeOut" as const }
            : undefined;

        const interactiveAnims = picked === null && !disabled && !reducedMotion
          ? { whileHover: { y: -2 }, whileTap: { scale: 0.98 } }
          : {};

        // Color state: pre-reveal uses the original gold-on-pick styling. Post-
        // reveal, the picked card flashes green or red, and the actually-correct
        // card subtly highlights green even if not picked.
        const stateClasses = isCorrectReveal
          ? "bg-[#22C55E]/[0.10] border-[#22C55E]/60 text-cream"
          : isWrongReveal
            ? "bg-[#EF4444]/[0.10] border-[#EF4444]/60 text-cream"
            : isCorrectIndexReveal
              ? "bg-[#22C55E]/[0.06] border-[#22C55E]/40 text-cream"
              : isPicked
                ? "bg-gold/[0.08] border-gold/40 text-cream"
                : "bg-white/[0.02] border-white/[0.08] hover:border-white/[0.2] hover:bg-white/[0.04] text-cream/90";

        const labelClass = isCorrectReveal || isCorrectIndexReveal
          ? "text-[#22C55E]"
          : isWrongReveal
            ? "text-[#EF4444]"
            : isPicked
              ? "text-gold"
              : "text-cream/60";

        const letter = String.fromCharCode(65 + i);
        const revealSuffix = isCorrectReveal || isCorrectIndexReveal
          ? " (correct answer)"
          : isWrongReveal
            ? " (your answer, incorrect)"
            : "";

        return (
          <motion.button
            key={i}
            type="button"
            onClick={() => onPick(i)}
            disabled={disabled || picked !== null}
            aria-label={`Option ${letter}: ${opt}${revealSuffix}`}
            className={`
              group relative flex items-start gap-3 text-left w-full min-h-[44px]
              rounded-[8px] border px-4 py-3 text-[14px] leading-relaxed
              transition-colors duration-200
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-1 focus-visible:ring-offset-navy
              ${stateClasses}
              disabled:cursor-not-allowed
            `}
            animate={animateProps}
            transition={transitionProps}
            {...interactiveAnims}
          >
            <span aria-hidden="true" className={`
              font-mono text-[10px] uppercase tracking-wider mt-0.5 shrink-0
              ${labelClass}
            `}>
              {letter}
            </span>
            <span className="flex-1">{opt}</span>
          </motion.button>
        );
      })}

      {/* Screen-reader announcement of the result the instant /answer resolves. */}
      <span aria-live="assertive" className="sr-only">
        {outcome
          ? outcome.wasCorrect
            ? "Correct."
            : `Incorrect. The correct answer was option ${String.fromCharCode(65 + outcome.correctIndex)}.`
          : ""}
      </span>

      {outcome?.wasCorrect && !reducedMotion && (
        <Confetti
          key={`mastery-correct-${q.questionId}`}
          trigger={true}
          count={30}
          origin="center"
          palette={["#22C55E", "#FFD700", "#4ADE80"]}
          duration={1200}
        />
      )}
    </div>
  );
}

// ── Text input for a socratic reply ─────────────────────────────────────────
function SocraticInput({
  disabled, onSubmit, initialValue, onChange,
}: {
  disabled?: boolean;
  onSubmit: (reply: string) => Promise<void> | void;
  initialValue?: string;
  onChange?: (text: string) => void;
}) {
  const [text, setText] = useState(initialValue ?? "");
  const [submitting, setSubmitting] = useState(false);
  const fieldId = useId();
  const hintId = useId();

  // Re-sync ONCE when an initialValue arrives async (e.g. /state GET resolved
  // after the component mounted with `""`). We only adopt the server value
  // when the local textarea is still empty so we never clobber whatever the
  // user has already typed.
  const hydratedRef = useRef(false);
  useEffect(() => {
    if (hydratedRef.current) return;
    if (initialValue && text === "") {
      hydratedRef.current = true;
      setText(initialValue);
    }
  }, [initialValue, text]);

  const updateText = (next: string) => {
    const clamped = next.slice(0, 800);
    setText(clamped);
    onChange?.(clamped);
  };

  const send = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || submitting) return;
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
      // Only clear on success. onSubmit throws on a failed /socratic call so
      // the typed reasoning stays put for a retry (the page also surfaces an
      // inline error banner).
      setText("");
      onChange?.("");
    } catch {
      // Submit failed — keep the textarea populated. Swallow so there's no
      // unhandled rejection; the page already showed the error.
    } finally { setSubmitting(false); }
  };

  const canSend = !disabled && !submitting && text.trim().length > 0;

  // shift+enter inserts newline; isComposing guards IME (JP/CN/KR) so Enter doesn't fire mid-composition
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      if (canSend) send();
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label
        htmlFor={fieldId}
        className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-[#A855F7]"
      >
        Your reasoning
      </label>
      <div className="flex gap-2 items-start">
        <textarea
          id={fieldId}
          value={text}
          onChange={e => updateText(e.target.value)}
          onKeyDown={onKey}
          placeholder="Why did you pick that? One sentence is fine."
          disabled={disabled || submitting}
          rows={3}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={hintId}
          className="
            flex-1 resize-none rounded-[8px] bg-white/[0.03] border border-white/[0.08]
            focus:border-[#A855F7]/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/60
            px-4 py-3 text-[14px] text-cream placeholder:text-cream/45 leading-relaxed
          "
        />
        <button
          type="button"
          onClick={send}
          disabled={disabled || submitting || !text.trim()}
          className="
            shrink-0 min-h-[44px] rounded-[8px] bg-[#A855F7] hover:bg-[#A855F7]/90
            text-white px-4 py-3 font-mono text-[11px] uppercase tracking-[0.2em]
            disabled:opacity-40 disabled:cursor-not-allowed
            transition-colors flex items-center gap-2
            focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/70 focus-visible:ring-offset-1 focus-visible:ring-offset-navy
          "
        >
          <PaperPlaneTilt size={14} weight="fill" aria-hidden="true" />
          Send
        </button>
      </div>
      <div className="flex items-center justify-between">
        <span id={hintId} className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/55">
          Enter to send · Shift+Enter for newline · {800 - text.length} chars left
        </span>
      </div>
    </div>
  );
}

// ── Continue button ─────────────────────────────────────────────────────────
function ContinueButton({ disabled, onContinue }: { disabled?: boolean; onContinue: () => Promise<void> | void }) {
  const [loading, setLoading] = useState(false);
  // Pinned phrase per "loading" window — picked once when loading flips true
  // so the button label doesn't churn through phrases on every render. New
  // press → new phrase.
  const phraseRef = useRef<string>("Ninny's thinking…");
  const handle = async () => {
    if (disabled || loading) return;
    phraseRef.current = pickThinkingPhrase();
    setLoading(true);
    try { await onContinue(); }
    finally { setLoading(false); }
  };
  return (
    <div className="flex justify-center">
      <button
        type="button"
        onClick={handle}
        disabled={disabled || loading}
        aria-busy={loading}
        aria-label={loading ? "Ninny is thinking" : "Continue"}
        className="
          group flex items-center gap-2 min-h-[44px] px-6 py-3 rounded-full
          bg-gold hover:bg-gold/90 text-navy font-mono text-[11px] uppercase tracking-[0.25em]
          disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy
        "
      >
        {loading ? phraseRef.current : "Continue"}
        <ArrowRight size={14} weight="bold" aria-hidden="true" className="transition-transform group-hover:translate-x-0.5" />
      </button>
    </div>
  );
}
