"use client";

import Link from "next/link";
import { ArrowRight, Sparkle, Crown, CheckCircle, EnvelopeSimple } from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { usePlan } from "@/lib/use-plan";
import {
  PLAN_PRICING,
  PLAN_EXAM_LIMITS,
  PLAN_FANG_MULTIPLIER,
} from "@/lib/mastery-plan";
import { SUPPORT_EMAIL } from "@/lib/site-config";

/**
 * Subscription management page. Shows the user's current plan + what it
 * includes, and surfaces upgrade / cancel paths. Stripe isn't wired yet,
 * so both actions route to a support mailto until the checkout backend
 * lands.
 *
 * Accessed via the navbar dropdown's "Subscription" item.
 */

export default function SubscriptionSettingsPage() {
  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-20 pb-16">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <BackButton />

          <div className="mb-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/40 mb-2">
              Settings / Subscription
            </p>
            <h1 className="font-bebas text-4xl text-cream tracking-[0.06em] leading-none">
              Your plan
            </h1>
          </div>

          <PlanPanel />
        </div>
      </div>
    </ProtectedRoute>
  );
}

function PlanPanel() {
  const { plan, isPaid, isLoading } = usePlan();

  if (isLoading) {
    return (
      <div className="h-44 rounded-[12px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
    );
  }

  const isPlatinum = plan === "platinum";
  const isPro = plan === "pro";

  return (
    <>
      {/* Current plan card */}
      <div
        className={`
          rounded-[14px] border px-5 py-5 mb-4
          ${isPlatinum
            ? "border-[#C0C6D6]/40 bg-gradient-to-br from-white/[0.04] to-transparent"
            : isPro
              ? "border-gold/40 bg-gradient-to-br from-gold/[0.05] to-transparent"
              : "border-white/[0.08] bg-white/[0.03]"
          }
        `}
      >
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            {isPlatinum && <Crown size={16} className="text-[#E8EAF2]" weight="fill" />}
            {isPro && <Sparkle size={14} className="text-gold" weight="fill" />}
            <span className="font-bebas text-[22px] tracking-wider text-cream">
              {plan === "free" ? "Free" : plan === "pro" ? "Pro" : "Platinum"}
            </span>
            {isPaid && (
              <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-cream/50">
                · active
              </span>
            )}
          </div>
          {isPaid && (
            <span className="font-bebas text-[18px] tabular-nums text-cream/80 tracking-wider">
              ${PLAN_PRICING[plan].monthly}
              <span className="text-cream/40 text-[11px] ml-0.5">/ mo</span>
            </span>
          )}
        </div>

        <ul className="flex flex-col gap-1.5 text-[13px] text-cream/75">
          <li className="flex items-center gap-2">
            <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
            {PLAN_EXAM_LIMITS[plan]} active Mastery {PLAN_EXAM_LIMITS[plan] === 1 ? "target" : "targets"}
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
            {PLAN_FANG_MULTIPLIER[plan]}× Fangs earn rate
          </li>
          <li className="flex items-center gap-2">
            <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
            {isPlatinum
              ? "Zero ads"
              : isPro
                ? "No popup ads (background only)"
                : "Includes popup + background ads"
            }
          </li>
          {isPaid && (
            <li className="flex items-center gap-2">
              <CheckCircle size={13} className="text-gold shrink-0" weight="fill" />
              Session Report PDF unlimited
            </li>
          )}
        </ul>
      </div>

      {/* Action card — differs by plan */}
      {!isPaid && (
        <div className="rounded-[14px] border border-gold/30 bg-gradient-to-br from-gold/[0.06] to-transparent px-5 py-5 mb-4">
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
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-full bg-gold text-navy font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-transform hover:scale-[1.03] active:scale-[0.98]"
            >
              See plans <ArrowRight size={12} weight="bold" />
            </Link>
            <Link
              href="/pricing#faq"
              className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.1] text-cream/70 hover:text-cream hover:border-white/[0.2] font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-colors"
            >
              FAQ
            </Link>
          </div>
        </div>
      )}

      {isPaid && (
        <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.02] px-5 py-5 mb-4">
          <h3 className="font-bebas text-[20px] tracking-wider text-cream/90 mb-3">
            Manage subscription
          </h3>
          <p className="text-[13px] text-cream/60 leading-relaxed mb-4">
            Need to cancel, upgrade, downgrade, or switch billing cycle?
            Stripe self-serve is rolling out soon — for now, email us and
            we'll handle it within one business day.
          </p>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Lionade%20subscription%20change`}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.15] text-cream hover:border-white/[0.3] font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2 transition-colors"
          >
            <EnvelopeSimple size={12} weight="bold" />
            {SUPPORT_EMAIL}
          </a>
        </div>
      )}

      <p className="text-center font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/30 mt-6">
        Billing in USD · Cancel anytime
      </p>
    </>
  );
}
