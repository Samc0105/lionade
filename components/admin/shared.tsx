"use client";

/**
 * Shared Admin Console UI primitives — used by every page under app/admin/.
 *
 *   CARD_BG          the house dark-glass card gradient
 *   RoleBadge        gold admin / electric support / muted user pill
 *   AdminModalShell  backdrop + panel scaffold with the behaviors
 *                    ConfirmModal already solved: Esc closes (when not
 *                    busy), backdrop click closes, focus moves into the
 *                    panel on open, aria-modal + aria-labelledby wired.
 *                    For action modals that need form fields and so can't
 *                    use ConfirmModal directly.
 */

import { ReactNode, useEffect, useRef } from "react";

export const CARD_BG = "linear-gradient(135deg, #0a1020 0%, #060c18 100%)";

export function RoleBadge({ role, muted = false }: { role: string; muted?: boolean }) {
  if (role !== "admin" && role !== "support") {
    return muted ? (
      <span className="text-cream/40">user</span>
    ) : (
      <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/10 text-cream/50 border border-white/10">
        user
      </span>
    );
  }
  const admin = role === "admin";
  return (
    <span
      className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full ${
        admin
          ? "bg-gold/15 text-gold border border-gold/30"
          : "bg-electric/15 text-electric border border-electric/30"
      }`}
    >
      {role}
    </span>
  );
}

export interface AdminModalShellProps {
  open: boolean;
  /** Called on Esc / backdrop click (ignored while busy). */
  onClose: () => void;
  /** Blocks dismissal while an action is in flight. */
  busy?: boolean;
  /** id of the heading element inside, for aria-labelledby. */
  labelId: string;
  /** Tailwind border class for the panel, e.g. "border-gold/25". */
  borderClass?: string;
  /** Panel background; defaults to the dark-glass card gradient. */
  background?: string;
  children: ReactNode;
}

export function AdminModalShell({
  open,
  onClose,
  busy = false,
  labelId,
  borderClass = "border-white/[0.1]",
  background = CARD_BG,
  children,
}: AdminModalShellProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Esc to close (when not busy) + Tab focus-trap so keyboard/SR users can't
  // tab into the page behind an aria-modal dialog (WCAG 2.1.2 / 2.4.3). Ported
  // from ConfirmModal so action modals get the same behavior.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) { onClose(); return; }
      if (e.key !== "Tab" || !panelRef.current) return;
      const items = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute("disabled"));
      if (items.length === 0) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  // Move focus into the panel on open (mirrors ConfirmModal's rAF guard
  // against the entrance-animation layout race), and restore focus to the
  // trigger element on close.
  useEffect(() => {
    if (!open) return;
    const restoreTo = document.activeElement as HTMLElement | null;
    const id = requestAnimationFrame(() => {
      const target =
        panelRef.current?.querySelector<HTMLElement>("input, textarea, select, button");
      (target ?? panelRef.current)?.focus();
    });
    return () => {
      cancelAnimationFrame(id);
      restoreTo?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelId}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl border p-6 animate-slide-up outline-none ${borderClass}`}
        style={{ background }}
      >
        {children}
      </div>
    </div>
  );
}
