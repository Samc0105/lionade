"use client";

import Link from "next/link";
import { usePlan } from "@/lib/use-plan";
import { Sparkle, Crown } from "@phosphor-icons/react";

/**
 * Subscription-plan chip rendered next to the navbar avatar.
 *
 *   free      → renders nothing (no badge clutter for the default state)
 *   pro       → gold "PRO" chip with a sparkle
 *   platinum  → iridescent "PLATINUM" chip with a crown
 *
 * Links to /settings/subscription so paid users can jump to manage/cancel
 * with one tap. Compact on mobile.
 */

export default function PlanBadge() {
  const { plan, isLoading } = usePlan();

  if (isLoading) return null;
  if (plan === "free") return null;

  const isPlatinum = plan === "platinum";

  return (
    <Link
      href="/settings/subscription"
      aria-label={`${plan} subscription — manage`}
      className={`
        h-8 inline-flex items-center gap-1 rounded-full
        font-mono text-[9.5px] uppercase tracking-[0.22em]
        px-3 leading-none
        transition-all duration-200 hover:scale-[1.04] active:scale-[0.98]
        ${isPlatinum
          ? "bg-gradient-to-r from-[#C0C6D6] via-[#E8EAF2] to-[#C0C6D6] text-[#0a0f1d] shadow-[0_0_12px_rgba(200,206,220,0.35)]"
          : "bg-gradient-to-r from-gold to-[#F0B429] text-navy shadow-[0_0_10px_rgba(255,215,0,0.28)]"
        }
      `}
    >
      {isPlatinum
        ? <Crown size={11} weight="fill" />
        : <Sparkle size={11} weight="fill" />
      }
      <span>{plan}</span>
    </Link>
  );
}

/**
 * "Upgrade to Pro" pill for free users. Rendered inside the avatar
 * dropdown. Separate component so the navbar can import + place it
 * explicitly in the dropdown menu without bundling logic into PlanBadge.
 */
export function UpgradePill({ className = "" }: { className?: string }) {
  return (
    <Link
      href="/pricing"
      className={`
        h-8 inline-flex items-center gap-1.5
        rounded-full bg-gradient-to-r from-gold to-[#F0B429]
        text-navy font-mono text-[10px] uppercase tracking-[0.22em]
        px-3 leading-none
        transition-transform duration-200 hover:scale-[1.03] active:scale-[0.98]
        ${className}
      `}
    >
      <Sparkle size={11} weight="fill" />
      Upgrade
    </Link>
  );
}
