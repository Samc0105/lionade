"use client";

/**
 * SubscriptionGrantCard — admin control on /admin/users/[id].
 *
 * Surfaces the user's current EFFECTIVE plan (from profiles.plan, resolved
 * server-side from Stripe baseline + active grants) and, if present, the ACTIVE
 * manual grant row (migration 065 plan_grants: tier, expiry, reason, source,
 * who issued it). Lets staff:
 *
 *   - Grant a Pro/Platinum entitlement for a fixed window or Lifetime
 *       POST /api/admin/users/[id]/grant-plan { tier, durationDays, reason }
 *       (durationDays = null for Lifetime)
 *   - Revoke the active grant (soft-revoke, audited)
 *       POST /api/admin/users/[id]/revoke-plan {}
 *
 * The active grant is read independently of the page's user GET via
 *   GET /api/admin/users/[id]/grant-plan  ->  { grant: ActiveGrant | null }
 * so the card owns its own freshness; both POSTs revalidate it. The card does
 * not own the effective-plan readout — it takes the page's already-resolved
 * `plan` as a prop and revalidates the page after a write so profiles.plan
 * (which the resolver bumps) re-reads.
 *
 * This is an internal staff tool: clear and dense, not consumer-polished.
 *
 * Lives at /Users/samc/Desktop/lionade/components/admin/SubscriptionGrantCard.tsx.
 */

import { useState } from "react";
import useSWR from "swr";
import { swrFetcher, apiPost } from "@/lib/api-client";
import { toastSuccess, toastError } from "@/lib/toast";
import ConfirmModal from "@/components/ConfirmModal";
import { Crown } from "@phosphor-icons/react";
import { CARD_BG } from "@/components/admin/shared";

/** Active grant row, as the grant endpoints surface it (snake_case columns mapped to camelCase). */
export interface ActiveGrant {
  id: string;
  tier: "pro" | "platinum";
  /** null === Lifetime grant. */
  expiresAt: string | null;
  reason: string | null;
  /** 'admin' | 'promo' | 'support' | 'comp' | ... — free-form per migration 065. */
  source: string | null;
  /** username of the staff member who issued it, if resolvable. */
  grantedByUsername: string | null;
  createdAt: string;
}

type GrantTier = "pro" | "platinum";

/** value === durationDays sent to the API; null === Lifetime. */
const DURATIONS: { label: string; days: number | null }[] = [
  { label: "1 month", days: 30 },
  { label: "3 months", days: 90 },
  { label: "6 months", days: 180 },
  { label: "1 year", days: 365 },
  { label: "Lifetime", days: null },
];

function planLabel(plan: string | null | undefined): string {
  return (plan ?? "free").toUpperCase();
}

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleString() : "—";
}

function planPillClass(plan: string): string {
  switch (plan) {
    case "PLATINUM":
      return "bg-gold/15 text-gold border-gold/30";
    case "PRO":
      return "bg-electric/15 text-electric border-electric/30";
    default:
      return "bg-white/10 text-cream/50 border-white/10";
  }
}

export default function SubscriptionGrantCard({
  userId,
  /** Effective plan already resolved by the page's user GET (profiles.plan). */
  plan,
  /** Revalidate the page after a write so the effective-plan readout re-reads. */
  onChanged,
}: {
  userId: string;
  plan: string | null | undefined;
  onChanged?: () => void;
}) {
  const grantKey = `/api/admin/users/${userId}/grant-plan`;
  const {
    data,
    isLoading,
    mutate: mutateGrant,
  } = useSWR<{ grant: ActiveGrant | null }>(grantKey, swrFetcher, {
    keepPreviousData: true,
    revalidateOnFocus: true,
  });

  const grant = data?.grant ?? null;

  // ── form state ────────────────────────────────────────────────────
  const [tier, setTier] = useState<GrantTier>("pro");
  const [durationIdx, setDurationIdx] = useState(0); // default 1 month
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const effective = planLabel(plan);

  const submitGrant = async () => {
    if (busy) return;
    setBusy(true);
    const duration = DURATIONS[durationIdx];
    const res = await apiPost<{ grant: ActiveGrant | null; plan?: string }>(
      `/api/admin/users/${userId}/grant-plan`,
      {
        tier,
        durationDays: duration.days, // null === Lifetime
        reason: reason.trim() || null,
      },
    );
    setBusy(false);
    if (res.ok) {
      toastSuccess(
        `Granted ${tier === "platinum" ? "Platinum" : "Pro"} (${duration.label})`,
      );
      setReason("");
      // Optimistic: drop the freshly-issued grant straight into the card.
      if (res.data?.grant) {
        void mutateGrant({ grant: res.data.grant }, { revalidate: true });
      } else {
        void mutateGrant();
      }
      onChanged?.();
    } else {
      toastError(res.error ?? "Grant failed");
      void mutateGrant();
    }
  };

  const submitRevoke = async () => {
    if (busy) return;
    setBusy(true);
    const res = await apiPost<{ grant: ActiveGrant | null; plan?: string }>(
      `/api/admin/users/${userId}/revoke-plan`,
      {},
    );
    setBusy(false);
    if (res.ok) {
      toastSuccess("Grant revoked");
      setConfirmRevoke(false);
      // Optimistic: clear the active grant immediately.
      void mutateGrant({ grant: null }, { revalidate: true });
      onChanged?.();
    } else {
      toastError(res.error ?? "Revoke failed");
      void mutateGrant();
    }
  };

  const inputCls =
    "w-full px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-gold/40";
  const labelCls =
    "block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1";

  return (
    <div
      className="rounded-2xl border border-white/[0.08] p-6"
      style={{ background: CARD_BG }}
    >
      <div className="flex items-center justify-between mb-1">
        <h2 className="font-bebas text-xl tracking-wider text-cream flex items-center gap-2">
          <Crown size={18} className="text-gold" aria-hidden="true" />
          Subscription grant
        </h2>
        <span
          className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${planPillClass(
            effective,
          )}`}
        >
          {effective}
        </span>
      </div>
      <p className="text-xs text-cream/40 mb-4">
        Effective plan is resolved server-side from Stripe plus active grants.
        Grants and revokes are written to the audit log with your name on them.
      </p>

      {/* Active grant readout */}
      {isLoading && !data ? (
        <div className="h-16 rounded-xl bg-white/[0.04] animate-pulse mb-5" />
      ) : grant ? (
        <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
                Active grant
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border ${planPillClass(
                  grant.tier.toUpperCase(),
                )}`}
              >
                {grant.tier}
              </span>
            </div>
            <button
              onClick={() => setConfirmRevoke(true)}
              disabled={busy}
              className="text-[11px] font-bold text-red-400 hover:text-red-300 transition-colors disabled:opacity-50"
            >
              Revoke
            </button>
          </div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <div>
              <div className={labelCls}>Expires</div>
              <div className="text-sm text-cream/85">
                {grant.expiresAt ? (
                  fmtDate(grant.expiresAt)
                ) : (
                  <span className="text-gold font-bold">Lifetime</span>
                )}
              </div>
            </div>
            <div>
              <div className={labelCls}>Granted</div>
              <div className="text-sm text-cream/85">
                {fmtDate(grant.createdAt)}
              </div>
            </div>
            <div>
              <div className={labelCls}>Granted by</div>
              <div className="text-sm text-cream/85">
                {grant.grantedByUsername ?? "—"}
                {grant.source ? (
                  <span className="ml-2 text-[11px] font-mono text-cream/40">
                    {grant.source}
                  </span>
                ) : null}
              </div>
            </div>
            <div>
              <div className={labelCls}>Reason</div>
              <div className="text-sm text-cream/85">
                {grant.reason?.trim() || "—"}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 mb-5 text-sm text-cream/45">
          No active grant on this user.
        </div>
      )}

      {/* Grant form */}
      <div className="space-y-4">
        <div>
          <span className={labelCls}>Tier</span>
          <div className="flex gap-2">
            {(["pro", "platinum"] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={`flex-1 py-2.5 rounded-xl border text-sm font-bold capitalize transition-all ${
                  tier === t
                    ? "border-gold/50 bg-gold/15 text-gold"
                    : "border-white/10 text-cream/50 hover:bg-white/5"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="grant-duration" className={labelCls}>
            Duration
          </label>
          <select
            id="grant-duration"
            value={durationIdx}
            onChange={(e) => setDurationIdx(Number(e.target.value))}
            className={inputCls}
          >
            {DURATIONS.map((d, i) => (
              <option key={d.label} value={i} className="bg-[#0a1020]">
                {d.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="grant-reason" className={labelCls}>
            Reason (optional, logged)
          </label>
          <input
            id="grant-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. support comp for billing issue"
            maxLength={300}
            className={inputCls}
          />
        </div>

        <button
          onClick={submitGrant}
          disabled={busy}
          className="w-full py-3 rounded-xl text-sm font-bold disabled:opacity-60"
          style={{
            background:
              "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
            color: "#04080F",
          }}
        >
          {busy
            ? "Working..."
            : grant
              ? "Replace grant"
              : `Grant ${tier === "platinum" ? "Platinum" : "Pro"}`}
        </button>
        {grant && (
          <p className="text-[11px] text-cream/35 -mt-1">
            Granting again issues a fresh grant. Use Revoke to remove the
            current one.
          </p>
        )}
      </div>

      <ConfirmModal
        open={confirmRevoke}
        onClose={() => setConfirmRevoke(false)}
        onConfirm={submitRevoke}
        title="Revoke this grant?"
        message="The manual entitlement is removed and the effective plan is recomputed from Stripe plus any remaining grants. This is logged to the audit trail."
        confirmLabel="Revoke grant"
        destructive
      />
    </div>
  );
}
