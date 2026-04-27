"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Note, X, Sparkle, FloppyDisk, Lightning, Tag } from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { useIdleAttention } from "@/lib/use-idle-attention";
import { toastSuccess, toastInfo, toastError } from "@/lib/toast";

/**
 * Global Quick Note shortcut — Cmd+K (or Ctrl+K on Windows/Linux) opens a
 * lightweight modal anywhere in the app. The user types or pastes a note;
 * if no class is selected, the AI auto-files it into the right one.
 *
 * Mounted ONCE in the app shell so the keyboard shortcut + floating button
 * are available on every authed page.
 */

interface ClassMini {
  id: string;
  name: string;
  shortCode: string | null;
  color: string;
  emoji: string | null;
}

export default function QuickNoteShortcut() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const { attentioned, bind } = useIdleAttention(10_000);

  // Wire up Cmd+K / Ctrl+K. We register on document so any page state can't
  // intercept it; the browser's "find in page" Cmd+F is unaffected.
  useEffect(() => {
    if (!user?.id) return;
    const onKey = (e: KeyboardEvent) => {
      const isCmdK = (e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K");
      if (isCmdK) {
        e.preventDefault();
        setOpen(true);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [user?.id, open]);

  // Hide the button while signed out — quick-note is an authed feature.
  if (!user?.id) return null;

  return (
    <>
      {/* Floating "+" button on every page. Hidden on the smallest mobile
          viewports because the bottom mobile nav already crowds that zone. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Quick note (Cmd+K)"
        {...bind}
        style={{
          opacity: attentioned ? 1 : 0.4,
          filter: attentioned ? "none" : "blur(0.6px)",
        }}
        className="
          fixed z-30 right-4 md:right-6
          bottom-[112px] md:bottom-[88px]
          hidden sm:inline-flex items-center gap-1.5
          rounded-full px-3 py-2
          bg-white/[0.04] hover:bg-white/[0.08]
          border border-white/[0.1] hover:border-white/[0.2]
          font-mono text-[10px] uppercase tracking-[0.22em] text-cream/70 hover:text-cream
          transition-[opacity,filter,background-color,border-color] duration-500 ease-out active:scale-[0.97]
          shadow-lg shadow-black/30
          backdrop-blur-md
        "
      >
        <Note size={12} weight="bold" />
        <span>Quick note</span>
        <span className="font-mono text-[9px] tracking-wider text-cream/40 border-l border-white/[0.15] pl-1.5 ml-0.5">
          ⌘K
        </span>
      </button>

      {open && <QuickNoteModal onClose={() => setOpen(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Modal — load classes, render textarea + class picker, save.
// ─────────────────────────────────────────────────────────────────────────────
function QuickNoteModal({ onClose }: { onClose: () => void }) {
  const { data } = useSWR<{ classes: ClassMini[] }>(
    "/api/classes", swrFetcher,
    { revalidateOnFocus: false },
  );
  const classes = data?.classes ?? [];

  const [text, setText] = useState("");
  // null = "let AI pick"; string = explicit class id; "__unfiled" = save unfiled
  const [classChoice, setClassChoice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // Autofocus on open + handle outside-click
  useEffect(() => {
    setTimeout(() => taRef.current?.focus(), 30);
  }, []);

  const submit = async () => {
    if (submitting) return;
    const cleaned = text.trim();
    if (cleaned.length < 1) return;
    setSubmitting(true);

    const payload: Record<string, unknown> = { body: cleaned };
    if (classChoice !== null) {
      payload.classId = classChoice === "__unfiled" ? null : classChoice;
    }

    try {
      type R = {
        note?: { id: string; classId: string | null };
        aiCategorized?: boolean;
        chosenClassId?: string | null;
        error?: string;
      };
      const r = await apiPost<R>("/api/classes/quick-note", payload);
      if (!r.ok || !r.data) {
        toastError(r.error || "Couldn't save note.");
        setSubmitting(false);
        return;
      }
      // Surface where it landed
      const landedClassId = r.data.note?.classId ?? r.data.chosenClassId ?? null;
      const landedClass = landedClassId ? classes.find(c => c.id === landedClassId) : null;
      if (landedClass) {
        toastSuccess(`Filed under ${landedClass.name}`, { duration: 3000 });
      } else if (r.data.aiCategorized && classes.length > 0) {
        toastInfo("Saved as unfiled — Ninny couldn't match a class.");
      } else {
        toastInfo("Saved as unfiled.");
      }
      onClose();
    } catch (e) {
      toastError((e as Error).message || "Couldn't save note.");
      setSubmitting(false);
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start pt-[12vh] bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="quick-note-title"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-lg rounded-[14px] border border-white/[0.1] bg-gradient-to-br from-navy to-[#0a0f1d] p-5 shadow-2xl animate-slide-up">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-cream/40 hover:text-cream grid place-items-center w-7 h-7 rounded-full hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        <div className="flex items-center gap-2 mb-3">
          <Sparkle size={13} className="text-gold" weight="fill" />
          <span id="quick-note-title" className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Quick note
          </span>
        </div>

        <textarea
          ref={taRef}
          value={text}
          onChange={e => setText(e.target.value.slice(0, 50_000))}
          onKeyDown={onKey}
          placeholder="What did you just learn? Paste a passage. Type a thought. Lionade will file it."
          rows={6}
          className="w-full resize-none rounded-[8px] bg-white/[0.04] border border-white/[0.08]
            focus:border-gold/40 focus:outline-none px-3 py-3 text-[14px] text-cream
            placeholder:text-cream/30 leading-relaxed mb-3"
        />

        {/* Class picker */}
        <div className="mb-4">
          <label className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/40 mb-1.5 block">
            File under
          </label>
          <div className="flex flex-wrap gap-1.5">
            <PickerChip
              active={classChoice === null}
              onClick={() => setClassChoice(null)}
              icon={<Sparkle size={10} weight="fill" />}
              label="Auto (AI picks)"
              accent="#FFD700"
            />
            {classes.map(c => (
              <PickerChip
                key={c.id}
                active={classChoice === c.id}
                onClick={() => setClassChoice(c.id)}
                icon={c.emoji ? <span className="text-[11px]">{c.emoji}</span> : null}
                label={c.shortCode || c.name}
                accent={c.color}
              />
            ))}
            <PickerChip
              active={classChoice === "__unfiled"}
              onClick={() => setClassChoice("__unfiled")}
              icon={<Tag size={10} weight="bold" />}
              label="Unfiled"
              accent="#9CA3AF"
            />
          </div>
        </div>

        <div className="flex items-center justify-between">
          <span className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/30">
            ⌘+Enter to save · Esc to close
          </span>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || text.trim().length < 1}
            className="rounded-full bg-gold hover:bg-gold/90 text-navy
              font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors
              inline-flex items-center gap-1.5"
          >
            {submitting
              ? <><Lightning size={11} weight="fill" />Filing…</>
              : <><FloppyDisk size={11} weight="fill" />Save</>}
          </button>
        </div>
      </div>
    </div>
  );
}

function PickerChip({
  active, onClick, icon, label, accent,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  accent: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`
        inline-flex items-center gap-1.5 rounded-full px-3 py-1.5
        font-mono text-[10px] uppercase tracking-[0.18em]
        border transition-all duration-150
        ${active
          ? "text-cream border-transparent"
          : "text-cream/60 border-white/[0.08] hover:border-white/[0.18] hover:text-cream"}
      `}
      style={active
        ? { backgroundColor: `${accent}1f`, borderColor: `${accent}66` }
        : undefined
      }
    >
      <span style={active ? { color: accent } : undefined}>{icon}</span>
      <span className="truncate max-w-[140px]">{label}</span>
    </button>
  );
}
