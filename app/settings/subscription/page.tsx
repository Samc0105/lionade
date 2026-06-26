"use client";

/**
 * /settings/subscription — Subscription section of the route-based settings
 * overhaul.
 *
 * Renders INSIDE app/settings/layout.tsx, which already provides
 * ProtectedRoute + Navbar + SpaceBackground + the section nav rail + page
 * header. This page is content-only — it uses the shared SettingsCard
 * primitive and never re-wraps the chrome (which would double the navbar /
 * background / auth gate).
 *
 * Data sources (all read directly from `profiles`, client-readable via the
 * same Supabase row-level access usePlan() already uses):
 *   - plan / isPaid                → lib/use-plan (profiles.plan)
 *   - renewal + amount + cancel    → profiles.subscription_current_period_end,
 *                                    subscription_cycle, subscription_status,
 *                                    subscription_cancel_at (written by the
 *                                    Stripe webhook). Amount is derived from
 *                                    PLAN_PRICING[plan][cycle]. If the period
 *                                    end isn't populated we show "Manage
 *                                    billing for details" rather than fake a
 *                                    date.
 *   - Manage billing               → POST /api/stripe/portal → redirect to url
 *
 * Usage this month (REAL counts only, never fabricated):
 *   - Mastery targets used / limit → COUNT(user_exams WHERE archived=false)
 *                                    vs PLAN_EXAM_LIMITS[plan]. This is a real,
 *                                    plan-gated metric → rendered as a fill bar.
 *   - Ninny sessions this month    → COUNT(ninny_sessions WHERE completed_at
 *                                    >= start-of-month). There is NO plan cap
 *                                    on Ninny sessions anywhere in the codebase,
 *                                    so this is shown as a real count with an
 *                                    "Unlimited" cap, no fake fill.
 *   - AI vocab lookups             → NO usage source or plan limit exists in
 *                                    the codebase. Rendered as a clearly-labeled
 *                                    "usage tracking coming soon" placeholder —
 *                                    no fabricated numbers, no fake fill.
 *
 * Plan comparison: a collapsed "See all features" toggle expands an inline
 * Free / Pro / Platinum matrix sourced from the same PLAN_* constants the
 * pricing page reads, so the two can't drift. GPU-only height/opacity expand;
 * reduced motion gets the instant open/close via globals.css.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useReducedMotion } from "framer-motion";
import {
  ArrowRight,
  Sparkle,
  Crown,
  CheckCircle,
  Check,
  X,
  CaretDown,
} from "@phosphor-icons/react";
import { SettingsCard } from "@/components/settings/shared";
import { usePlan } from "@/lib/use-plan";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import {
  PLAN_PRICING,
  PLAN_EXAM_LIMITS,
  PLAN_FANG_MULTIPLIER,
  PLAN_ADS,
} from "@/lib/mastery-plan";
import { apiPost } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

// ── Subscription detail shape read off the profile row ───────────────────────
interface SubscriptionDetail {
  status: string | null;
  currentPeriodEnd: string | null;
  cancelAt: string | null;
  cycle: "monthly" | "annual" | null;
}

async function fetchSubscriptionDetail(
  userId: string,
): Promise<SubscriptionDetail> {
  try {
    const { data } = await supabase
      .from("profiles")
      .select(
        "subscription_status, subscription_current_period_end, subscription_cancel_at, subscription_cycle",
      )
      .eq("id", userId)
      .single();
    const row = (data ?? null) as {
      subscription_status?: string | null;
      subscription_current_period_end?: string | null;
      subscription_cancel_at?: string | null;
      subscription_cycle?: string | null;
    } | null;
    const cycle =
      row?.subscription_cycle === "annual"
        ? "annual"
        : row?.subscription_cycle === "monthly"
          ? "monthly"
          : null;
    return {
      status: row?.subscription_status ?? null,
      currentPeriodEnd: row?.subscription_current_period_end ?? null,
      cancelAt: row?.subscription_cancel_at ?? null,
      cycle,
    };
  } catch {
    return { status: null, currentPeriodEnd: null, cancelAt: null, cycle: null };
  }
}

// ── Usage shape — REAL counts only ───────────────────────────────────────────
interface UsageSnapshot {
  /** Active (non-archived) Mastery targets. Plan-gated → has a real cap. */
  masteryTargets: number;
  /** Ninny sessions completed since the 1st of this month. No plan cap. */
  ninnySessionsThisMonth: number;
}

async function fetchUsage(userId: string): Promise<UsageSnapshot> {
  const startOfMonth = (() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  })();

  const [targetsRes, ninnyRes] = await Promise.all([
    supabase
      .from("user_exams")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("archived", false),
    supabase
      .from("ninny_sessions")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .gte("completed_at", startOfMonth),
  ]);

  return {
    masteryTargets: targetsRes.count ?? 0,
    ninnySessionsThisMonth: ninnyRes.count ?? 0,
  };
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function SubscriptionSettingsPage() {
  const { plan, isPaid, isLoading: planLoading } = usePlan();
  const { user } = useAuth();
  const [portalLoading, setPortalLoading] = useState(false);

  const { data: detail } = useSWR<SubscriptionDetail>(
    isPaid && user?.id ? `subscription-detail/${user.id}` : null,
    () => fetchSubscriptionDetail(user!.id),
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  const { data: usage } = useSWR<UsageSnapshot>(
    user?.id ? `subscription-usage/${user.id}` : null,
    () => fetchUsage(user!.id),
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  async function openPortal() {
    if (portalLoading) return;
    setPortalLoading(true);
    try {
      const res = await apiPost<{ url: string }>("/api/stripe/portal", {});
      if (!res.ok || !res.data?.url) {
        console.error("[subscription:portal] failed", res.error);
        toastError("Couldn't open billing portal. Try again.");
        setPortalLoading(false);
        return;
      }
      window.location.href = res.data.url;
    } catch (e) {
      console.error("[subscription:portal] threw", e);
      toastError("Couldn't open billing portal. Try again.");
      setPortalLoading(false);
    }
  }

  // ── Loading skeleton ───────────────────────────────────────────────────────
  if (planLoading) {
    return (
      <>
        <div className="rounded-2xl border border-electric/10 p-6 mb-5">
          <div className="h-5 w-32 rounded bg-white/[0.06] animate-pulse mb-4" />
          <div className="h-9 w-40 rounded bg-white/[0.06] animate-pulse mb-5" />
          <div className="flex flex-col gap-2.5">
            <div className="h-4 w-3/4 rounded bg-white/[0.04] animate-pulse" />
            <div className="h-4 w-2/3 rounded bg-white/[0.04] animate-pulse" />
            <div className="h-4 w-1/2 rounded bg-white/[0.04] animate-pulse" />
          </div>
        </div>
        <div className="rounded-2xl border border-electric/10 p-6 mb-5">
          <div className="h-5 w-40 rounded bg-white/[0.06] animate-pulse mb-5" />
          <div className="flex flex-col gap-4">
            <div className="h-12 rounded bg-white/[0.04] animate-pulse" />
            <div className="h-12 rounded bg-white/[0.04] animate-pulse" />
          </div>
        </div>
      </>
    );
  }

  const isPlatinum = plan === "platinum";
  const isPro = plan === "pro";
  const planLabel = isPlatinum ? "Platinum" : isPro ? "Pro" : "Free";

  const renewalLabel = formatDate(detail?.currentPeriodEnd ?? null);
  const cancelLabel = formatDate(detail?.cancelAt ?? null);
  const cycle = detail?.cycle ?? "monthly";
  const amount =
    isPaid && cycle === "annual"
      ? PLAN_PRICING[plan].annual
      : PLAN_PRICING[plan].monthly;

  const masteryLimit = PLAN_EXAM_LIMITS[plan];

  return (
    <>
      {/* ── 1. Current plan ─────────────────────────────────────────────── */}
      <SettingsCard eyebrow="Your plan" title="Current subscription">
        <div className="flex flex-wrap items-center gap-3 mb-4">
          <span
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 border font-bebas text-[20px] tracking-wider leading-none ${
              isPlatinum
                ? "border-[#C0C6D6]/40 text-[#E8EAF2] bg-gradient-to-br from-white/[0.06] to-transparent"
                : isPro
                  ? "border-gold/40 text-gold bg-gradient-to-br from-gold/[0.08] to-transparent"
                  : "border-electric/30 text-cream bg-electric/[0.08]"
            }`}
          >
            {isPlatinum && <Crown size={15} weight="fill" aria-hidden="true" />}
            {isPro && <Sparkle size={14} weight="fill" aria-hidden="true" />}
            {planLabel}
          </span>
          {isPaid && (
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/65">
              {detail?.status === "past_due"
                ? "Payment past due"
                : detail?.cancelAt
                  ? "Cancels soon"
                  : "Active"}
            </span>
          )}
          {isPaid && (
            <span className="ml-auto font-bebas text-[20px] tabular-nums text-cream/85 tracking-wider">
              ${amount}
              <span className="text-cream/55 text-[11px] ml-1">
                / {cycle === "annual" ? "yr" : "mo"}
              </span>
            </span>
          )}
        </div>

        <ul className="flex flex-col gap-2 text-[13.5px] text-cream/80">
          <li className="flex items-center gap-2">
            <CheckCircle size={14} className="text-gold shrink-0" weight="fill" aria-hidden="true" />
            {masteryLimit} active Mastery {masteryLimit === 1 ? "target" : "targets"}
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle size={14} className="text-gold shrink-0" weight="fill" aria-hidden="true" />
            {PLAN_FANG_MULTIPLIER[plan]}× Fangs earn rate
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle size={14} className="text-gold shrink-0" weight="fill" aria-hidden="true" />
            {isPlatinum
              ? "Zero ads"
              : isPro
                ? "No popup ads (background only)"
                : "Includes popup and background ads"}
          </li>
          {isPaid && (
            <li className="flex items-center gap-2">
              <CheckCircle size={14} className="text-gold shrink-0" weight="fill" aria-hidden="true" />
              Unlimited Session Report PDF
            </li>
          )}
        </ul>
      </SettingsCard>

      {/* ── 2. Free → upgrade CTA ───────────────────────────────────────── */}
      {!isPaid && (
        <SettingsCard>
          <div className="flex items-center gap-2 mb-2">
            <Sparkle size={14} className="text-gold" weight="fill" aria-hidden="true" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold">
              What you&apos;re missing
            </span>
          </div>
          <h3 className="font-bebas text-[24px] tracking-wider text-cream leading-tight mb-3">
            Unlock the full grind
          </h3>
          <ul className="flex flex-col gap-2 text-[13.5px] text-cream/70 mb-5">
            <li className="flex items-center gap-2">
              <ArrowRight size={13} className="text-gold/70 shrink-0" weight="bold" aria-hidden="true" />
              Up to {PLAN_EXAM_LIMITS.platinum} active Mastery targets (you have {PLAN_EXAM_LIMITS.free})
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight size={13} className="text-gold/70 shrink-0" weight="bold" aria-hidden="true" />
              Up to {PLAN_FANG_MULTIPLIER.platinum}× Fangs earn rate
            </li>
            <li className="flex items-center gap-2">
              <ArrowRight size={13} className="text-gold/70 shrink-0" weight="bold" aria-hidden="true" />
              Drop the ads and unlock the Session Report PDF
            </li>
          </ul>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-full bg-gold text-navy font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-transform hover:scale-[1.03] active:scale-[0.98] transform-gpu motion-reduce:transform-none focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
            >
              See plans <ArrowRight size={12} weight="bold" aria-hidden="true" />
            </Link>
            <Link
              href="/pricing#faq"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] text-cream/80 hover:text-cream hover:border-white/[0.2] font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40"
            >
              FAQ
            </Link>
          </div>
        </SettingsCard>
      )}

      {/* ── 3. Paid → billing + manage ──────────────────────────────────── */}
      {isPaid && (
        <SettingsCard eyebrow="Billing" title="Manage subscription">
          <dl className="flex flex-col gap-3 mb-5 text-[13.5px]">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] pb-3">
              <dt className="text-cream/55">
                {detail?.cancelAt ? "Cancels on" : "Renews on"}
              </dt>
              <dd className="text-cream/90 font-medium text-right">
                {detail?.cancelAt
                  ? cancelLabel ?? "Manage billing for details"
                  : renewalLabel ?? "Manage billing for details"}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-cream/55">Billing amount</dt>
              <dd className="text-cream/90 font-medium text-right tabular-nums">
                ${amount} / {cycle === "annual" ? "year" : "month"}
              </dd>
            </div>
          </dl>

          <p className="text-[13px] text-cream/55 leading-relaxed mb-4">
            Update your payment method, switch billing cycle, view invoices, or
            cancel anytime in the Stripe Customer Portal.
          </p>
          <button
            type="button"
            onClick={openPortal}
            disabled={portalLoading}
            className="inline-flex items-center gap-1.5 rounded-full bg-electric text-navy font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-transform hover:scale-[1.03] active:scale-[0.98] transform-gpu motion-reduce:transform-none disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/50 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
          >
            {portalLoading ? (
              <>
                <span
                  aria-hidden="true"
                  className="w-3 h-3 rounded-full border-2 border-current border-t-transparent animate-spin"
                />
                Opening portal
              </>
            ) : (
              <>
                Manage billing <ArrowRight size={12} weight="bold" />
              </>
            )}
          </button>
        </SettingsCard>
      )}

      {/* ── 4. Usage this month ─────────────────────────────────────────── */}
      <SettingsCard eyebrow="This month" title="Usage">
        <div className="flex flex-col gap-5">
          {/* Mastery targets — REAL count, plan-gated cap → fill bar */}
          <UsageBar
            label="Active Mastery targets"
            used={usage?.masteryTargets ?? null}
            limit={masteryLimit}
            loading={!usage}
          />

          {/* Ninny sessions — REAL count, no plan cap → count, no fake fill */}
          <UsageBar
            label="Ninny study sessions"
            used={usage?.ninnySessionsThisMonth ?? null}
            limit={null}
            unlimitedNote="Unlimited on every plan"
            loading={!usage}
          />

          {/* AI vocab lookups usage row is hidden until a real metric source
             exists — it was shipping a "Tracking coming soon" placeholder to
             users in their billing settings. Re-add <UsagePlaceholder> once the
             metric is wired. */}
        </div>
      </SettingsCard>

      {/* ── 5. Plan comparison (collapsed toggle) ───────────────────────── */}
      <ComparisonToggle />

      <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/55 mt-2">
        Billing in USD · Cancel anytime
      </p>
    </>
  );
}

// ── UsageBar ─────────────────────────────────────────────────────────────────
// `limit` null = no plan cap → renders the count + an "unlimited" note and an
// indeterminate (always-full, muted) bar. `limit` set = real progress fill.
function UsageBar({
  label,
  used,
  limit,
  unlimitedNote,
  loading,
}: {
  label: string;
  used: number | null;
  limit: number | null;
  unlimitedNote?: string;
  loading: boolean;
}) {
  const pct =
    limit && used !== null ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = limit !== null && used !== null && used >= limit;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-cream/85 text-[13.5px] font-semibold">{label}</span>
        <span className="font-mono text-[12px] tabular-nums text-cream/65">
          {loading || used === null
            ? "…"
            : limit !== null
              ? `${used} / ${limit}`
              : used}
          {limit === null && unlimitedNote ? (
            <span className="text-cream/55 ml-2 normal-case">{unlimitedNote}</span>
          ) : null}
        </span>
      </div>
      <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-500 transform-gpu ${
            limit === null
              ? "w-full bg-electric/25"
              : atLimit
                ? "bg-gold"
                : "bg-electric"
          }`}
          style={limit === null ? undefined : { width: loading ? "0%" : `${pct}%` }}
          aria-hidden="true"
        />
      </div>
      {atLimit && (
        <p className="text-[11px] text-gold/80 mt-1.5">
          You&apos;re at your plan limit.{" "}
          <Link href="/pricing" className="underline hover:text-gold">
            Upgrade for more
          </Link>
          .
        </p>
      )}
    </div>
  );
}

// ── UsagePlaceholder ───────────────────────────────────────────────────────
// For metrics with no real source yet. NEVER fabricates a fill — a striped
// muted track + an explicit "coming soon" tag.
function UsagePlaceholder({ label }: { label: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-cream/55 text-[13.5px] font-semibold">{label}</span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/55">
          Tracking coming soon
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-white/[0.04] border border-dashed border-white/[0.08]"
        aria-hidden="true"
      />
    </div>
  );
}

// ── ComparisonToggle ─────────────────────────────────────────────────────────
// "See all features" → GPU-friendly height/opacity expand of an inline
// Free / Pro / Platinum matrix. Sourced from the same PLAN_* constants the
// pricing page reads. Reduced motion gets the instant open/close.
function ComparisonToggle() {
  const [open, setOpen] = useState(false);
  const reduce = useReducedMotion();
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [maxH, setMaxH] = useState(0);

  useEffect(() => {
    if (innerRef.current) setMaxH(innerRef.current.scrollHeight);
  }, [open]);

  const rows: { label: string; values: (string | boolean)[]; invert?: boolean }[] =
    [
      {
        label: "Active Mastery targets",
        values: [
          String(PLAN_EXAM_LIMITS.free),
          String(PLAN_EXAM_LIMITS.pro),
          String(PLAN_EXAM_LIMITS.platinum),
        ],
      },
      {
        label: "Fangs earn rate",
        values: [
          `${PLAN_FANG_MULTIPLIER.free}×`,
          `${PLAN_FANG_MULTIPLIER.pro}×`,
          `${PLAN_FANG_MULTIPLIER.platinum}×`,
        ],
      },
      { label: "Session Report PDF", values: [false, true, true] },
      {
        label: "Popup ads",
        values: [PLAN_ADS.free.popups, PLAN_ADS.pro.popups, PLAN_ADS.platinum.popups],
        invert: true,
      },
      {
        label: "Background ads",
        values: [
          PLAN_ADS.free.background,
          PLAN_ADS.pro.background,
          PLAN_ADS.platinum.background,
        ],
        invert: true,
      },
      { label: "Priority AI routing", values: [false, false, true] },
      { label: "Early access to features", values: [false, false, true] },
      { label: "Priority support", values: [false, true, true] },
    ];

  return (
    <SettingsCard>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center justify-between gap-3 text-left group rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40 focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
      >
        <span>
          <span className="font-bebas text-[20px] tracking-wider text-cream leading-none block">
            See all features
          </span>
          <span className="text-[12px] text-cream/60">
            Compare Free, Pro, and Platinum
          </span>
        </span>
        <CaretDown
          size={18}
          weight="bold"
          className={`text-cream/70 shrink-0 transition-transform duration-300 transform-gpu motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      <div
        className="overflow-hidden transition-[max-height,opacity] duration-300 transform-gpu motion-reduce:transition-none"
        style={{
          maxHeight: reduce ? (open ? "none" : 0) : open ? maxH : 0,
          opacity: open ? 1 : 0,
        }}
        aria-hidden={!open}
      >
        <div ref={innerRef} className="pt-5">
          <div className="rounded-xl border border-white/[0.08] overflow-hidden">
            <div className="grid grid-cols-[1.4fr_repeat(3,1fr)] text-[10.5px] font-mono uppercase tracking-[0.15em] text-cream/65 bg-white/[0.04] px-3 py-2.5 border-b border-white/[0.08]">
              <div>Feature</div>
              <div className="text-center">Free</div>
              <div className="text-center text-gold">Pro</div>
              <div className="text-center">Plat</div>
            </div>
            {rows.map((row, ri) => (
              <div
                key={row.label}
                className={`grid grid-cols-[1.4fr_repeat(3,1fr)] items-center text-[12.5px] px-3 py-2.5 ${
                  ri === rows.length - 1 ? "" : "border-b border-white/[0.05]"
                }`}
              >
                <div className="text-cream/80 pr-2">{row.label}</div>
                {row.values.map((v, i) => (
                  <div key={i} className="text-center">
                    <CompareCell value={v} invert={row.invert} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          <div className="mt-4 text-center">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/65 hover:text-cream transition-colors rounded focus:outline-none focus-visible:ring-2 focus-visible:ring-electric/40"
            >
              Full pricing page <ArrowRight size={11} weight="bold" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </div>
    </SettingsCard>
  );
}

function CompareCell({
  value,
  invert,
}: {
  value: string | boolean;
  invert?: boolean;
}) {
  if (typeof value !== "boolean") {
    return (
      <span className="font-mono text-[12px] tabular-nums text-cream/80">
        {value}
      </span>
    );
  }
  // invert: `true` means "has ads" → that's a negative → red X.
  const positive = invert ? !value : value;
  return positive ? (
    <Check
      size={14}
      weight="bold"
      className="inline text-[#22C55E]/80"
      aria-label="included"
    />
  ) : (
    <X
      size={14}
      weight="bold"
      className="inline text-cream/25"
      aria-label="not included"
    />
  );
}
