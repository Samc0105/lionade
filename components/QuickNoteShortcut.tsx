"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Note, X, Sparkle, FloppyDisk, Lightning, Tag, Minus } from "@phosphor-icons/react";
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

  // useAuth seeds `user` from localStorage on the client, so SSR renders
  // null and the first client render can render the button — that's a
  // hydration mismatch. Defer auth-driven render until after mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

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
  // Also gate on mount to keep SSR HTML and first client render in sync.
  if (!mounted || !user?.id) return null;

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

      {open && <QuickNotePanel onClose={() => setOpen(false)} />}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Panel — a draggable / resizable / minimizable FLOATING window (not a modal).
//
// Deliberately NOT a screen-dimming modal: there's no backdrop and no blur,
// because people read the page while taking notes — the content behind must
// stay clear and usable. So:
//   - Drag it anywhere (grab the header bar).
//   - Resize smaller via the bottom-right handle (current size is the max).
//   - Minimize to just the header bar.
//   - Position / size / minimized persist across opens.
//   - Clicking outside does NOT close it (no overlay to click); close via X.
// ─────────────────────────────────────────────────────────────────────────────
const PANEL_KEY = "lionade-quicknote-panel";
const MIN_W = 300;
const MAX_W = 512; // = max-w-lg, the "biggest" size Sam wants kept as the cap
const MIN_H = 260;
const MAX_H = 680;

interface PanelLayout {
  x: number;
  y: number;
  w: number;
  h: number;
  minimized: boolean;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function QuickNotePanel({ onClose }: { onClose: () => void }) {
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

  // ── Floating-panel layout: position, size, minimized (all persisted) ──
  const [layout, setLayout] = useState<PanelLayout>(() => {
    const fallback: PanelLayout = { x: -1, y: -1, w: MAX_W, h: 380, minimized: false };
    if (typeof window === "undefined") return fallback;
    try {
      const raw = localStorage.getItem(PANEL_KEY);
      if (raw) {
        const p = JSON.parse(raw) as Partial<PanelLayout>;
        return {
          x: typeof p.x === "number" ? p.x : -1,
          y: typeof p.y === "number" ? p.y : -1,
          w: clamp(p.w ?? MAX_W, MIN_W, MAX_W),
          h: clamp(p.h ?? 380, MIN_H, MAX_H),
          minimized: !!p.minimized,
        };
      }
    } catch { /* ignore */ }
    return fallback;
  });

  // First open with no saved position: center horizontally near the top.
  useEffect(() => {
    if (layout.x === -1 || layout.y === -1) {
      setLayout((l) => ({
        ...l,
        x: clamp(Math.round((window.innerWidth - l.w) / 2), 8, window.innerWidth - l.w - 8),
        y: Math.round(window.innerHeight * 0.12),
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist layout.
  useEffect(() => {
    try { localStorage.setItem(PANEL_KEY, JSON.stringify(layout)); } catch { /* ignore */ }
  }, [layout]);

  // Drag (from the header) + resize (from the bottom-right handle) via pointer
  // events. We stash the gesture origin in a ref and listen on window so the
  // drag keeps tracking even if the pointer leaves the panel.
  const gesture = useRef<
    | { kind: "drag" | "resize"; px: number; py: number; ox: number; oy: number; ow: number; oh: number }
    | null
  >(null);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;
      const dx = e.clientX - g.px;
      const dy = e.clientY - g.py;
      if (g.kind === "drag") {
        setLayout((l) => ({
          ...l,
          x: clamp(g.ox + dx, 8, window.innerWidth - l.w - 8),
          y: clamp(g.oy + dy, 8, window.innerHeight - 48),
        }));
      } else {
        setLayout((l) => ({
          ...l,
          w: clamp(g.ow + dx, MIN_W, MAX_W),
          h: clamp(g.oh + dy, MIN_H, MAX_H),
        }));
      }
    };
    const onUp = () => { gesture.current = null; };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  const startDrag = (e: React.PointerEvent) => {
    // Don't start a drag from interactive header controls (buttons).
    if ((e.target as HTMLElement).closest("button")) return;
    gesture.current = { kind: "drag", px: e.clientX, py: e.clientY, ox: layout.x, oy: layout.y, ow: layout.w, oh: layout.h };
  };
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation();
    gesture.current = { kind: "resize", px: e.clientX, py: e.clientY, ox: layout.x, oy: layout.y, ow: layout.w, oh: layout.h };
  };

  const toggleMinimize = () => setLayout((l) => ({ ...l, minimized: !l.minimized }));

  // Position not resolved yet (pre-mount centering) — render nothing for a frame.
  if (layout.x === -1 || layout.y === -1) return null;

  return (
    <div
      role="dialog"
      aria-label="Quick note"
      aria-labelledby="quick-note-title"
      className="fixed z-50 rounded-[14px] border border-white/[0.12] bg-gradient-to-br from-navy to-[#0a0f1d] shadow-2xl shadow-black/50 flex flex-col overflow-hidden animate-slide-up"
      style={{
        left: layout.x,
        top: layout.y,
        width: layout.w,
        height: layout.minimized ? undefined : layout.h,
      }}
    >
      {/* Drag handle / header */}
      <div
        onPointerDown={startDrag}
        className="flex items-center justify-between gap-2 px-4 py-2.5 cursor-grab active:cursor-grabbing border-b border-white/[0.06] select-none shrink-0"
      >
        <div className="flex items-center gap-2">
          <Sparkle size={13} className="text-gold" weight="fill" />
          <span id="quick-note-title" className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Quick note
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={toggleMinimize}
            aria-label={layout.minimized ? "Expand" : "Minimize"}
            className="grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.06]"
          >
            <Minus size={13} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.05]"
          >
            <X size={13} weight="bold" />
          </button>
        </div>
      </div>

      {/* Body — hidden when minimized */}
      {!layout.minimized && (
        <QuickNoteBody
          text={text}
          setText={setText}
          taRef={taRef}
          onKey={onKey}
          classes={classes}
          classChoice={classChoice}
          setClassChoice={setClassChoice}
          submit={submit}
          submitting={submitting}
        />
      )}

      {/* Resize handle (bottom-right). Hidden while minimized. */}
      {!layout.minimized && (
        <div
          onPointerDown={startResize}
          aria-hidden="true"
          className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize"
          style={{
            background:
              "linear-gradient(135deg, transparent 0 50%, rgba(255,255,255,0.25) 50% 60%, transparent 60% 70%, rgba(255,255,255,0.25) 70% 80%, transparent 80%)",
          }}
        />
      )}
    </div>
  );
}

// Body content (textarea + class picker + save). The draggable panel header
// provides the title + minimize + close, so this is just the working surface.
// The textarea uses flex-1 so it grows/shrinks as the panel is resized.
function QuickNoteBody({
  text, setText, taRef, onKey, classes, classChoice, setClassChoice, submit, submitting,
}: {
  text: string;
  setText: (v: string) => void;
  taRef: React.RefObject<HTMLTextAreaElement>;
  onKey: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  classes: ClassMini[];
  classChoice: string | null;
  setClassChoice: (v: string | null) => void;
  submit: () => void;
  submitting: boolean;
}) {
  return (
    <div className="flex flex-col flex-1 min-h-0 px-4 pb-4 pt-3">
      <textarea
        ref={taRef}
        value={text}
        onChange={e => setText(e.target.value.slice(0, 50_000))}
        onKeyDown={onKey}
        placeholder="What did you just learn? Paste a passage. Type a thought. Lionade will file it."
        className="flex-1 min-h-[80px] w-full resize-none rounded-[8px] bg-white/[0.04] border border-white/[0.08]
          focus:border-gold/40 focus:outline-none px-3 py-3 text-[14px] text-cream
          placeholder:text-cream/30 leading-relaxed mb-3"
      />

      {/* Class picker */}
      <div className="mb-3 shrink-0">
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

      <div className="flex items-center justify-between shrink-0">
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
