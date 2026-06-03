"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Inline scratchpad shown beneath the "Ninny is thinking" indicator.
 *
 * Each MOUNT (i.e. each new "thinking" event) appends a fresh empty note
 * entry to localStorage. The user can type into the textarea — every
 * keystroke debounces to 400ms before persisting to keep us off the main
 * thread.
 *
 * Persistence at V1 is localStorage only. Server persistence is queued as
 * a separate spec (see vault Daily/2026-06-03 under "Mastery thinking-state V1").
 *
 * Keys: `mastery_notes_<sessionId>` → JSON-serialized NoteEntry[]
 */

export type NoteEntry = {
  at: string;            // ISO timestamp
  text: string;          // user-typed text (trimmed at read time)
  questionId: string | null;
};

const STORAGE_PREFIX = "mastery_notes_";
const DEBOUNCE_MS = 400;
const MAX_LEN = 600;

/** Storage helpers — every read/write wrapped so quota or parse failures never crash the UI. */
function storageKey(sessionId: string): string {
  return `${STORAGE_PREFIX}${sessionId}`;
}

export function readNotes(sessionId: string): NoteEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(sessionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    // Filter to entries we recognize; tolerate older shapes silently.
    return parsed.filter(
      (e): e is NoteEntry =>
        e
        && typeof e === "object"
        && typeof e.at === "string"
        && typeof e.text === "string"
        && (e.questionId === null || typeof e.questionId === "string"),
    );
  } catch {
    // SecurityError (Safari private mode), SyntaxError (corrupt JSON), etc.
    return [];
  }
}

function writeNotes(sessionId: string, notes: NoteEntry[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(storageKey(sessionId), JSON.stringify(notes));
    return true;
  } catch {
    // QuotaExceededError, SecurityError. We don't surface this to the user —
    // notes are best-effort at V1. Future spec adds server persistence.
    return false;
  }
}

/** Append a fresh empty entry on mount; return the index of the new entry. */
function appendBlankEntry(sessionId: string, questionId: string | null): number {
  const prev = readNotes(sessionId);
  const next = [...prev, { at: new Date().toISOString(), text: "", questionId }];
  writeNotes(sessionId, next);
  return next.length - 1;
}

interface Props {
  sessionId: string;
  questionId: string | null;
}

export default function MasteryNotesScratchpad({ sessionId, questionId }: Props) {
  // Index of THIS scratchpad's entry within the session's note list. Set
  // once on mount via a ref-init function so we don't re-append on rerender.
  const entryIndexRef = useRef<number>(-1);
  const [text, setText] = useState("");
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // On mount: create the empty entry. NB: useEffect (not useState init) so
  // we don't write during render in Strict Mode double-invoke.
  useEffect(() => {
    entryIndexRef.current = appendBlankEntry(sessionId, questionId);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
    // sessionId + questionId only matter at mount; we want exactly one entry per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = useCallback((newText: string) => {
    if (entryIndexRef.current < 0) return;
    const notes = readNotes(sessionId);
    const idx = entryIndexRef.current;
    if (idx >= notes.length) return; // someone cleared storage mid-session
    notes[idx] = { ...notes[idx], text: newText.slice(0, MAX_LEN) };
    writeNotes(sessionId, notes);
  }, [sessionId]);

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value.slice(0, MAX_LEN);
    setText(v);

    // Auto-grow via inline style (4-line cap handled by CSS max-height + overflow).
    const ta = e.target;
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 96)}px`; // 96px ≈ 4 lines @ ~24px line-height

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => persist(v), DEBOUNCE_MS);
  };

  return (
    <div className="mt-2 ml-[40px] max-w-[420px] rounded-[10px] bg-white/[0.04] backdrop-blur border border-white/[0.08] px-3 py-2">
      <label htmlFor={`mastery-note-${sessionId}-${entryIndexRef.current}`} className="sr-only">
        Quick note for this question (saved locally for end of session review)
      </label>
      <textarea
        id={`mastery-note-${sessionId}-${entryIndexRef.current}`}
        value={text}
        onChange={onChange}
        rows={1}
        placeholder="Quick note about that one... (saved for end of session)"
        className="
          w-full resize-none bg-transparent outline-none
          text-[12px] leading-[1.5] text-cream/85 placeholder:text-cream/35
          font-syne
        "
        style={{ maxHeight: 96, overflowY: "auto" }}
        // Explicitly opt out of mount-time focus stealing — the parent's
        // socratic input should remain the active element.
        autoFocus={false}
      />
    </div>
  );
}
