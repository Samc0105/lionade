"use client";

/**
 * ConfirmModal — replacement for native window.confirm().
 *
 * Dark-glass aesthetic matching the Delete Account modal in app/profile/page.tsx.
 * Esc closes (when not busy), backdrop click closes (when not busy), focus traps
 * to the confirm button on open so screen readers + keyboard users land where
 * the destructive action is.
 *
 * Usage:
 *   const [open, setOpen] = useState(false);
 *   <ConfirmModal
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     onConfirm={async () => { await doTheThing(); setOpen(false); }}
 *     title="Archive class?"
 *     message="You can restore it later from settings."
 *     confirmLabel="Archive"
 *     destructive
 *   />
 *
 * Lives at /Users/samc/Desktop/lionade/components/ConfirmModal.tsx.
 */

import { useEffect, useRef, useState } from "react";
import { Warning } from "@phosphor-icons/react";

export interface ConfirmModalProps {
  /** Controls visibility. */
  open: boolean;
  /** Called when the user dismisses (Esc, backdrop, Cancel). */
  onClose: () => void;
  /**
   * Called when the user confirms. Can be async — the modal will show a busy
   * state while it runs and stays open until your handler resolves. If your
   * handler closes the modal on success, do so via onClose-equivalent setter.
   * Throwing inside onConfirm will reset the busy state but leave the modal
   * open so the caller can surface a toast.
   */
  onConfirm: () => void | Promise<void>;
  /** Modal headline. Sentence-case is the house style. */
  title?: string;
  /** Sub-line body copy. Keep short. */
  message?: string;
  /** Primary button label. */
  confirmLabel?: string;
  /** Secondary button label. */
  cancelLabel?: string;
  /**
   * When true the primary button uses the red destructive treatment + a
   * warning icon appears in the header. When false the primary uses the
   * brand gold treatment.
   */
  destructive?: boolean;
}

export default function ConfirmModal({
  open,
  onClose,
  onConfirm,
  title = "Are you sure?",
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = false,
}: ConfirmModalProps) {
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Esc to close (only when not busy — avoid orphaning an in-flight mutation).
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, busy, onClose]);

  // Focus the primary button on open so keyboard / SR users land where the
  // action is. Wrapping in rAF avoids a layout race with the entrance anim.
  useEffect(() => {
    if (!open) return;
    const id = requestAnimationFrame(() => confirmRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  // Reset busy whenever the modal hides — protects against state leaking
  // across reopens if the parent forgot to settle it.
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  if (!open) return null;

  const handleConfirm = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await onConfirm();
    } catch {
      // Caller surfaces the toast. We just reset busy so the user can retry.
      setBusy(false);
    }
  };

  const finalConfirmLabel =
    confirmLabel ?? (destructive ? "Delete" : "Confirm");

  return (
    <div
      onClick={() => !busy && onClose()}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full max-w-md rounded-2xl border p-6 animate-slide-up ${
          destructive ? "border-red-400/30" : "border-white/[0.1]"
        }`}
        style={{
          background: destructive
            ? "linear-gradient(135deg, rgba(20,8,14,0.98), rgba(8,4,8,0.98))"
            : "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,12,24,0.98))",
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          {destructive && (
            <div className="w-10 h-10 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center shrink-0">
              <Warning size={20} weight="fill" color="#F87171" aria-hidden="true" />
            </div>
          )}
          <h3
            id="confirm-modal-title"
            className={`font-bebas text-2xl tracking-wider ${
              destructive ? "text-red-400" : "text-cream"
            }`}
          >
            {title}
          </h3>
        </div>

        {message && (
          <p className="text-cream/80 text-sm mb-5 leading-relaxed">{message}</p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60 transition-all"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={handleConfirm}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              background: destructive
                ? "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)"
                : "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: destructive ? "#fff" : "#04080F",
              boxShadow: destructive
                ? "0 4px 15px rgba(220,38,38,0.3)"
                : "0 4px 15px rgba(240,180,41,0.3)",
            }}
          >
            {busy ? "Working..." : finalConfirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
