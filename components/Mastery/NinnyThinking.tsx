"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  pickThinkingAnimation,
  type AnimationProps,
} from "./NinnyThinkingAnimations";
import {
  pickThinkingPhrase,
  type ThinkingContext,
} from "@/lib/mastery/thinking-phrases";
import MasteryNotesScratchpad, { readNotes, type NoteEntry } from "./MasteryNotesScratchpad";
import { X } from "@phosphor-icons/react";

/**
 * Unified "Ninny is thinking..." surface for active Mastery sessions.
 *
 * Bundles: a randomized animation + a context-aware phrase + the inline
 * notes scratchpad. Phrase + animation are chosen ONCE at mount and held
 * via useMemo so re-renders during the busy window don't flicker through
 * three different phrases. The parent (page.tsx) controls remount via a
 * `key` prop tied to a thinking-event id.
 */

interface Props {
  sessionId: string;
  questionId: string | null;
  context: ThinkingContext;
  /** When true, hide the scratchpad (e.g. session ended). */
  hideScratchpad?: boolean;
}

export default function NinnyThinking({
  sessionId, questionId, context, hideScratchpad = false,
}: Props) {
  // Pick once at mount. ESLint rule disabled because we deliberately want a
  // single-roll per mount; the context object reference is recreated each
  // render but we only care about the values at first render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const Animation = useMemo(() => pickThinkingAnimation(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const phrase = useMemo(() => pickThinkingPhrase(context), []);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-3 items-center pl-[40px]" role="status">
        <AnimationFrame Animation={Animation} />
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
          {phrase}
        </span>
      </div>
      {!hideScratchpad && (
        <MasteryNotesScratchpad sessionId={sessionId} questionId={questionId} />
      )}
    </div>
  );
}

function AnimationFrame({ Animation }: { Animation: React.ComponentType<AnimationProps> }) {
  return <Animation size={20} color="#A855F7" />;
}

/**
 * End-of-session notes footer + modal. Renders a single line summarizing
 * how many non-empty notes the user wrote during the session; clicking
 * opens a modal grouped by question.
 *
 * Shown ONLY when the session has ended (caller passes ended=true).
 * Renders nothing if the user wrote zero non-empty notes.
 */
export function MasteryNotesFooter({ sessionId }: { sessionId: string }) {
  const [open, setOpen] = useState(false);
  // Re-read on every render — the user may have typed during the active
  // session, and by the time the session ends the latest notes need to
  // surface. This isn't a hot path (renders once at session end).
  const allNotes: NoteEntry[] = useMemo(() => readNotes(sessionId), [sessionId]);
  const filled = useMemo(
    () => allNotes.filter(n => n.text.trim().length > 0),
    [allNotes],
  );

  if (filled.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="
          mt-3 mx-auto block
          font-mono text-[10px] uppercase tracking-[0.25em]
          text-cream/55 hover:text-cream transition-colors
        "
      >
        You wrote {filled.length} {filled.length === 1 ? "note" : "notes"} during this session. View notes
      </button>

      {open && <NotesModal sessionId={sessionId} notes={filled} onClose={() => setOpen(false)} />}
    </>
  );
}

function NotesModal({
  sessionId, notes, onClose,
}: {
  sessionId: string;
  notes: NoteEntry[];
  onClose: () => void;
}) {
  // Group by questionId (or "no question" bucket).
  const groups = useMemo(() => {
    const map = new Map<string, NoteEntry[]>();
    for (const n of notes) {
      const key = n.questionId ?? "general";
      const arr = map.get(key) ?? [];
      arr.push(n);
      map.set(key, arr);
    }
    return Array.from(map.entries());
  }, [notes]);

  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Focus-first + Tab trap + Escape + focus restore.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeBtnRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Your session notes"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={e => e.stopPropagation()}
        className="
          relative w-full max-w-[520px] max-h-[80vh] overflow-y-auto
          rounded-2xl bg-white/5 backdrop-blur border border-white/10
          p-5
        "
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-bebas text-2xl tracking-wider text-cream">Your notes</h2>
          <button
            ref={closeBtnRef}
            type="button"
            onClick={onClose}
            aria-label="Close notes"
            className="grid place-items-center w-9 h-9 rounded-full text-cream/60 hover:text-cream hover:bg-white/[0.05] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/70"
          >
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <p className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/55 mb-4">
          Session {sessionId.slice(0, 8)} · {notes.length} {notes.length === 1 ? "note" : "notes"}
        </p>

        <div className="space-y-4">
          {groups.map(([key, entries]) => (
            <div key={key} className="rounded-[10px] bg-white/[0.03] border border-white/[0.06] p-3">
              <div className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-[#A855F7] mb-2">
                {key === "general" ? "General" : `Question ${key.slice(0, 8)}`}
              </div>
              <ul className="space-y-2">
                {entries.map((n, i) => (
                  <li key={`${n.at}-${i}`} className="text-[13px] text-cream/85 leading-relaxed whitespace-pre-wrap">
                    {n.text}
                    <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/55 mt-1">
                      {new Date(n.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
