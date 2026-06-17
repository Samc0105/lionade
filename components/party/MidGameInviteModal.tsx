"use client";

// MidGameInviteModal — surfaced from the host's drawing/celebrating/reveal
// screens so a friend can join mid-round. The existing join flow already
// handles late joiners (they become spectators via the parent's derivation)
// and the Resume banner will pick them up on landing since active_session
// now points at the room.
//
// The modal exposes the FULL invite URL (more obvious than the room code
// alone) plus a copy button + the code in big type as a fallback for verbal
// sharing. Nothing here hits the server; rendering is purely client.

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface Props {
  open: boolean;
  onClose: () => void;
  code: string;
}

export default function MidGameInviteModal({ open, onClose, code }: Props) {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState("");
  const closeBtnRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  // The element focused before the modal opened, so we can restore focus to it
  // (the trigger) on close.
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  // Capture origin on mount so the URL render is SSR-safe.
  useEffect(() => {
    if (typeof window !== "undefined") setOrigin(window.location.origin);
  }, []);

  // Escape closes the modal — accessibility baseline.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Focus management: remember the trigger, move focus to the Close button on
  // open, and restore focus to the trigger when the modal closes. The rAF
  // avoids a layout race with the entrance animation.
  useEffect(() => {
    if (!open) return;
    restoreFocusRef.current = (document.activeElement as HTMLElement) ?? null;
    const id = requestAnimationFrame(() => closeBtnRef.current?.focus());
    return () => {
      cancelAnimationFrame(id);
      restoreFocusRef.current?.focus?.();
    };
  }, [open]);

  // Trap Tab focus within the dialog so keyboard users can't tab out to the
  // game behind the modal.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const inviteUrl = origin ? `${origin}/games/party/${code}` : `/games/party/${code}`;

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — copy button still degrades fine */
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          key="backdrop"
          initial={reduced ? { opacity: 0 } : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[80] flex items-center justify-center px-4"
          style={{ background: "rgba(4,8,15,0.7)", backdropFilter: "blur(6px)" }}
          onClick={onClose}
          role="presentation"
        >
          <motion.div
            key="modal"
            ref={dialogRef}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 28 }}
            className="relative max-w-md w-full rounded-2xl p-6 space-y-4"
            style={{
              background: "linear-gradient(135deg, rgba(16,12,26,0.96) 0%, rgba(8,6,16,0.96) 100%)",
              border: "1px solid rgba(168,85,247,0.4)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.6), 0 0 32px rgba(168,85,247,0.18)",
            }}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Invite a friend to this party"
          >
            <button
              ref={closeBtnRef}
              onClick={onClose}
              className="absolute top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center text-cream/55 hover:text-cream transition-colors"
              aria-label="Close"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <span aria-hidden="true" className="font-bebas text-xl leading-none">×</span>
            </button>

            <div>
              <p className="font-bebas text-xs text-cream/45 tracking-[0.3em]">INVITE A FRIEND</p>
              <p className="font-bebas text-2xl text-cream tracking-wider mt-1">
                Mid-game? Drop them in.
              </p>
              <p className="font-syne text-xs text-cream/55 mt-1.5 leading-relaxed">
                Late joiners hop in as spectators until the next round, then play normally.
              </p>
            </div>

            {/* Room code in big type for verbal sharing. */}
            <div
              className="rounded-2xl p-4 text-center"
              style={{
                background: "linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(124,58,237,0.05) 100%)",
                border: "1px solid rgba(168,85,247,0.4)",
              }}
            >
              <p className="font-bebas text-[10px] text-cream/45 tracking-[0.3em] mb-1">ROOM CODE</p>
              <p className="font-bebas text-4xl text-[#E9D5FF] tracking-[0.4em]">{code}</p>
            </div>

            {/* Invite URL row — long-press friendly + dedicated copy button. */}
            <div className="space-y-1.5">
              <p className="font-bebas text-[10px] text-cream/45 tracking-[0.3em]">INVITE LINK</p>
              <div
                className="rounded-xl px-3 py-2.5 flex items-center gap-2"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                }}
              >
                <span className="flex-1 font-dm-mono text-xs text-cream/85 truncate" title={inviteUrl}>
                  {inviteUrl}
                </span>
                <button
                  onClick={copyLink}
                  className="px-3 py-1.5 rounded-lg font-bebas text-xs tracking-wider transition-all active:scale-95"
                  style={{
                    background: copied
                      ? "linear-gradient(135deg, rgba(34,197,94,0.3) 0%, rgba(22,163,74,0.15) 100%)"
                      : "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                    color: copied ? "#86EFAC" : "#fff",
                    border: copied ? "1px solid rgba(34,197,94,0.5)" : "1px solid rgba(255,255,255,0.18)",
                  }}
                  aria-label="Copy invite link"
                >
                  {copied ? "COPIED" : "COPY"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
