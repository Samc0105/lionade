"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Sparkle,
  X,
  ArrowRight,
  ArrowLeft,
  Compass,
  Scroll,
  UsersThree,
  BookOpen,
  ChartBar,
  Target,
  MagnifyingGlass,
  CalendarBlank,
  Cloud,
  type Icon,
} from "@phosphor-icons/react";
import {
  WHATS_NEW,
  WHATS_NEW_VERSION,
  hasUnseenWhatsNew,
  markWhatsNewSeen,
  type WhatsNewEntry,
  type WhatsNewIcon,
} from "@/lib/liondesk/whatsnew";

// WhatsNew (Idea 43): a dismissible glass panel that helps returning players find
// the many new TechHub surfaces. It opens once, the first time after a version
// bump, lists the headline features as deep links, and offers a guided tour that
// walks each one with Back and Next.
//
// Pure discovery. It reads only a local seen flag and grants nothing, so the
// economy stays server authoritative and there is no Fang value to flash.
//
// No flash, mount guarded: the seen state lives in localStorage, which is unknown
// on the server, so the component renders nothing until after mount. Only then, if
// the stored seen version is behind WHATS_NEW_VERSION, does the panel open. That
// means the panel never appears on the server render and never flashes a wrong
// state on the client.
//
// Accessibility: a focus trapped modal dialog. Focus moves in on open and is
// restored to the trigger on close, body scroll is locked while open, Escape and
// the backdrop close it, and Tab cycles within the panel. Every animation used
// here (animate-fade-in, animate-slide-up) is disabled under prefers-reduced-motion
// by app/globals.css, so motion sensitive players get a still panel.
//
// Web only, mounted once at the hub in app/learn/techhub/page.tsx.

// Icon name to Phosphor component, kept in the component layer (not the data file)
// the same way components/helpdesk/icons.tsx maps the track icons.
const ICONS: Record<WhatsNewIcon, Icon> = {
  Scroll,
  UsersThree,
  BookOpen,
  ChartBar,
  Target,
  Compass,
  MagnifyingGlass,
  CalendarBlank,
  Cloud,
};

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Run the Cmd or Ctrl K guard before paint on the client so its capture phase
// window listener registers ahead of the command palette's own capture listener
// (the palette adds its toggle in a passive effect, which runs later, so a layout
// effect here lands on window first). On the server we fall back to useEffect so
// no layout effect warning is emitted. This is the standard isomorphic layout
// effect pattern, and it keeps the same hook count in both environments.
const useIsoLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

type View = "list" | "tour";

export default function WhatsNew() {
  const router = useRouter();
  // The seen state only exists on the client. Stay closed (and render nothing)
  // until mount, then open once if there is a new version to show.
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>("list");
  const [step, setStep] = useState(0);

  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  // Mirror open into a ref so the always present key guard below (registered
  // once at mount) reads the current value at event time without re binding.
  const openRef = useRef(false);

  useEffect(() => {
    setMounted(true);
    if (hasUnseenWhatsNew()) setOpen(true);
  }, []);

  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // While the panel is open, swallow Cmd or Ctrl K so the command palette (a
  // separate global listener mounted on the same hub) cannot stack a second
  // overlay on top of What's New. The palette registers its toggle on window in
  // the capture phase, so we register ours in a layout effect: that runs before
  // the palette's passive effect listener, which lets stopImmediatePropagation
  // win and keep the keystroke from reaching it. When the panel is closed the
  // guard passes the key straight through, so the palette behaves as normal.
  useIsoLayoutEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!openRef.current) return;
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // On open: remember where focus was, lock body scroll, and move focus into the
  // dialog. On close (cleanup): unlock scroll and restore focus to the trigger,
  // the same dialog a11y pattern as CommandPalette and ConfirmModal.
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => closeRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      restoreTo?.focus?.();
    };
  }, [open]);

  // When the tour advances, move focus to its primary action so keyboard players
  // follow the walkthrough without hunting for the new controls.
  useEffect(() => {
    if (!open || view !== "tour") return;
    const raf = requestAnimationFrame(() => primaryRef.current?.focus());
    return () => cancelAnimationFrame(raf);
  }, [open, view, step]);

  if (!mounted || !open) return null;

  const total = WHATS_NEW.length;

  const finish = () => {
    markWhatsNewSeen(WHATS_NEW_VERSION);
    setOpen(false);
  };

  // Open a highlight. Marking seen here too means engaging with a feature counts
  // as seen, so the panel does not nag again after the player follows a link.
  const go = (entry: WhatsNewEntry) => {
    markWhatsNewSeen(WHATS_NEW_VERSION);
    setOpen(false);
    // On hub features (The Board, the palette, the seasonal card) are revealed by
    // closing; the player is already on the hub, so there is no route to push.
    if (!entry.onHub) router.push(entry.href);
  };

  const startTour = () => {
    setStep(0);
    setView("tour");
  };

  // Focus trap + Escape, handled on the dialog. Tab cycles within the panel so
  // focus can never escape behind the backdrop.
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      finish();
      return;
    }
    if (e.key !== "Tab") return;
    const root = dialogRef.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      (el) => el.offsetParent !== null || el === document.activeElement,
    );
    if (nodes.length === 0) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const activeEl = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (activeEl === first || !root.contains(activeEl)) {
        e.preventDefault();
        last.focus();
      }
    } else if (activeEl === last || !root.contains(activeEl)) {
      e.preventDefault();
      first.focus();
    }
  };

  const headingId = "techhub-whatsnew-title";
  const descId = "techhub-whatsnew-desc";

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-center p-4 pt-[10vh] bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={finish}
    >
      <div
        ref={dialogRef}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descId}
        className="w-full max-w-lg rounded-2xl border border-white/[0.1] overflow-hidden animate-slide-up shadow-2xl shadow-black/50"
        style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,12,24,0.98))" }}
      >
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-white/[0.07]">
          <span
            className="flex items-center justify-center w-10 h-10 rounded-xl flex-shrink-0"
            style={{ background: "rgba(255,215,0,0.14)", border: "1px solid rgba(255,215,0,0.4)" }}
          >
            <Sparkle size={20} weight="fill" color="#FFD700" aria-hidden="true" />
          </span>
          <div className="flex-1 min-w-0">
            <h2 id={headingId} className="font-bebas text-2xl text-cream tracking-wider leading-none">
              WHAT IS NEW IN TECHHUB
            </h2>
            <p id={descId} className="text-cream/55 text-xs mt-1.5">
              {view === "list"
                ? "A lot has landed since you were last on the desk. Here are the highlights. Open any one, or take the quick tour."
                : `A quick walk through the new surfaces. Step ${step + 1} of ${total}.`}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={finish}
            aria-label="Close what is new"
            className="grid place-items-center w-8 h-8 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.06] flex-shrink-0 transition-colors"
          >
            <X size={16} weight="bold" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        {view === "list" ? (
          <div className="max-h-[55vh] overflow-y-auto py-1">
            {WHATS_NEW.map((entry) => {
              const IconCmp = ICONS[entry.icon];
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => go(entry)}
                  className="group w-full flex items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-white/[0.04]"
                  style={{ boxShadow: `inset 2px 0 0 ${entry.color}55` }}
                >
                  <span
                    className="flex items-center justify-center w-9 h-9 rounded-lg flex-shrink-0"
                    style={{ background: `${entry.color}1a`, border: `1px solid ${entry.color}40` }}
                  >
                    <IconCmp size={18} weight="fill" color={entry.color} aria-hidden="true" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm text-cream font-semibold">{entry.title}</span>
                    <span className="block text-[11px] text-cream/55 leading-relaxed mt-0.5">{entry.blurb}</span>
                  </span>
                  <ArrowRight
                    size={14}
                    weight="bold"
                    color={entry.color}
                    aria-hidden="true"
                    className="flex-shrink-0 group-hover:translate-x-1 transition-transform"
                  />
                </button>
              );
            })}
          </div>
        ) : (
          <TourStep entry={WHATS_NEW[step]} index={step} total={total} />
        )}

        {/* Footer controls */}
        {view === "list" ? (
          <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-white/[0.07]">
            <button
              type="button"
              onClick={finish}
              className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream/45 hover:text-cream/80 transition-colors px-2 py-2"
            >
              Got it
            </button>
            <button
              ref={primaryRef}
              type="button"
              onClick={startTour}
              className="inline-flex items-center gap-2 rounded-xl px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-gold hover:bg-gold/10 transition-colors"
              style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.4)" }}
            >
              <Compass size={14} weight="fill" aria-hidden="true" />
              Take the tour
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-white/[0.07]">
            <button
              type="button"
              onClick={() => (step === 0 ? setView("list") : setStep((s) => Math.max(0, s - 1)))}
              className="inline-flex items-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-cream/55 hover:text-cream hover:bg-white/[0.05] transition-colors"
            >
              <ArrowLeft size={13} weight="bold" aria-hidden="true" />
              {step === 0 ? "Back to list" : "Back"}
            </button>

            {/* Step dots */}
            <div className="flex items-center gap-1.5" aria-hidden="true">
              {WHATS_NEW.map((entry, i) => (
                <span
                  key={entry.id}
                  className="w-1.5 h-1.5 rounded-full transition-colors"
                  style={{ background: i === step ? WHATS_NEW[step].color : "rgba(255,255,255,0.18)" }}
                />
              ))}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => go(WHATS_NEW[step])}
                className="hidden sm:inline-flex items-center gap-1.5 rounded-xl px-3 py-2 font-mono text-[10px] uppercase tracking-[0.12em] transition-colors"
                style={{
                  color: WHATS_NEW[step].color,
                  background: `${WHATS_NEW[step].color}14`,
                  border: `1px solid ${WHATS_NEW[step].color}44`,
                }}
              >
                {WHATS_NEW[step].onHub ? "Show me" : "Open"}
              </button>
              <button
                ref={primaryRef}
                type="button"
                onClick={() => (step === total - 1 ? finish() : setStep((s) => Math.min(total - 1, s + 1)))}
                className="inline-flex items-center gap-1.5 rounded-xl px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-gold transition-colors hover:bg-gold/10"
                style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.4)" }}
              >
                {step === total - 1 ? "Done" : "Next"}
                {step !== total - 1 && <ArrowRight size={13} weight="bold" aria-hidden="true" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// One tour step: the highlighted feature shown large, with its deep link offered
// in the footer. Pure presentation, no state of its own.
function TourStep({ entry, index, total }: { entry: WhatsNewEntry; index: number; total: number }) {
  const IconCmp = ICONS[entry.icon];
  return (
    <div className="px-5 py-6">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40">
          Step {index + 1} of {total}
        </span>
      </div>
      <div className="flex items-start gap-4">
        <span
          className="flex items-center justify-center w-14 h-14 rounded-2xl flex-shrink-0"
          style={{ background: `${entry.color}1a`, border: `1px solid ${entry.color}55` }}
        >
          <IconCmp size={28} weight="fill" color={entry.color} aria-hidden="true" />
        </span>
        <div className="flex-1 min-w-0">
          <h3 className="font-bebas text-2xl text-cream tracking-wide leading-none">{entry.title}</h3>
          <p className="text-cream/70 text-sm leading-relaxed mt-2">{entry.blurb}</p>
        </div>
      </div>
    </div>
  );
}
