"use client";

// Arena V2 — first-duel consent modal.
//
// Triggered the first time a user clicks "Find Opponent" with
// profile.ghost_consent_at === null. Copy is locked by the
// design-copywriter pass (no em-dashes, no parenthetical dashes — uses
// short sentences and commas only). On accept, POST /api/arena/v2/consent
// then proceed. On decline, the modal closes and the duel does not start.

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { useEffect } from "react";

interface ConsentModalProps {
  open: boolean;
  busy?: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

export default function ConsentModal({ open, busy = false, onAccept, onDecline }: ConsentModalProps) {
  const reduced = useReducedMotion();

  // ESC closes (declines), but only if the modal is actually open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onDecline();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onDecline]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 pb-6 sm:pb-0"
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          aria-modal="true"
          role="dialog"
          aria-labelledby="arena-v2-consent-title"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)" }}
            onClick={() => !busy && onDecline()}
          />

          <motion.div
            initial={reduced ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? { opacity: 0 } : { y: 24, opacity: 0 }}
            transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 280, damping: 28 }}
            className="relative w-full max-w-md rounded-2xl px-6 py-7 sm:py-8"
            style={{
              background: "linear-gradient(135deg, rgba(16,12,26,0.95) 0%, rgba(8,6,16,0.95) 100%)",
              border: "1px solid rgba(255,215,0,0.25)",
              boxShadow: "0 20px 60px rgba(0,0,0,0.6), 0 0 40px rgba(184,150,12,0.12), inset 0 1px 0 rgba(255,215,0,0.1)",
            }}
          >
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bebas tracking-[0.2em] mb-4"
              style={{
                background: "rgba(184,150,12,0.12)",
                border: "1px solid rgba(255,215,0,0.3)",
                color: "#FFD700",
              }}
            >
              ARENA V2
            </div>

            <h2 id="arena-v2-consent-title" className="font-bebas text-3xl sm:text-4xl text-cream tracking-wider leading-tight mb-3">
              YOUR DUELS GO ON FILE
            </h2>

            <p className="text-cream/70 text-sm sm:text-base leading-relaxed mb-4 font-syne">
              Your duel runs are saved and may be replayed as practice opponents for other players. Your answers and times are visible. Your identity stays hidden by default. You can change this anytime in Settings.
            </p>

            <ul className="text-cream/55 text-xs sm:text-sm space-y-1.5 mb-6 font-syne">
              <li className="flex items-start gap-2">
                <span className="text-[#FFD700] mt-0.5">{"✓"}</span>
                Anonymized as a stylized handle. No username, no avatar.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FFD700] mt-0.5">{"✓"}</span>
                Adults can opt in to show real username later.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FFD700] mt-0.5">{"✓"}</span>
                Under 18, you are always anonymized. No opt in.
              </li>
              <li className="flex items-start gap-2">
                <span className="text-[#FFD700] mt-0.5">{"✓"}</span>
                Delete your ghost history anytime from Settings.
              </li>
            </ul>

            <div className="flex flex-col-reverse sm:flex-row gap-3">
              <button
                type="button"
                onClick={onDecline}
                disabled={busy}
                className="flex-1 py-3 rounded-xl font-syne font-bold text-sm transition-all duration-200 active:scale-95 disabled:opacity-50"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  color: "rgba(238,244,255,0.7)",
                }}
              >
                Not now
              </button>
              <button
                type="button"
                onClick={onAccept}
                disabled={busy}
                className="flex-1 py-3 rounded-xl font-syne font-bold text-sm transition-all duration-200 active:scale-95 disabled:opacity-50"
                style={{
                  background: "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
                  color: "#04080F",
                  boxShadow: "0 4px 20px rgba(255,215,0,0.25), 0 1px 0 rgba(255,255,255,0.2) inset",
                }}
              >
                {busy ? "Saving..." : "Got it, let's duel"}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
