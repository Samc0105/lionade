"use client";

import useSWR from "swr";
import { Fire } from "@phosphor-icons/react";
import { swrFetcher } from "@/lib/api-client";

/**
 * Compact per-class streak pill. Sits next to the class header.
 *
 * States:
 *   - alive + streak > 0   → "🔥 5 day streak"  (orange)
 *   - !alive + streak > 0  → "🔥 5 days · streak at risk"  (muted/amber)
 *   - streak === 0         → "Start a streak — add a note today"  (subtle)
 *
 * Default SWR config (no extra polling) — focus revalidation is enough.
 */

interface StreakResponse {
  streak: number;
  longest: number;
  lastActivityAt: string | null;
  alive: boolean;
}

interface Props {
  classId: string;
}

export default function ClassStreakChip({ classId }: Props) {
  const { data, isLoading } = useSWR<StreakResponse>(
    classId ? `/api/classes/${classId}/streak` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  // Loading: light skeleton so the header doesn't jump.
  if (isLoading || !data) {
    return (
      <div
        aria-busy="true"
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-white/[0.06] bg-white/[0.02] animate-pulse"
      >
        <span className="w-3 h-3 rounded-full bg-white/[0.06]" />
        <span className="w-16 h-2.5 rounded-full bg-white/[0.06]" />
      </div>
    );
  }

  // ── No streak yet — gentle CTA, never broken-feeling.
  if (data.streak === 0) {
    return (
      <span
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-white/[0.08] bg-white/[0.02] font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55"
        title="Add a note today to start a class streak."
      >
        <Fire size={11} weight="bold" className="text-cream/35" aria-hidden="true" />
        Start a streak — add a note today
      </span>
    );
  }

  // ── Streak at risk: alive=false but they have one going.
  if (!data.alive) {
    return (
      <span
        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-amber-500/30 bg-amber-500/[0.06] font-mono text-[10px] uppercase tracking-[0.22em] text-amber-300"
        title="No activity in the last 36 hours. Add a note to keep your streak alive."
      >
        <Fire size={11} weight="fill" className="text-amber-400/70" aria-hidden="true" />
        {data.streak} day{data.streak === 1 ? "" : "s"} · streak at risk
      </span>
    );
  }

  // ── Alive — bright orange.
  return (
    <span
      className="inline-flex items-center gap-1.5 h-7 px-3 rounded-full border border-orange-500/35 bg-orange-500/[0.08] font-mono text-[10px] uppercase tracking-[0.22em] text-orange-300"
      title={`Longest: ${data.longest} day${data.longest === 1 ? "" : "s"}`}
    >
      <Fire size={11} weight="fill" className="text-orange-400" aria-hidden="true" />
      {data.streak} day{data.streak === 1 ? "" : "s"} streak
    </span>
  );
}
