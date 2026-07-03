"use client";

/**
 * BankStreakPill — compact display for a per-bank vocab review streak.
 *
 * Replaces the old LanguageStreakPill (the language-only V1). Now scoped to a
 * bank since vocab data is sliced by Word Bank. Color comes from the bank's
 * own color so each pill stays visually distinct on the page.
 *
 * Visual: small glass pill with the bank icon (or flame for general banks
 * with no custom icon), the count, and the bank name. When count === 0 the
 * pill renders muted (cream accent, no color glow) instead of lit.
 *
 * Data shape: the SERVER-TRUE camelCase BankStreak from @lionade/core
 * (bankId / bankName — see app/api/vocab/streak/route.ts). The pill used to
 * declare its own snake_case shape, which never matched the live route and
 * pinned every pill to the zero state. Re-exported so consumers keep
 * importing the type from here.
 */

import { Fire } from "@phosphor-icons/react";
import type { BankStreak } from "@lionade/core/api/vocab";

export type { BankStreak };

interface Props {
  streak: BankStreak;
  color: string;       // bank.color — drives the glow / accent
  icon?: string;       // bank.icon emoji, or undefined → render the Fire glyph
  size?: "sm" | "md" | "lg";
}

export default function BankStreakPill({ streak, color, icon, size = "md" }: Props) {
  const isActive = streak.count > 0;

  const sizing = {
    sm: {
      padding: "px-3 py-1.5",
      countText: "text-base",
      labelText: "text-[10px]",
      icon: 14,
    },
    md: {
      padding: "px-4 py-2",
      countText: "text-xl",
      labelText: "text-[11px]",
      icon: 16,
    },
    lg: {
      padding: "px-5 py-3",
      countText: "text-3xl",
      labelText: "text-xs",
      icon: 22,
    },
  }[size];

  const accent = isActive ? color : "rgba(238,244,255,0.4)";

  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-full backdrop-blur border ${sizing.padding}`}
      style={{
        background: isActive
          ? `linear-gradient(135deg, ${color}1A 0%, rgba(255,255,255,0.03) 100%)`
          : "rgba(255,255,255,0.04)",
        borderColor: isActive ? `${color}55` : "rgba(255,255,255,0.08)",
      }}
      aria-label={`${streak.count} day ${streak.bankName} streak`}
    >
      {icon ? (
        <span aria-hidden="true" style={{ fontSize: sizing.icon }}>{icon}</span>
      ) : (
        <Fire
          size={sizing.icon}
          weight="fill"
          color={accent}
          aria-hidden="true"
        />
      )}
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-bebas tabular-nums leading-none ${sizing.countText}`}
          style={{ color: accent }}
        >
          {streak.count}
        </span>
        <span
          className={`font-mono uppercase tracking-[0.2em] text-cream/65 ${sizing.labelText}`}
        >
          day {streak.bankName}
        </span>
      </div>
    </div>
  );
}
