"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Crown, Sparkle, X } from "@phosphor-icons/react";
import { SAGA_LENGTH, type Promotion, type SagaChapter } from "@/lib/liondesk/saga";
import { playPromotion } from "@/lib/liondesk/sound";

// TechHub Saga promotion moment. When the player crosses a career title,
// AchievementBanner detects the levelup id, reads the chapter out of saga.ts,
// and renders this overlay once. It is the story spine for the 11-title ladder:
// a manager line plus the responsibility the promotion unlocks, framed in the
// dark interstellar gold/purple celebration language used elsewhere.
//
// Cosmetic only. It grants no Fangs, blocks nothing, and is fully dismissible
// (close button, backdrop, Escape, and an auto-dismiss safety net). All entrance
// motion is gated on prefers-reduced-motion and snaps to its final state.
//
// CareerSagaCard is also exported on its own so the career area can show the
// current chapter and next promotion at rest. It is presentational (props in),
// so a consumer must pass already-mounted values to avoid a flash of zero.

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

const GOLD = "#FFD700";
const PURPLE = "#A855F7";

/**
 * The chapter body, shared by the overlay and the career area. `prominent` scales
 * the type up for the full-screen moment; `justPromoted` switches the eyebrow
 * from a resting label to the celebration line.
 */
export function CareerSagaCard({
  chapter,
  next,
  prominent = false,
  justPromoted = false,
}: {
  chapter: SagaChapter;
  next: SagaChapter | null;
  prominent?: boolean;
  justPromoted?: boolean;
}) {
  return (
    <div
      className={`relative rounded-2xl border overflow-hidden ${prominent ? "p-7" : "p-5"}`}
      style={{
        background: "linear-gradient(135deg, rgba(10,16,32,0.96) 0%, rgba(6,12,24,0.96) 100%)",
        borderColor: "rgba(255,215,0,0.4)",
        boxShadow: prominent
          ? "0 0 60px rgba(255,215,0,0.18), 0 0 120px rgba(168,85,247,0.16)"
          : "0 0 24px rgba(168,85,247,0.10)",
      }}
    >
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(168,85,247,0.10) 55%, rgba(74,144,217,0.06) 100%)",
        }}
        aria-hidden="true"
      />

      <div className="relative">
        <div className="flex items-center gap-2.5">
          <Crown size={prominent ? 26 : 20} weight="fill" color={GOLD} aria-hidden="true" />
          <div className="flex-1 min-w-0">
            <p className="font-mono uppercase tracking-[0.28em] text-[10px]" style={{ color: GOLD, opacity: 0.85 }}>
              {justPromoted ? "you have been promoted" : "current chapter"}
            </p>
          </div>
          <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45 whitespace-nowrap">
            chapter {chapter.level} of {SAGA_LENGTH}
          </span>
        </div>

        <h3
          className={`font-bebas tracking-wide leading-none text-cream mt-2 ${prominent ? "text-5xl sm:text-6xl" : "text-3xl"}`}
          style={
            prominent
              ? { color: GOLD, textShadow: `0 0 26px ${GOLD}55, 0 0 56px ${PURPLE}33` }
              : undefined
          }
        >
          {chapter.title}
        </h3>

        <p className={`text-cream/80 leading-relaxed mt-3 ${prominent ? "text-base max-w-md" : "text-sm"}`}>
          {chapter.managerLine}
        </p>

        <div
          className="mt-4 rounded-xl border px-3.5 py-3"
          style={{ borderColor: "rgba(168,85,247,0.32)", background: "rgba(168,85,247,0.07)" }}
        >
          <div className="flex items-center gap-1.5">
            <Sparkle size={13} weight="fill" color={PURPLE} aria-hidden="true" />
            <p className="font-mono uppercase tracking-[0.22em] text-[9px]" style={{ color: PURPLE, opacity: 0.9 }}>
              new responsibility unlocked
            </p>
          </div>
          <p className={`text-cream/75 leading-snug mt-1.5 ${prominent ? "text-sm" : "text-[13px]"}`}>
            {chapter.unlocked}
          </p>
        </div>

        <p className="font-mono text-[10px] text-cream/45 mt-3">
          {next ? (
            <>next: {next.title} (level {next.level})</>
          ) : (
            <>You have reached the top of the ladder.</>
          )}
        </p>
      </div>
    </div>
  );
}

/**
 * Full-screen promotion celebration. Mounts when a fresh promotion arrives and
 * removes itself on dismiss. Never blocks play: it auto-dismisses and is closable
 * four ways.
 */
export default function PromotionMoment({
  promotion,
  autoDismissMs = 9000,
  onDismiss,
}: {
  promotion: Promotion;
  autoDismissMs?: number;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(true);
  const reduced = useMemo(() => prefersReducedMotion(), []);
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);

  // Begin the dismiss: play the exit, then unmount via onDismiss once it settles
  // (immediately when motion is reduced, so it never lingers).
  function close() {
    setVisible(false);
  }

  // Play the gold promotion fanfare once when the moment mounts. The mute
  // preference and the audio gesture gate are both handled inside playPromotion,
  // so it stays silent when muted and never fights the browser autoplay policy.
  // Only the full screen overlay calls this; the at rest CareerSagaCard does not.
  useEffect(() => {
    playPromotion();
  }, []);

  useEffect(() => {
    if (visible) return;
    const t = setTimeout(onDismiss, reduced ? 0 : 300);
    return () => clearTimeout(t);
  }, [visible, reduced, onDismiss]);

  // Auto-dismiss safety net so the moment can never sit there blocking play.
  useEffect(() => {
    const t = setTimeout(() => setVisible(false), autoDismissMs);
    return () => clearTimeout(t);
  }, [autoDismissMs]);

  // Escape to close, focus the close button on open, keep Tab inside the dialog
  // (it is aria-modal), and restore focus to whatever was focused before the
  // moment opened once it unmounts.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setVisible(false);
        return;
      }
      if (e.key === "Tab") {
        const root = cardRef.current;
        if (!root) return;
        const focusable = Array.from(
          root.querySelectorAll<HTMLElement>(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          )
        ).filter((el) => !el.hasAttribute("disabled"));
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(id);
      previouslyFocused?.focus?.();
    };
  }, []);

  return (
    <div
      className={`fixed inset-0 z-[200] flex items-center justify-center p-4 ${
        reduced ? "" : "transition-opacity duration-300"
      } ${visible ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
      style={{
        background: "radial-gradient(ellipse at center, rgba(4,8,15,0.72) 0%, rgba(4,8,15,0.93) 100%)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
      role="dialog"
      aria-modal="true"
      aria-label={`Promotion: ${promotion.chapter.title}`}
      onClick={close}
    >
      <div
        ref={cardRef}
        onClick={(e) => e.stopPropagation()}
        className={`relative w-full max-w-md ${reduced || !visible ? "" : "promotion-card-enter"}`}
      >
        <button
          ref={closeBtnRef}
          type="button"
          onClick={close}
          aria-label="Dismiss"
          className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full grid place-items-center text-cream/55 hover:text-cream hover:bg-white/[0.08] transition-colors"
        >
          <X size={14} weight="bold" aria-hidden="true" />
        </button>

        <CareerSagaCard chapter={promotion.chapter} next={promotion.next} prominent justPromoted />

        <div className="mt-4 flex justify-center">
          <button
            type="button"
            onClick={close}
            className="px-6 py-2.5 rounded-xl border border-gold/50 bg-gold/10 text-gold font-mono text-[11px] uppercase tracking-[0.2em] hover:bg-gold/15 transition-colors"
          >
            continue
          </button>
        </div>
      </div>

      <style jsx>{`
        @keyframes promotion-card-in {
          0% { transform: translateY(22px) scale(0.95); opacity: 0; }
          60% { transform: translateY(-4px) scale(1.02); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        .promotion-card-enter {
          will-change: transform, opacity;
          animation: promotion-card-in 460ms cubic-bezier(0.16, 1, 0.3, 1) both;
        }
        @media (prefers-reduced-motion: reduce) {
          .promotion-card-enter {
            animation: none !important;
          }
        }
      `}</style>
    </div>
  );
}
