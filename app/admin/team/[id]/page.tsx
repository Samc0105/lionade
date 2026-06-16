"use client";

/**
 * /admin/team/[id] — single team member detail + lifecycle actions. ADMIN ONLY.
 *
 * Reads GET /api/admin/team/[id], which returns the full team_members row plus
 * a derived `mfa` field (enrolled / unknown). Actions, each gated by current
 * status and each server-enforced + audited:
 *   - Reset password   -> POST /api/admin/team/reset-password
 *                         (optional "show me the link" reveal)
 *   - Suspend          -> POST /api/admin/team/suspend     (active only)
 *   - Reactivate       -> POST /api/admin/team/reactivate  (suspended only)
 *   - Offboard         -> POST /api/admin/team/offboard
 *                         (type-the-username confirm + optional hard delete)
 *
 * Every action mutate()s the detail SWR on success so the view reflects the
 * new state. The layout hard-gates /admin to staff; this page self-gates to
 * admins (the read route returns 403 to support staff).
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import useSWR from "swr";
import { swrFetcher, apiPost } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { toastSuccess, toastError } from "@/lib/toast";
import type { TeamMember } from "@/lib/team/types";
import ConfirmModal from "@/components/ConfirmModal";
import { AdminModalShell, CARD_BG } from "@/components/admin/shared";
import {
  ArrowLeft,
  PaperPlaneTilt,
  Prohibit,
  ArrowCounterClockwise,
  UserMinus,
  ShieldCheck,
  ShieldSlash,
} from "@phosphor-icons/react";

interface MemberDetail extends TeamMember {
  mfa: { enrolled: boolean; unknown?: boolean };
}

const STATUS_PILL: Record<TeamMember["status"], string> = {
  active: "bg-green-400/15 text-green-300 border-green-400/30",
  suspended: "bg-amber-400/15 text-amber-300 border-amber-400/30",
  offboarded: "bg-white/10 text-cream/45 border-white/15",
  pending: "bg-electric/15 text-electric border-electric/30",
};

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-0.5">
        {label}
      </div>
      <div className="text-sm text-cream/85">{children}</div>
    </div>
  );
}

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—";
}

export default function AdminTeamMemberPage() {
  const params = useParams<{ id: string }>();
  const memberId = params.id;
  const { isAdmin } = useAdminRole();

  const detailKey = isAdmin ? `/api/admin/team/${memberId}` : null;
  const { data, error, mutate } = useSWR<{ member: MemberDetail }>(
    detailKey,
    swrFetcher,
  );

  const m = data?.member;

  // ── action state ──────────────────────────────────────────────────
  const [busy, setBusy] = useState(false);

  // Reset password
  const [resetOpen, setResetOpen] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [revealedLink, setRevealedLink] = useState<string | null>(null);

  // Suspend / reactivate
  const [confirmSuspend, setConfirmSuspend] = useState(false);
  const [confirmReactivate, setConfirmReactivate] = useState(false);

  // Offboard
  const [offboardOpen, setOffboardOpen] = useState(false);
  const [confirmUsername, setConfirmUsername] = useState("");
  const [hardOffboard, setHardOffboard] = useState(false);

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        Team management is admin only.
      </div>
    );
  }
  if (error) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3">
        Could not load this team member.
      </div>
    );
  }
  if (!m) {
    return <div className="h-40 rounded-2xl bg-white/[0.04] animate-pulse" />;
  }

  const hasLogin = m.lionade_access !== "none";

  // ── actions ──────────────────────────────────────────────────────
  const submitReset = async () => {
    setBusy(true);
    const res = await apiPost<{ ok: boolean; emailSent: boolean; resetLink?: string }>(
      "/api/admin/team/reset-password",
      { id: memberId, showLinkToAdmin: showLink },
    );
    setBusy(false);
    if (res.ok) {
      if (showLink && res.data?.resetLink) {
        setRevealedLink(res.data.resetLink);
      } else {
        setRevealedLink(null);
      }
      toastSuccess(
        res.data?.emailSent
          ? "Reset link emailed to the personal address"
          : "Reset link generated",
      );
      if (!showLink) setResetOpen(false);
      void mutate();
    } else {
      toastError(res.error ?? "Reset failed");
    }
  };

  const closeReset = () => {
    setResetOpen(false);
    setShowLink(false);
    setRevealedLink(null);
  };

  const submitSuspend = async () => {
    const res = await apiPost("/api/admin/team/suspend", { id: memberId });
    if (res.ok) {
      toastSuccess("Member suspended");
      setConfirmSuspend(false);
      void mutate();
    } else {
      toastError(res.error ?? "Suspension failed");
    }
  };

  const submitReactivate = async () => {
    const res = await apiPost("/api/admin/team/reactivate", { id: memberId });
    if (res.ok) {
      toastSuccess("Member reactivated");
      setConfirmReactivate(false);
      void mutate();
    } else {
      // 409 = offboarded member: cannot reactivate, must re-provision.
      toastError(
        res.status === 409
          ? "This member was offboarded. Re-provision instead."
          : res.error ?? "Reactivation failed",
      );
    }
  };

  const submitOffboard = async () => {
    if (confirmUsername.trim().toLowerCase() !== m.username.toLowerCase()) {
      toastError("Type the exact username to confirm.");
      return;
    }
    setBusy(true);
    const res = await apiPost<{ ok: boolean; mode: string; partialFailure?: boolean }>(
      "/api/admin/team/offboard",
      { id: memberId, confirmUsername: confirmUsername.trim(), hard: hardOffboard },
    );
    setBusy(false);
    if (res.ok) {
      toastSuccess(
        res.data?.partialFailure
          ? "Offboarded with warnings. Check the audit log."
          : "Member offboarded",
      );
      setOffboardOpen(false);
      setConfirmUsername("");
      setHardOffboard(false);
      void mutate();
    } else {
      toastError(res.error ?? "Offboard failed");
    }
  };

  const actionBtn =
    "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50";

  const usernameMatches =
    confirmUsername.trim().toLowerCase() === m.username.toLowerCase();

  return (
    <div className="space-y-5 max-w-3xl">
      <Link
        href="/admin/team"
        className="inline-flex items-center gap-1.5 text-sm text-cream/50 hover:text-cream/80 transition-colors"
      >
        <ArrowLeft size={14} aria-hidden="true" /> Back to team
      </Link>

      {/* Header */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="font-bebas text-3xl tracking-wider text-cream">
            {m.full_name}
          </h1>
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-white/[0.06] text-cream/70 border border-white/15">
            {m.role.replace("_", " ")}
          </span>
          <span
            className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_PILL[m.status]}`}
          >
            {m.status}
          </span>
        </div>
        <div className="mt-1 text-sm text-cream/50 font-mono">
          {m.email_address}
        </div>
      </div>

      {/* Account */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <h2 className="font-bebas text-xl tracking-wider text-cream mb-4">Account</h2>
        <div className="grid grid-cols-2 gap-x-6 gap-y-5">
          <Info label="Team email">
            <span className="font-mono text-xs">{m.email_address}</span>
          </Info>
          <Info label="Personal email">
            <span className="font-mono text-xs">{m.personal_email ?? "—"}</span>
          </Info>
          <Info label="Lionade access">
            <span className="capitalize">{m.lionade_access}</span>
            {!hasLogin && (
              <span className="ml-2 text-[11px] text-cream/35">
                (mailbox only, no login)
              </span>
            )}
          </Info>
          <Info label="Two-factor">
            {!hasLogin ? (
              <span className="text-cream/40">Not applicable</span>
            ) : m.mfa.unknown ? (
              <span className="flex items-center gap-1.5 text-cream/50">
                <ShieldSlash size={14} aria-hidden="true" />
                Could not verify
              </span>
            ) : m.mfa.enrolled ? (
              <span className="flex items-center gap-1.5 text-green-300">
                <ShieldCheck size={14} weight="fill" aria-hidden="true" />
                MFA enrolled
              </span>
            ) : (
              <span className="flex items-center gap-1.5 text-amber-300">
                <ShieldSlash size={14} weight="fill" aria-hidden="true" />
                MFA missing
              </span>
            )}
          </Info>
          <Info label="Login account">
            {m.user_id ? "Linked" : "None"}
          </Info>
          <Info label="Force password change">
            {m.must_change_password ? "Yes (on next sign-in)" : "No"}
          </Info>
          <Info label="Invited">{fmtDate(m.invited_at)}</Info>
          <Info label="Activated">{fmtDate(m.activated_at)}</Info>
          {m.offboarded_at && (
            <Info label="Offboarded">{fmtDate(m.offboarded_at)}</Info>
          )}
          <Info label="Created">{fmtDate(m.created_at)}</Info>
        </div>
      </div>

      {/* Actions */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <h2 className="font-bebas text-xl tracking-wider text-cream mb-1">Actions</h2>
        <p className="text-xs text-cream/40 mb-4">
          Every action is written to the audit log with your name on it.
        </p>

        {m.status === "offboarded" ? (
          <p className="text-sm text-cream/50">
            This member has been offboarded. To bring them back, provision a new
            team member instead.
          </p>
        ) : (
          <div className="flex flex-wrap gap-3">
            {hasLogin && m.status !== "pending" && (
              <button
                onClick={() => setResetOpen(true)}
                className={`${actionBtn} border-electric/30 text-electric bg-electric/10`}
              >
                <PaperPlaneTilt size={15} aria-hidden="true" /> Reset password
              </button>
            )}

            {m.status === "active" && (
              <button
                onClick={() => setConfirmSuspend(true)}
                className={`${actionBtn} border-amber-400/30 text-amber-300 bg-amber-400/10`}
              >
                <Prohibit size={15} aria-hidden="true" /> Suspend
              </button>
            )}

            {m.status === "suspended" && (
              <button
                onClick={() => setConfirmReactivate(true)}
                className={`${actionBtn} border-green-400/30 text-green-300 bg-green-400/10`}
              >
                <ArrowCounterClockwise size={15} aria-hidden="true" /> Reactivate
              </button>
            )}

            <button
              onClick={() => setOffboardOpen(true)}
              className={`${actionBtn} border-red-400/30 text-red-400 bg-red-400/10`}
            >
              <UserMinus size={15} aria-hidden="true" /> Offboard
            </button>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}

      {/* Reset password (form modal so the optional reveal can render in place) */}
      <AdminModalShell
        open={resetOpen}
        onClose={closeReset}
        busy={busy}
        labelId="team-reset-title"
        borderClass="border-electric/30"
      >
        <h3
          id="team-reset-title"
          className="font-bebas text-2xl tracking-wider text-electric mb-1"
        >
          Reset password
        </h3>
        <p className="text-xs text-cream/50 mb-4">
          Emails a one-time setup link to {m.personal_email ?? "the personal address"} and
          forces a new password on next sign-in.
        </p>
        <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={showLink}
            onChange={(e) => setShowLink(e.target.checked)}
            className="mt-0.5 accent-electric"
          />
          <span className="text-sm text-cream/70">
            Show me the link too. Use this only if email delivery is unreliable.
            The link is bearer-equivalent, so handle it carefully and never paste
            it anywhere shared.
          </span>
        </label>

        {revealedLink && (
          <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3 mb-4">
            <div className="text-[11px] uppercase tracking-wider text-amber-300 font-bold mb-1">
              One-time reset link
            </div>
            <p className="text-xs text-cream/80 font-mono break-all">
              {revealedLink}
            </p>
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={closeReset}
            disabled={busy}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
          >
            {revealedLink ? "Done" : "Cancel"}
          </button>
          <button
            onClick={submitReset}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-sm font-bold bg-electric/20 border border-electric/40 text-electric disabled:opacity-60"
          >
            {busy ? "Working..." : revealedLink ? "Resend" : "Send reset link"}
          </button>
        </div>
      </AdminModalShell>

      {/* Suspend */}
      <ConfirmModal
        open={confirmSuspend}
        onClose={() => setConfirmSuspend(false)}
        onConfirm={submitSuspend}
        title="Suspend this member?"
        message={`${m.full_name} will be blocked from signing in and their sessions will end at the next token refresh. You can reactivate them later. This is logged to the audit trail.`}
        confirmLabel="Suspend"
        destructive
      />

      {/* Reactivate */}
      <ConfirmModal
        open={confirmReactivate}
        onClose={() => setConfirmReactivate(false)}
        onConfirm={submitReactivate}
        title="Reactivate this member?"
        message={`${m.full_name} will be able to sign in again immediately. This is logged to the audit trail.`}
        confirmLabel="Reactivate"
      />

      {/* Offboard (type-the-username confirm) */}
      <AdminModalShell
        open={offboardOpen}
        onClose={() => {
          setOffboardOpen(false);
          setConfirmUsername("");
          setHardOffboard(false);
        }}
        busy={busy}
        labelId="team-offboard-title"
        borderClass="border-red-400/30"
        background="linear-gradient(135deg, rgba(20,8,14,0.98), rgba(8,4,8,0.98))"
      >
        <h3
          id="team-offboard-title"
          className="font-bebas text-2xl tracking-wider text-red-400 mb-1"
        >
          Offboard member
        </h3>
        <p className="text-xs text-cream/60 mb-4 leading-relaxed">
          A soft offboard closes their login, ends active sessions, and forwards
          their mailbox to the team. The member record is kept for the audit
          trail. A hard offboard also deletes the mailbox so new mail bounces.
        </p>

        <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">
          Type the username to confirm
        </label>
        <input
          value={confirmUsername}
          onChange={(e) => setConfirmUsername(e.target.value)}
          placeholder={m.username}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="w-full mb-4 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-red-400/40 font-mono"
        />

        <label className="flex items-start gap-2.5 mb-4 cursor-pointer">
          <input
            type="checkbox"
            checked={hardOffboard}
            onChange={(e) => setHardOffboard(e.target.checked)}
            className="mt-0.5 accent-red-400"
          />
          <span className="text-sm text-cream/70">
            Hard offboard. Also delete the mailbox. New mail to{" "}
            <span className="font-mono text-xs">{m.email_address}</span> will
            bounce.
          </span>
        </label>

        <div className="flex gap-2">
          <button
            onClick={() => {
              setOffboardOpen(false);
              setConfirmUsername("");
              setHardOffboard(false);
            }}
            disabled={busy}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={submitOffboard}
            disabled={busy || !usernameMatches}
            className="flex-1 py-3 rounded-xl text-sm font-bold text-white disabled:opacity-50"
            style={{
              background: "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)",
            }}
          >
            {busy ? "Working..." : hardOffboard ? "Hard offboard" : "Offboard"}
          </button>
        </div>
      </AdminModalShell>
    </div>
  );
}
