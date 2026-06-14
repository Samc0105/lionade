"use client";

/**
 * /admin/users/[id] — single-user support view + actions. Staff only.
 *
 * Actions (each one server-enforced and written to admin_audit_log):
 *   - Send password reset   support + admin   (logs password_reset)
 *   - Reveal raw email      admin only        (logs view_email)
 *   - Adjust Fangs          admin only        (requires reason, logs fangs_adjust)
 *   - Change role           admin only        (logs role_change)
 *   - Suspend / reinstate   admin only        (logs suspend / unsuspend)
 *
 * Support staff see only the actions they're allowed to take; the server
 * re-checks the role regardless. Every destructive action confirms first.
 */

import { useState } from "react";
import { useParams } from "next/navigation";
import useSWR from "swr";
import { swrFetcher, apiPost, apiGet } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import ConfirmModal from "@/components/ConfirmModal";
import { toastSuccess, toastError } from "@/lib/toast";
import {
  EnvelopeSimple,
  Eye,
  PaperPlaneTilt,
  Coins,
  IdentificationBadge,
  Prohibit,
  ArrowCounterClockwise,
} from "@phosphor-icons/react";
import { CARD_BG, RoleBadge, AdminModalShell } from "@/components/admin/shared";
import SubscriptionGrantCard from "@/components/admin/SubscriptionGrantCard";

interface AdminUserDetail {
  id: string;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  role: "user" | "support" | "admin";
  coins: number;
  fangsCashable: number;
  fangsIap: number;
  lifetimeFangsSpent: number;
  xp: number;
  level: number;
  streak: number;
  maxStreak: number;
  plan: string;
  subscriptionTier: string;
  createdAt: string;
  lastSeen: string | null;
  onboardingCompleted: boolean | null;
  emailMasked: string | null;
  emailConfirmedAt: string | null;
  lastSignInAt: string | null;
  suspended: boolean;
  bannedUntil: string | null;
  /** true when the auth.users lookup failed — suspension/email unknown */
  authMetaUnavailable?: boolean;
}

interface Txn {
  id: string;
  amount: number;
  type: string;
  description: string | null;
  created_at: string;
}

interface AuditEntry {
  id: string;
  performed_by: string;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

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

export default function AdminUserDetailPage() {
  const params = useParams<{ id: string }>();
  const userId = params.id;
  const { isAdmin } = useAdminRole();

  const detailKey = `/api/admin/users/${userId}`;
  const { data, error, mutate } = useSWR<{
    user: AdminUserDetail;
    transactions: Txn[];
    auditEntries: AuditEntry[];
  }>(detailKey, swrFetcher);

  const u = data?.user;

  // ── action state ──────────────────────────────────────────────────
  const [revealedEmail, setRevealedEmail] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [fangsOpen, setFangsOpen] = useState(false);
  const [fangAmount, setFangAmount] = useState("");
  const [fangReason, setFangReason] = useState("");
  const [roleOpen, setRoleOpen] = useState(false);
  const [newRole, setNewRole] = useState<"user" | "support" | "admin">("user");
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [suspendReason, setSuspendReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (error) {
    return (
      <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3">
        Could not load this user.
      </div>
    );
  }
  if (!u) {
    return <div className="h-40 rounded-2xl bg-white/[0.04] animate-pulse" />;
  }

  const avatar =
    u.avatarUrl ??
    `https://api.dicebear.com/7.x/avataaars/svg?seed=${u.username ?? u.id}&backgroundColor=4A90D9`;

  const revealEmail = async () => {
    if (busy) return; // double-click guard — each reveal is an audited event
    setBusy(true);
    const res = await apiGet<{ email: string | null }>(
      `/api/admin/users/${userId}/email`,
    );
    setBusy(false);
    if (res.ok) setRevealedEmail(res.data?.email ?? "(no email)");
    else toastError("Could not reveal email");
  };

  const sendReset = async () => {
    const res = await apiPost(`/api/admin/users/${userId}/reset-password`, {});
    if (res.ok) {
      toastSuccess("Password reset email sent");
      setConfirmReset(false);
      void mutate();
    } else {
      toastError(res.error ?? "Reset failed");
    }
  };

  const submitFangs = async () => {
    const amount = Math.trunc(Number(fangAmount));
    if (!Number.isFinite(amount) || amount === 0) {
      toastError("Enter a non-zero whole number");
      return;
    }
    if (fangReason.trim().length < 3) {
      toastError("A reason is required");
      return;
    }
    setBusy(true);
    const res = await apiPost(`/api/admin/users/${userId}/fangs`, {
      amount,
      reason: fangReason.trim(),
    });
    setBusy(false);
    if (res.ok) {
      toastSuccess(`Fangs ${amount > 0 ? "added" : "deducted"}`);
      setFangsOpen(false);
      setFangAmount("");
      setFangReason("");
      void mutate();
    } else {
      toastError(res.error ?? "Adjustment failed");
    }
  };

  const submitRole = async () => {
    setBusy(true);
    const res = await apiPost(`/api/admin/users/${userId}/role`, { role: newRole });
    setBusy(false);
    if (res.ok) {
      toastSuccess(`Role set to ${newRole}`);
      setRoleOpen(false);
      void mutate();
    } else {
      toastError(res.error ?? "Role change failed");
    }
  };

  const submitSuspend = async () => {
    setBusy(true);
    const res = await apiPost(`/api/admin/users/${userId}/suspend`, {
      suspend: !u.suspended,
      reason: suspendReason.trim(),
    });
    setBusy(false);
    if (res.ok) {
      toastSuccess(u.suspended ? "Account reinstated" : "Account suspended");
      setSuspendOpen(false);
      setSuspendReason("");
      void mutate();
    } else {
      toastError(res.error ?? "Update failed");
    }
  };

  const actionBtn =
    "flex items-center gap-2 px-4 py-2.5 rounded-xl border text-sm font-bold transition-all hover:brightness-110";

  return (
    <div className="space-y-5">
      {u.authMetaUnavailable && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-300 text-sm px-4 py-3">
          The auth record could not be loaded. Email and suspension state are
          unknown on this view; do not treat &quot;not suspended&quot; as fact.
        </div>
      )}

      {/* Header */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6 flex items-center gap-5"
        style={{ background: CARD_BG }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={avatar}
          alt=""
          className="w-16 h-16 rounded-full border border-white/10 bg-white/5"
        />
        <div className="min-w-0">
          <div className="flex items-center gap-3">
            <h1 className="font-bebas text-3xl tracking-wider text-cream truncate">
              {u.username ?? "(no username)"}
            </h1>
            <RoleBadge role={u.role} />
            {u.suspended && (
              <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-red-400/15 text-red-400 border border-red-400/30">
                suspended
              </span>
            )}
          </div>
          <div className="text-sm text-cream/50">
            {u.displayName} · ID <span className="font-mono text-xs">{u.id}</span>
          </div>
        </div>
      </div>

      {/* Account info */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <h2 className="font-bebas text-xl tracking-wider text-cream mb-4">Account</h2>
        <div className="grid grid-cols-3 gap-x-6 gap-y-5">
          <Info label="Email">
            <span className="flex items-center gap-2">
              <EnvelopeSimple size={14} className="text-cream/40" aria-hidden="true" />
              <span className="font-mono text-xs">
                {revealedEmail ?? u.emailMasked ?? "—"}
              </span>
              {isAdmin && !revealedEmail && (
                <button
                  onClick={revealEmail}
                  className="flex items-center gap-1 text-[11px] font-bold text-gold/80 hover:text-gold transition-colors"
                  title="Audited action: logged as view_email"
                >
                  <Eye size={12} aria-hidden="true" /> Reveal
                </button>
              )}
            </span>
          </Info>
          <Info label="Joined">{fmtDate(u.createdAt)}</Info>
          <Info label="Last sign-in">{fmtDate(u.lastSignInAt)}</Info>
          <Info label="Last seen">{fmtDate(u.lastSeen)}</Info>
          <Info label="Email confirmed">{fmtDate(u.emailConfirmedAt)}</Info>
          <Info label="Onboarding">
            {u.onboardingCompleted ? "Completed" : "Not completed"}
          </Info>
          <Info label="Plan">{u.plan}</Info>
          <Info label="Subscription tier">{u.subscriptionTier}</Info>
          {u.suspended && (
            <Info label="Suspended until">{fmtDate(u.bannedUntil)}</Info>
          )}
        </div>
      </div>

      {/* Stats */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <h2 className="font-bebas text-xl tracking-wider text-cream mb-4">Stats</h2>
        <div className="grid grid-cols-4 gap-x-6 gap-y-5">
          <Info label="Fang balance">{u.coins.toLocaleString()}</Info>
          <Info label="Cashable / IAP">
            {u.fangsCashable.toLocaleString()} / {u.fangsIap.toLocaleString()}
          </Info>
          <Info label="Lifetime spent">{u.lifetimeFangsSpent.toLocaleString()}</Info>
          <Info label="Level / XP">
            {u.level} · {u.xp.toLocaleString()} XP
          </Info>
          <Info label="Streak">{u.streak} days</Info>
          <Info label="Max streak">{u.maxStreak} days</Info>
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
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setConfirmReset(true)}
            className={`${actionBtn} border-electric/30 text-electric bg-electric/10`}
          >
            <PaperPlaneTilt size={15} aria-hidden="true" /> Send password reset
          </button>
          {isAdmin && (
            <>
              <button
                onClick={() => setFangsOpen(true)}
                className={`${actionBtn} border-gold/30 text-gold bg-gold/10`}
              >
                <Coins size={15} aria-hidden="true" /> Adjust Fangs
              </button>
              <button
                onClick={() => {
                  setNewRole(u.role);
                  setRoleOpen(true);
                }}
                className={`${actionBtn} border-purple-400/30 text-purple-300 bg-purple-400/10`}
              >
                <IdentificationBadge size={15} aria-hidden="true" /> Change role
              </button>
              <button
                onClick={() => setSuspendOpen(true)}
                className={`${actionBtn} ${
                  u.suspended
                    ? "border-green-400/30 text-green-300 bg-green-400/10"
                    : "border-red-400/30 text-red-400 bg-red-400/10"
                }`}
              >
                {u.suspended ? (
                  <>
                    <ArrowCounterClockwise size={15} aria-hidden="true" /> Reinstate account
                  </>
                ) : (
                  <>
                    <Prohibit size={15} aria-hidden="true" /> Suspend account
                  </>
                )}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Subscription grant (admin only — issuing a paid tier has economic value) */}
      {isAdmin && (
        <SubscriptionGrantCard
          userId={userId}
          plan={u.plan}
          onChanged={() => void mutate()}
        />
      )}

      {/* Recent Fang transactions */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <h2 className="font-bebas text-xl tracking-wider text-cream mb-4">
          Recent Fang activity
        </h2>
        {data.transactions.length === 0 ? (
          <p className="text-sm text-cream/40">No transactions yet.</p>
        ) : (
          <div className="space-y-2">
            {data.transactions.map((t) => (
              <div
                key={t.id}
                className="flex items-center justify-between text-sm border-b border-white/[0.04] last:border-0 pb-2 last:pb-0"
              >
                <div className="min-w-0">
                  <span className="text-cream/80">{t.description ?? t.type}</span>
                  <span className="ml-2 text-[11px] text-cream/35 font-mono">{t.type}</span>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <span
                    className={`font-bold ${t.amount >= 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {t.amount >= 0 ? "+" : ""}
                    {t.amount.toLocaleString()}
                  </span>
                  <span className="text-xs text-cream/40 w-36 text-right">
                    {fmtDate(t.created_at)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Admin actions on this user */}
      <div
        className="rounded-2xl border border-white/[0.08] p-6"
        style={{ background: CARD_BG }}
      >
        <h2 className="font-bebas text-xl tracking-wider text-cream mb-4">
          Admin history for this user
        </h2>
        {data.auditEntries.length === 0 ? (
          <p className="text-sm text-cream/40">No admin actions recorded.</p>
        ) : (
          <div className="space-y-2">
            {data.auditEntries.map((a) => (
              <div
                key={a.id}
                className="flex items-center justify-between text-sm border-b border-white/[0.04] last:border-0 pb-2 last:pb-0"
              >
                <div>
                  <span className="font-mono text-xs px-1.5 py-0.5 rounded bg-white/[0.06] text-cream/80">
                    {a.action}
                  </span>
                  {Object.keys(a.metadata ?? {}).length > 0 && (
                    <span className="ml-2 text-xs text-cream/45">
                      {JSON.stringify(a.metadata)}
                    </span>
                  )}
                </div>
                <span className="text-xs text-cream/40">{fmtDate(a.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────── */}

      <ConfirmModal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        onConfirm={sendReset}
        title="Send password reset?"
        message={`A reset link will be emailed to ${u.username ?? "this user"}. This is logged to the audit trail.`}
        confirmLabel="Send reset email"
      />

      {/* Adjust Fangs */}
      <AdminModalShell
        open={fangsOpen}
        onClose={() => setFangsOpen(false)}
        busy={busy}
        labelId="fangs-modal-title"
        borderClass="border-gold/25"
      >
        <h3 id="fangs-modal-title" className="font-bebas text-2xl tracking-wider text-gold mb-1">
          Adjust Fangs
        </h3>
            <p className="text-xs text-cream/50 mb-4">
              Positive adds, negative deducts. Current balance:{" "}
              {u.coins.toLocaleString()}. Logged with your reason.
            </p>
            <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              Amount
            </label>
            <input
              value={fangAmount}
              onChange={(e) => setFangAmount(e.target.value)}
              placeholder="e.g. 500 or -250"
              inputMode="numeric"
              className="w-full mb-3 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-gold/40"
            />
            <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              Reason (required)
            </label>
            <textarea
              value={fangReason}
              onChange={(e) => setFangReason(e.target.value)}
              placeholder="Why is this adjustment happening?"
              rows={2}
              maxLength={300}
              className="w-full mb-4 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-gold/40 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setFangsOpen(false)}
                disabled={busy}
                className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={submitFangs}
                disabled={busy}
                className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
                style={{
                  background:
                    "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                  color: "#04080F",
                }}
              >
                {busy ? "Working..." : "Apply adjustment"}
              </button>
            </div>
      </AdminModalShell>

      {/* Change role */}
      <AdminModalShell
        open={roleOpen}
        onClose={() => setRoleOpen(false)}
        busy={busy}
        labelId="role-modal-title"
        borderClass="border-purple-400/25"
      >
        <h3 id="role-modal-title" className="font-bebas text-2xl tracking-wider text-purple-300 mb-1">
          Change role
        </h3>
            <p className="text-xs text-cream/50 mb-4">
              support = read access + password resets. admin = full console access.
            </p>
            <div className="flex gap-2 mb-5">
              {(["user", "support", "admin"] as const).map((r) => (
                <button
                  key={r}
                  onClick={() => setNewRole(r)}
                  className={`flex-1 py-2.5 rounded-xl border text-sm font-bold capitalize transition-all ${
                    newRole === r
                      ? "border-purple-400/50 bg-purple-400/15 text-purple-200"
                      : "border-white/10 text-cream/50 hover:bg-white/5"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setRoleOpen(false)}
                disabled={busy}
                className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={submitRole}
                disabled={busy || newRole === u.role}
                className="flex-1 py-3 rounded-xl text-sm font-bold bg-purple-400/20 border border-purple-400/40 text-purple-200 disabled:opacity-50"
              >
                {busy ? "Working..." : `Set to ${newRole}`}
              </button>
            </div>
      </AdminModalShell>

      {/* Suspend / reinstate */}
      <AdminModalShell
        open={suspendOpen}
        onClose={() => setSuspendOpen(false)}
        busy={busy}
        labelId="suspend-modal-title"
        borderClass={u.suspended ? "border-green-400/25" : "border-red-400/30"}
        background={
          u.suspended
            ? undefined
            : "linear-gradient(135deg, rgba(20,8,14,0.98), rgba(8,4,8,0.98))"
        }
      >
        <h3
          id="suspend-modal-title"
          className={`font-bebas text-2xl tracking-wider mb-1 ${
            u.suspended ? "text-green-300" : "text-red-400"
          }`}
        >
          {u.suspended ? "Reinstate account?" : "Suspend account?"}
        </h3>
            <p className="text-xs text-cream/50 mb-4">
              {u.suspended
                ? "The user will be able to sign in again immediately."
                : "The user will be blocked from signing in. Active sessions end at the next token refresh."}
            </p>
            <label className="block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              Reason (optional, logged)
            </label>
            <textarea
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              rows={2}
              maxLength={300}
              className="w-full mb-4 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-red-400/40 resize-none"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setSuspendOpen(false)}
                disabled={busy}
                className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                onClick={submitSuspend}
                disabled={busy}
                className={`flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-60 ${
                  u.suspended
                    ? "bg-green-400/20 border border-green-400/40 text-green-200"
                    : "text-white"
                }`}
                style={
                  u.suspended
                    ? undefined
                    : {
                        background:
                          "linear-gradient(135deg, #DC2626 0%, #991B1B 100%)",
                      }
                }
              >
                {busy ? "Working..." : u.suspended ? "Reinstate" : "Suspend"}
              </button>
            </div>
      </AdminModalShell>
    </div>
  );
}
