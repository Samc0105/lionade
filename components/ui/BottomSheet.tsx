"use client";

import { useEffect, useRef } from "react";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type PanInfo,
} from "framer-motion";
import { X } from "@phosphor-icons/react";

/**
 * BottomSheet — a glassmorphism slide-up dialog used by floating tools
 * (currently the Quiz "Missions & Bet" pill).
 *
 * Behaviors:
 *   - Slides up from the bottom on open (framer-motion); fades only when
 *     the user prefers reduced motion.
 *   - Esc-to-close (document keydown).
 *   - Click-outside-to-close (scrim onClick).
 *   - Swipe-down-to-close (framer drag with constraints={0,0}; releases
 *     past 120px OR with downward velocity > 500 trigger onClose).
 *   - Focus is moved to the close button on mount; previous focus is
 *     restored on close.
 *   - `aria-modal`, `role="dialog"`, `aria-label` from prop.
 *   - Max-width 600px on desktop, full-width on small screens.
 *   - Glass-card visual: blurred scrim, dark glass content, gold top
 *     accent border.
 *
 * Intentionally framework-light. No new deps — framer-motion is already
 * in package.json. Body scroll is locked while open.
 */
export interface BottomSheetProps {
  open: boolean;
  onClose: () => void;
  /** aria-label / aria-labelledby fallback for the dialog. */
  ariaLabel: string;
  children: React.ReactNode;
}

const SWIPE_CLOSE_OFFSET = 120;
const SWIPE_CLOSE_VELOCITY = 500;

export default function BottomSheet({
  open,
  onClose,
  ariaLabel,
  children,
}: BottomSheetProps) {
  const prefersReducedMotion = useReducedMotion();
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Esc-to-close + body scroll lock + focus management.
  useEffect(() => {
    if (!open) return;

    previouslyFocusedRef.current = (document.activeElement as HTMLElement) ?? null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Defer focus until after the slide-up animation has kicked off so
    // it doesn't fight the entrance transform.
    const t = setTimeout(() => closeBtnRef.current?.focus(), 50);

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
      clearTimeout(t);
      previouslyFocusedRef.current?.focus?.();
    };
  }, [open, onClose]);

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > SWIPE_CLOSE_OFFSET || info.velocity.y > SWIPE_CLOSE_VELOCITY) {
      onClose();
    }
  };

  // Reduced-motion: skip the slide; just opacity fade.
  const initial = prefersReducedMotion ? { opacity: 0 } : { y: "100%", opacity: 0.6 };
  const animate = prefersReducedMotion ? { opacity: 1 } : { y: 0, opacity: 1 };
  const exit = prefersReducedMotion ? { opacity: 0 } : { y: "100%", opacity: 0 };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-end justify-center"
          role="dialog"
          aria-modal="true"
          aria-label={ariaLabel}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          {/* Scrim — click anywhere outside to close. */}
          <button
            type="button"
            aria-label="Close"
            tabIndex={-1}
            className="absolute inset-0 w-full h-full bg-black/55 backdrop-blur-sm cursor-default"
            onClick={onClose}
          />

          {/* Sheet body */}
          <motion.div
            className="
              relative w-full sm:max-w-[600px]
              max-h-[85vh] overflow-y-auto
              rounded-t-[20px] sm:rounded-t-[24px]
              border-t border-x border-white/[0.08]
              bg-gradient-to-b from-[#0c1426] to-[#080d1a]
              shadow-[0_-20px_60px_-10px_rgba(0,0,0,0.6)]
              backdrop-blur-xl
              pt-4 pb-6 px-5
            "
            initial={initial}
            animate={animate}
            exit={exit}
            transition={{ type: "spring", damping: 32, stiffness: 320 }}
            drag={prefersReducedMotion ? false : "y"}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.4 }}
            onDragEnd={handleDragEnd}
          >
            {/* Gold accent top border */}
            <div
              className="absolute left-0 right-0 top-0 h-[2px] rounded-t-[20px] sm:rounded-t-[24px]"
              style={{ background: "linear-gradient(90deg, transparent, #FFD700, transparent)" }}
            />

            {/* Drag handle */}
            <div className="flex justify-center mb-3">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            {/* Close button — top right, focus target on open */}
            <button
              ref={closeBtnRef}
              type="button"
              onClick={onClose}
              aria-label="Close sheet"
              className="
                absolute top-3 right-3 grid place-items-center
                w-8 h-8 rounded-full
                text-cream/50 hover:text-cream
                hover:bg-white/[0.06]
                focus:outline-none focus:ring-2 focus:ring-gold/40
                transition-colors
              "
            >
              <X size={14} weight="bold" />
            </button>

            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
