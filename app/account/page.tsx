"use client";

/**
 * Account page. Lightweight billing-focused landing surface that Stripe
 * Checkout returns to on success (success_url is hardcoded server-side to
 * `/account?upgrade=success&session_id={CHECKOUT_SESSION_ID}`).
 *
 * Renders a subscription card backed by `profiles.subscription_*` columns
 * the webhook writes to. The "Manage" button POSTs to /api/stripe/portal
 * and redirects to Stripe's hosted Customer Portal — no in-app cancel /
 * plan-switch UI to keep V1 minimal.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { ArrowRight, Sparkle, Crown, CheckCircle } from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";
import { useAuth } from "@/lib/auth";
import { usePlan } from "@/lib/use-plan";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { supabase } from "@/lib/supabase";
import { apiPost } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { PLAN_PRICING, PLAN_EXAM_LIMITS, PLAN_FANG_MULTIPLIER } from "@/lib/mastery-plan";

type SubscriptionRow = {
  subscription_tier: "free" | "pro" | "platinum" | null;
  subscription_status: "trialing" | "active" | "past_due" | "canceled" | "incomplete" | null;
  subscription_current_period_end: string | null;
  subscription_cancel_at: string | null;
  subscription_cycle: "monthly" | "annual" | null;
};

async function fetchSubscription(userId: string): Promise<SubscriptionRow | null> {
  const { data } = await supabase
    .from("profiles")
    .select(
      "subscription_tier, subscription_status, subscription_current_period_end, subscription_cancel_at, subscription_cycle",
    )
    .eq("id", userId)
    .maybeSingle();
  return (data as SubscriptionRow | null) ?? null;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

const STATUS_LABEL: Record<NonNullable<SubscriptionRow["subscription_status"]>, string> = {
  trialing: "Trialing",
  active: "Active",
  past_due: "Past due",
  canceled: "Canceled",
  incomplete: "Incomplete",
};

const STATUS_TONE: Record<NonNullable<SubscriptionRow["subscription_status"]>, string> = {
  trialing: "text-electric border-electric/30 bg-electric/[0.08]",
  active: "text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]",
  past_due: "text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/[0.08]",
  canceled: "text-cream/55 border-white/[0.12] bg-white/[0.04]",
  incomplete: "text-cream/55 border-white/[0.12] bg-white/[0.04]",
};

export default function AccountPage() {
  return (
    <ProtectedRoute>
      <AccountInner />
    </ProtectedRoute>
  );
}

function AccountInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  const { plan, refresh: refreshPlan } = usePlan();
  const { stats } = useUserStats(user?.id);
  const [portalLoading, setPortalLoading] = useState(false);

  const swrKey = user?.id ? `subscription/${user.id}` : null;
  const { data: sub, isLoading, mutate: refreshSub } = useSWR<SubscriptionRow | null>(
    swrKey,
    () => fetchSubscription(user!.id),
    { revalidateOnFocus: true, keepPreviousData: true },
  );

  // Stripe Checkout success: celebratory toast + clear the query param so
  // a refresh / back-nav doesn't re-fire. Also revalidate profile so the
  // new tier surfaces immediately even if the webhook is a few ms behind.
  useEffect(() => {
    if (searchParams?.get("upgrade") !== "success") return;
    const tierLabel =
      plan === "platinum" ? "Platinum" : plan === "pro" ? "Pro" : "your new plan";
    toastSuccess(
      `Welcome to ${tierLabel}. Your 3-day trial is on. Cancel anytime.`,
      { duration: 5000 },
    );
    router.replace("/account");
    // Webhook may land milliseconds after the redirect; revalidate both
    // SWR keys so the card flips state without a manual refresh.
    void refreshSub();
    refreshPlan();
  }, [searchParams, router, plan, refreshSub, refreshPlan]);

  // Stripe Fang IAP success: Fangs are minted on the webhook side; nudge
  // the user-stats SWR cache so the new balance appears within ~1 SWR cycle
  // even if the webhook lands a few hundred ms behind the browser redirect.
  // Strip the query param so a refresh / back-nav doesn't re-fire the toast.
  useEffect(() => {
    if (searchParams?.get("iap") !== "success") return;
    toastSuccess(
      "Fangs added to your wallet. Spend them in the Lion's Den anytime.",
      { duration: 5000 },
    );
    router.replace("/account");
    if (user?.id) {
      void mutateUserStats(user.id);
    }
  }, [searchParams, router, user?.id]);

  async function openPortal() {
    if (portalLoading) return;
    setPortalLoading(true);
    try {
      const res = await apiPost<{ url: string }>("/api/stripe/portal", {});
      if (!res.ok || !res.data?.url) {
        console.error("[account:portal] failed", res.error);
        toastError("Couldn't open billing portal. Try again.");
        setPortalLoading(false);
        return;
      }
      window.location.href = res.data.url;
    } catch (e) {
      console.error("[account:portal] threw", e);
      toastError("Couldn't open billing portal. Try again.");
      setPortalLoading(false);
    }
  }

  // Source of truth for the visible tier: prefer the dedicated
  // subscription_tier column, fall back to the legacy `plan` mirror so the
  // card renders something sensible even on a brand-new profile row.
  const tier: "free" | "pro" | "platinum" = useMemo(() => {
    const t = sub?.subscription_tier ?? plan ?? "free";
    return t === "pro" || t === "platinum" ? t : "free";
  }, [sub?.subscription_tier, plan]);

  const status = sub?.subscription_status ?? null;
  const isPaid = tier !== "free";
  const isPlatinum = tier === "platinum";
  const isPro = tier === "pro";

  const renewLine = (() => {
    if (!isPaid) return null;
    if (sub?.subscription_cancel_at) {
      return `Cancels on ${formatDate(sub.subscription_cancel_at)}. Reactivate anytime.`;
    }
    if (status === "trialing" && sub?.subscription_current_period_end) {
      return `Trial ends ${formatDate(sub.subscription_current_period_end)}. You won't be charged until then.`;
    }
    if (status === "active" && sub?.subscription_current_period_end) {
      const cycleLabel =
        sub.subscription_cycle === "annual" ? "yearly" : "monthly";
      return `Renews ${cycleLabel} on ${formatDate(sub.subscription_current_period_end)}.`;
    }
    if (status === "past_due") {
      return "Payment failed. Update your card to keep access.";
    }
    return null;
  })();

  return (
    <div
      data-force-dark
      className="min-h-screen pt-20 pb-16"
      style={{
        backgroundColor: "#04080F",
        backgroundImage: `
          radial-gradient(50rem 50rem at 78% 6%, rgba(124,58,237,0.18) 0%, transparent 60%),
          radial-gradient(48rem 48rem at 10% 78%, rgba(30,58,138,0.22) 0%, transparent 62%)
        `,
      }}
    >
      <div className="max-w-2xl mx-auto px-4 py-10">
        <BackButton />

        <div className="mb-8">
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/40 mb-2">
            Account / Subscription
          </p>
          <h1 className="font-bebas text-4xl text-cream tracking-[0.06em] leading-none">
            Your plan
          </h1>
        </div>

        {/* Fang balance pill — single total from profiles.coins (the dual */}
        {/* cashable / iap ledger is internal; users see one number). */}
        <div
          className="inline-flex items-center gap-2 mb-6 px-4 py-1.5 rounded-full backdrop-blur-xl"
          style={{
            background: "rgba(255,215,0,0.08)",
            border: "1px solid rgba(255,215,0,0.20)",
          }}
        >
          <img
            src={cdnUrl("/F.png")}
            alt="Fangs"
            className="w-5 h-5 object-contain"
          />
          <span className="font-bebas text-xl text-gold tracking-wider tabular-nums">
            {stats?.coins != null ? stats.coins.toLocaleString() : "—"}
          </span>
          <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50">
            Fangs
          </span>
          <Link
            href="/shop"
            className="ml-2 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55 hover:text-cream transition-colors"
          >
            Top up
          </Link>
        </div>

        {isLoading && !sub ? (
          <div className="h-44 rounded-[14px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
        ) : (
          <>
            {/* Subscription card — mirrors the pricing page glass treatment. */}
            <div
              className={`
                rounded-[14px] border px-5 py-5 mb-4 backdrop-blur-xl
                ${isPlatinum
                  ? "border-[#C0C6D6]/40 bg-gradient-to-br from-white/[0.04] to-transparent"
                  : isPro
                    ? "border-gold/40 bg-gradient-to-br from-gold/[0.05] to-transparent"
                    : "border-white/[0.08] bg-white/[0.03]"
                }
              `}
            >
              <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
                <div className="flex items-center gap-2">
                  {isPlatinum && <Crown size={16} className="text-[#E8EAF2]" weight="fill" />}
                  {isPro && <Sparkle size={14} className="text-gold" weight="fill" />}
                  <span className="font-bebas text-[22px] tracking-wider text-cream">
                    {tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Platinum"}
                  </span>
                  {status && isPaid && (
                    <span
                      className={`font-mono text-[9.5px] uppercase tracking-[0.22em] px-2 py-1 rounded-full border ${STATUS_TONE[status]}`}
                    >
                      {STATUS_LABEL[status]}
                    </span>
                  )}
                </div>
                {isPaid && (
                  <span className="font-bebas text-[18px] tabular-nums text-cream/80 tracking-wider">
                    ${PLAN_PRICING[tier].monthly}
                    <span className="text-cream/40 text-[11px] ml-0.5">/ mo</span>
                  </span>
                )}
              </div>

              {renewLine && (
                <p className="text-[12.5px] text-cream/65 mb-3 leading-relaxed">
                  {renewLine}
                </p>
              )}

              <ul className="flex flex-col gap-1.5 text-[13px] text-cream/75">
                <li className="flex items-center gap-2">
                  <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
                  {PLAN_EXAM_LIMITS[tier]} active Mastery {PLAN_EXAM_LIMITS[tier] === 1 ? "target" : "targets"}
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
                  {PLAN_FANG_MULTIPLIER[tier]}× Fangs earn rate
                </li>
                <li className="flex items-center gap-2">
                  <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
                  {isPlatinum
                    ? "Zero ads"
                    : isPro
                      ? "No popup ads (background only)"
                      : "Includes popup + background ads"}
                </li>
              </ul>
            </div>

            {/* Action card — Manage (paid) or Go Pro (free). */}
            {isPaid ? (
              <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-5 py-5 backdrop-blur-xl">
                <h3 className="font-bebas text-[20px] tracking-wider text-cream/90 mb-2">
                  Manage subscription
                </h3>
                <p className="text-[13px] text-cream/60 leading-relaxed mb-4">
                  Update your payment method, switch billing cycle, or cancel
                  anytime in the Stripe Customer Portal.
                </p>
                <button
                  type="button"
                  onClick={openPortal}
                  disabled={portalLoading}
                  className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.15] text-cream hover:border-white/[0.3] font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
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
                      Manage in Stripe <ArrowRight size={12} weight="bold" />
                    </>
                  )}
                </button>
              </div>
            ) : (
              <div className="rounded-[14px] border border-gold/30 bg-gradient-to-br from-gold/[0.06] to-transparent px-5 py-5 backdrop-blur-xl">
                <div className="flex items-center gap-2 mb-2">
                  <Sparkle size={14} className="text-gold" weight="fill" />
                  <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold">
                    Upgrade
                  </span>
                </div>
                <h3 className="font-bebas text-[24px] tracking-wider text-cream leading-tight mb-2">
                  Ready to grind harder?
                </h3>
                <p className="text-[13px] text-cream/70 leading-relaxed mb-4">
                  Pro drops the popups, unlocks the Session Report, and bumps
                  your Fangs rate to 1.5×. Platinum kills ads entirely and opens
                  up 8 Mastery targets.
                </p>
                <Link
                  href="/pricing"
                  className="inline-flex items-center gap-1.5 rounded-full bg-gold text-navy font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-transform hover:scale-[1.03] active:scale-[0.98]"
                >
                  See plans <ArrowRight size={12} weight="bold" />
                </Link>
              </div>
            )}

            <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/30 mt-6">
              Billing in USD · Cancel anytime
            </p>
          </>
        )}
      </div>
    </div>
  );
}
