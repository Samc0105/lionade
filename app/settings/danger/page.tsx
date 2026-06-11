"use client";

/**
 * /settings/danger — the Danger Zone section of the settings overhaul.
 *
 * Two irreversible-ish account actions, each in a red-bordered card:
 *
 *   1. Deactivate — soft, fully reversible. Confirm step, then
 *      POST /api/user/account/deactivate (sets deactivated_at + flips
 *      visibility to private), then sign the user out. Logging back in
 *      reactivates (see lib/auth.tsx syncProfile clearing deactivated_at).
 *
 *   2. Delete — type-your-email modal, then DELETE /api/user/account, which
 *      now SCHEDULES the hard delete 24h out and returns pending_deletion_at.
 *      On success the page flips to the scheduled-deletion state and the
 *      global banner in the settings layout also surfaces it.
 *
 *   When the account already has pending_deletion_at set (fetched via
 *   GET /api/user/account), this page shows the scheduled state with a
 *   Cancel button -> POST /api/user/account/cancel-deletion. The layout
 *   banner offers the same cancel; both paths revalidate the shared SWR key.
 *
 * Reads GET /api/user/account on mount using the SAME SWR key the layout
 * banner uses ("settings/account-state") so a cancel/schedule on either
 * surface keeps both in sync.
 *
 * Design system: navy bg, cream text, red accents for destructive intent.
 * All copy is em-dash-free.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { Warning, Trash, MoonStars } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost, apiDelete } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { SettingsCard } from "@/components/settings/shared";

const ACCOUNT_STATE_KEY = "settings/account-state";

interface AccountState {
  email: string | null;
  pending_deletion_at: string | null;
  deactivated_at: string | null;
}

function formatWindow(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "soon";
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function DangerZonePage() {
  const { user, logout } = useAuth();
  const router = useRouter();

  // Shared SWR key with the layout banner so schedule/cancel stays in sync.
  const { data, mutate } = useSWR(
    ACCOUNT_STATE_KEY,
    () => apiGet<AccountState>("/api/user/account"),
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  const state = data?.ok && data.data ? data.data : null;
  const pendingAt = state?.pending_deletion_at ?? null;
  const email = state?.email ?? user?.email ?? "";

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [deactivating, setDeactivating] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  // ── Deactivate ────────────────────────────────────────────────────────────
  const handleDeactivate = useCallback(async () => {
    setDeactivating(true);
    const res = await apiPost("/api/user/account/deactivate", {});
    if (!res.ok) {
      console.error("[settings/danger:deactivate] failed", res.error);
      toastError("Couldn't deactivate your account. Try again.");
      setDeactivating(false);
      return;
    }
    toastSuccess("Account deactivated. Log back in any time to reactivate.");
    // Sign out so the paused state takes effect immediately. Logging back in
    // clears deactivated_at (see lib/auth.tsx syncProfile).
    try {
      await logout();
    } catch {
      // Fall back to a direct client sign-out if the context logout throws.
      try {
        await supabase.auth.signOut();
      } catch {
        /* best effort */
      }
    }
    router.push("/");
  }, [logout, router]);

  // ── Cancel scheduled deletion ───────────────────────────────────────────────
  const handleCancelDeletion = useCallback(async () => {
    setCancelling(true);
    // Optimistic clear, then confirm with the server.
    void mutate(
      (prev) =>
        prev && prev.ok && prev.data
          ? { ...prev, data: { ...prev.data, pending_deletion_at: null } }
          : prev,
      { revalidate: false },
    );
    const res = await apiPost("/api/user/account/cancel-deletion", {});
    if (!res.ok) {
      console.error("[settings/danger:cancel-deletion] failed", res.error);
      toastError("Couldn't cancel the deletion. Try again.");
      void mutate();
      setCancelling(false);
      return;
    }
    toastSuccess("Account deletion cancelled. You're all set.");
    void mutate();
    setCancelling(false);
  }, [mutate]);

  // ── Scheduled-deletion state ────────────────────────────────────────────────
  if (pendingAt) {
    return (
      <SettingsCard eyebrow="Danger zone" title="Account scheduled for deletion">
        <div
          className="rounded-2xl border border-red-500/30 p-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(40,13,16,0.5), rgba(28,10,12,0.5))",
          }}
        >
          <div className="flex items-start gap-3">
            <Warning
              size={22}
              weight="fill"
              className="text-red-300 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-red-200 text-sm font-semibold leading-tight">
                Your account is scheduled for deletion on {formatWindow(pendingAt)}.
              </p>
              <p className="text-red-200/60 text-xs mt-2 leading-relaxed">
                Until then nothing is gone. Cancel before the window closes to
                keep your account, profile, friends, history, and Fangs. After
                that everything is permanently removed and cannot be recovered.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancelDeletion}
            disabled={cancelling}
            className="mt-5 inline-flex items-center px-4 py-2.5 rounded-lg text-xs font-bold text-red-100 bg-red-500/20 border border-red-400/40 hover:bg-red-500/30 hover:border-red-400/60 disabled:opacity-50 transition-colors transform-gpu"
          >
            {cancelling ? "Cancelling..." : "Cancel deletion"}
          </button>
        </div>
      </SettingsCard>
    );
  }

  // ── Default state: deactivate + delete ──────────────────────────────────────
  return (
    <>
      <SettingsCard eyebrow="Danger zone" title="Deactivate account">
        <div
          className="rounded-2xl border border-red-500/25 p-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(36,16,18,0.45), rgba(26,12,14,0.45))",
          }}
        >
          <div className="flex items-start gap-3 mb-4">
            <MoonStars
              size={22}
              weight="fill"
              className="text-red-300/80 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-cream/70 text-sm leading-relaxed">
              Hides your profile, removes you from leaderboards and search, and
              pauses your account. Your data is kept. Log back in any time to
              reactivate.
            </p>
          </div>

          {!confirmingDeactivate ? (
            <button
              type="button"
              onClick={() => setConfirmingDeactivate(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold text-red-100 bg-red-500/15 border border-red-400/30 hover:bg-red-500/25 hover:border-red-400/50 transition-colors transform-gpu"
            >
              <MoonStars size={15} weight="fill" aria-hidden="true" />
              Deactivate account
            </button>
          ) : (
            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDeactivate(false)}
                disabled={deactivating}
                className="px-4 py-2.5 rounded-lg text-xs font-bold text-cream/70 border border-white/10 hover:bg-white/5 disabled:opacity-50 transition-colors transform-gpu"
              >
                Keep my account active
              </button>
              <button
                type="button"
                onClick={handleDeactivate}
                disabled={deactivating}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold text-red-100 bg-red-500/25 border border-red-400/50 hover:bg-red-500/35 disabled:opacity-50 transition-colors transform-gpu"
              >
                {deactivating ? "Deactivating..." : "Yes, deactivate"}
              </button>
            </div>
          )}
        </div>
      </SettingsCard>

      <SettingsCard eyebrow="Danger zone" title="Delete account">
        <div
          className="rounded-2xl border border-red-500/30 p-5"
          style={{
            background:
              "linear-gradient(135deg, rgba(40,13,16,0.45), rgba(28,10,12,0.45))",
          }}
        >
          <div className="flex items-start gap-3 mb-4">
            <Trash
              size={22}
              weight="fill"
              className="text-red-400 shrink-0 mt-0.5"
              aria-hidden="true"
            />
            <p className="text-cream/70 text-sm leading-relaxed">
              Permanently removes your account, profile, friends, quiz history,
              and any Fangs you have on hand. Deletion is scheduled 24 hours out
              so you have a grace window to change your mind. You can cancel any
              time before then.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setShowDeleteModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold text-white bg-red-600/80 border border-red-500/60 hover:bg-red-600 transition-colors transform-gpu"
          >
            <Trash size={15} weight="fill" aria-hidden="true" />
            Delete account
          </button>
        </div>
      </SettingsCard>

      {showDeleteModal && (
        <DeleteAccountModal
          email={email}
          onClose={() => setShowDeleteModal(false)}
          onScheduled={(pending) => {
            // Reflect the scheduled state immediately on both this page and the
            // layout banner via the shared SWR key.
            void mutate(
              (prev) =>
                prev && prev.ok && prev.data
                  ? { ...prev, data: { ...prev.data, pending_deletion_at: pending } }
                  : prev,
              { revalidate: false },
            );
            void mutate();
            setShowDeleteModal(false);
          }}
        />
      )}
    </>
  );
}

// ── Delete-account confirmation modal ─────────────────────────────────────────
// Type-your-email gate (matches the server's confirm contract), then
// DELETE /api/user/account schedules the deletion 24h out. Ported from the
// proven profile-page modal; on success we surface the scheduled state instead
// of signing out (the user keeps their session during the grace window).
function DeleteAccountModal({
  email,
  onClose,
  onScheduled,
}: {
  email: string;
  onClose: () => void;
  onScheduled: (pendingDeletionAt: string | null) => void;
}) {
  const [confirmText, setConfirmText] = useState("");
  const [scheduling, setScheduling] = useState(false);
  const emailLc = email.trim().toLowerCase();
  const matches = confirmText.trim().toLowerCase() === emailLc && emailLc.length > 0;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !scheduling) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [scheduling, onClose]);

  const handleSchedule = async () => {
    if (!matches) return;
    setScheduling(true);
    try {
      const res = await apiDelete<{ ok: boolean; pending_deletion_at: string }>(
        `/api/user/account?confirm=${encodeURIComponent(emailLc)}`,
      );
      if (!res.ok) {
        console.error("[settings/danger:delete-account] failed", res.error);
        toastError("Couldn't schedule deletion. Try again or contact support.");
        setScheduling(false);
        return;
      }
      const pending = res.data?.pending_deletion_at ?? null;
      toastSuccess(
        pending
          ? `Scheduled for deletion on ${formatWindow(pending)}.`
          : "Account scheduled for deletion.",
      );
      onScheduled(pending);
    } catch (e) {
      console.error("[settings/danger:delete-account] threw", e);
      toastError("Couldn't schedule deletion. Try again or contact support.");
      setScheduling(false);
    }
  };

  return (
    <div
      onClick={() => !scheduling && onClose()}
      className="fixed inset-0 z-[10000] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-account-title"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-2xl border border-red-400/30 p-6 animate-slide-up"
        style={{
          background:
            "linear-gradient(135deg, rgba(20,8,14,0.98), rgba(8,4,8,0.98))",
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-full bg-red-400/15 border border-red-400/30 flex items-center justify-center">
            <Warning size={20} weight="fill" color="#F87171" aria-hidden="true" />
          </div>
          <h3
            id="delete-account-title"
            className="font-bebas text-2xl text-red-400 tracking-wider"
          >
            DELETE ACCOUNT
          </h3>
        </div>
        <p className="text-cream/80 text-sm mb-2">
          This schedules permanent removal of your account, profile, friends,
          quiz history, and any Fangs you have on hand.
        </p>
        <p className="text-cream/50 text-xs mb-5">
          Deletion happens 24 hours from now. You can cancel any time before
          then. After the window closes this cannot be undone, and coming back
          means signing up again.
        </p>

        <label className="block text-cream/50 text-xs font-bold uppercase tracking-widest mb-1.5">
          Type your email to confirm
        </label>
        <p className="font-mono text-cream/60 text-xs mb-2">{email}</p>
        <input
          type="email"
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="your-email@example.com"
          disabled={scheduling}
          autoComplete="off"
          autoFocus
          className="w-full bg-white/5 border border-red-400/30 rounded-xl px-4 py-3 text-cream placeholder-cream/25 text-sm focus:outline-none focus:border-red-400 transition-all mb-4"
        />

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={scheduling}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60 transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleSchedule}
            disabled={!matches || scheduling}
            className="flex-1 py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background:
                matches && !scheduling
                  ? "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)"
                  : "rgba(220,38,38,0.2)",
              color: matches && !scheduling ? "#fff" : "#fca5a5",
              boxShadow:
                matches && !scheduling ? "0 4px 15px rgba(220,38,38,0.3)" : "none",
            }}
          >
            <span className="inline-flex items-center gap-2">
              {scheduling ? (
                "Scheduling..."
              ) : (
                <>
                  <Trash size={16} weight="fill" aria-hidden="true" /> Schedule deletion
                </>
              )}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
