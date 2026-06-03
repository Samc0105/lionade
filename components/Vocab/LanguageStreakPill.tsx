"use client";

/**
 * LanguageStreakPill — compact display for a per-language vocab review streak.
 *
 * Visual: small glass pill with a flame icon, the count, and the language name.
 * Color: gold flame (matches Lionade's reward color) + cream text, on a soft
 * navy/white glass background. When count === 0 it renders a muted "Start a
 * streak today" prompt so the surface is never empty.
 *
 * Used on /learn/vocab in the Daily Review tab header and (sized down) as a
 * row in the Add tab once the user has any streaks at all.
 */

import { Fire } from "@phosphor-icons/react";

export type LangPair = "en-es" | "es-en";

export interface LanguageStreak {
  langPair: LangPair;
  count: number;
  lastDay: string | null;
}

const LANG_NAMES: Record<LangPair, string> = {
  "en-es": "Spanish",
  "es-en": "English",
};

interface Props {
  streak: LanguageStreak;
  size?: "sm" | "md" | "lg";
}

export default function LanguageStreakPill({ streak, size = "md" }: Props) {
  const langName = LANG_NAMES[streak.langPair] ?? streak.langPair;
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

  return (
    <div
      className={`inline-flex items-center gap-2.5 rounded-full backdrop-blur border ${sizing.padding}`}
      style={{
        background: isActive
          ? "linear-gradient(135deg, rgba(255,215,0,0.10) 0%, rgba(255,255,255,0.03) 100%)"
          : "rgba(255,255,255,0.04)",
        borderColor: isActive ? "rgba(255,215,0,0.32)" : "rgba(255,255,255,0.08)",
      }}
      aria-label={`${streak.count} day ${langName} streak`}
    >
      <Fire
        size={sizing.icon}
        weight="fill"
        color={isActive ? "#FFD700" : "rgba(238,244,255,0.4)"}
        aria-hidden="true"
      />
      <div className="flex items-baseline gap-1.5">
        <span
          className={`font-bebas tabular-nums leading-none ${sizing.countText}`}
          style={{ color: isActive ? "#FFD700" : "rgba(238,244,255,0.55)" }}
        >
          {streak.count}
        </span>
        <span
          className={`font-mono uppercase tracking-[0.2em] text-cream/65 ${sizing.labelText}`}
        >
          day {langName}
        </span>
      </div>
    </div>
  );
}
