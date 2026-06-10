"use client";

// Copy-to-clipboard + share helper for the 6-char room code.
// Fires the app-standard success toast on copy; the helper line swaps its
// copy icon for a check for 1.4s as in-place confirmation.

import { useState } from "react";
import { Check, CopySimple } from "@phosphor-icons/react";
import { toastSuccess } from "@/lib/toast";

interface Props {
  code: string;
  className?: string;
}

export default function RoomCodeShare({ code, className = "" }: Props) {
  const [copied, setCopied] = useState(false);

  function markCopied() {
    toastSuccess("Copied!");
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  }

  async function copy() {
    try {
      const shareUrl = typeof window !== "undefined"
        ? `${window.location.origin}/games/party/${code}`
        : `/games/party/${code}`;
      await navigator.clipboard.writeText(shareUrl);
      markCopied();
    } catch {
      // Fallback: just copy the code.
      try {
        await navigator.clipboard.writeText(code);
        markCopied();
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
      </button>
      <button
        type="button"
        onClick={copy}
        className="inline-flex items-center gap-1.5 text-cream/35 hover:text-cream/60 text-xs font-syne transition-colors"
        aria-label="Copy invite link"
      >
        {copied ? (
          <Check size={14} weight="bold" className="text-green-400" aria-hidden="true" />
        ) : (
          <CopySimple size={14} weight="bold" className="text-cream/50" aria-hidden="true" />
        )}
        Tap to copy invite link
      </button>
    </div>
  );
}
