"use client";

// Copy-to-clipboard + share helper for the 6-char room code.
// Pops a tiny "Copied" pill for 1.4s on success.

import { useState } from "react";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";

interface Props {
  code: string;
  className?: string;
}

export default function RoomCodeShare({ code, className = "" }: Props) {
  const reduced = useReducedMotion();
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const shareUrl = typeof window !== "undefined"
        ? `${window.location.origin}/games/party/${code}`
        : `/games/party/${code}`;
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Fallback: just copy the code.
      try {
        await navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 1400);
      } catch {
        /* clipboard unavailable */
      }
    }
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <p className="font-bebas text-xs text-cream/40 tracking-[0.3em]">ROOM CODE</p>
      <button
        onClick={copy}
        className="group relative px-6 py-3 rounded-2xl transition-all active:scale-95"
        style={{
          background: "linear-gradient(135deg, rgba(168,85,247,0.15) 0%, rgba(124,58,237,0.06) 100%)",
          border: "1px solid rgba(168,85,247,0.45)",
          boxShadow: "0 0 28px rgba(168,85,247,0.16), inset 0 1px 0 rgba(255,255,255,0.06)",
        }}
        title="Click to copy invite link"
      >
        <span className="font-bebas text-4xl sm:text-5xl tracking-[0.4em] text-[#E9D5FF]">{code}</span>
        <AnimatePresence>
          {copied && (
            <motion.span
              key="pill"
              initial={reduced ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="absolute -top-8 left-1/2 -translate-x-1/2 px-2.5 py-1 rounded-full text-[10px] font-syne font-bold"
              style={{
                background: "rgba(34,197,94,0.25)",
                border: "1px solid rgba(34,197,94,0.5)",
                color: "#86EFAC",
              }}
            >
              Copied!
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <p className="text-cream/35 text-xs font-syne">Tap to copy invite link</p>
    </div>
  );
}
