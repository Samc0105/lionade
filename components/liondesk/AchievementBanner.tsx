"use client";

import { useEffect, useState } from "react";
import { Trophy } from "@phosphor-icons/react";
import { ACHIEVEMENTS } from "@/lib/liondesk/stats";
import { takePendingStreakMilestone, streakBannerId } from "@/lib/liondesk/playstreak";
import { promotionFromBannerId, type Promotion } from "@/lib/liondesk/saga";
import PromotionMoment from "@/components/liondesk/PromotionMoment";

// Shows a celebratory banner when achievements are newly unlocked, then fades.
// Also surfaces a streak milestone moment: recordPlayDay stashes a crossed
// milestone, and we consume it once here so the moment fires on whichever play
// surface ends the streak-extending shift. Entry uses the shared animate-slide-up
// keyframe, which is already disabled under prefers-reduced-motion in globals.css.
//
// Crossing a career title is upgraded from a flat "Level N: Title" banner line to
// a full TechHub Saga promotion moment (PromotionMoment): we pull the first
// promotion levelup id out of the set, render the rich overlay for it, and let the
// flat banner carry only the rest (achievements, streaks, and any level-up that
// did not change your title, e.g. leveling on past CTO).
export default function AchievementBanner({ ids }: { ids: string[] }) {
  const [show, setShow] = useState<string[]>([]);
  const [promo, setPromo] = useState<Promotion | null>(null);
  // Consume the pending streak milestone (once) and merge it with any freshly
  // unlocked achievements. Kept separate from the auto-hide timer so a streak
  // only banner still dismisses correctly even when consumed in StrictMode.
  useEffect(() => {
    const milestone = takePendingStreakMilestone();
    const merged = milestone != null ? [...ids, streakBannerId(milestone)] : ids;
    // Split off a newly crossed career title for the rich promotion moment; the
    // flat banner carries everything else.
    let crossed: Promotion | null = null;
    const banner: string[] = [];
    for (const id of merged) {
      const p = promotionFromBannerId(id);
      if (p && !crossed) crossed = p;
      else banner.push(id);
    }
    if (crossed) setPromo(crossed);
    if (banner.length > 0) setShow(banner);
  }, [ids]);
  useEffect(() => {
    if (show.length === 0) return;
    const t = setTimeout(() => setShow([]), 6000);
    return () => clearTimeout(t);
  }, [show]);

  const names = show.map((id) => {
    if (id.startsWith("levelup:")) { const p = id.split(":"); return `Level ${p[1]}: ${p[2]}`; }
    if (id.startsWith("streak:")) { return `${id.split(":")[1]} day streak`; }
    return ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id;
  });
  return (
    <>
      {promo && <PromotionMoment promotion={promo} onDismiss={() => setPromo(null)} />}
      {show.length > 0 && (
        <div className="animate-slide-up rounded-xl border border-gold/40 bg-gold/[0.08] p-3 flex items-center gap-3">
          <Trophy size={22} weight="fill" color="#FFD700" aria-hidden="true" />
          <div className="min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/90">achievement{names.length > 1 ? "s" : ""} unlocked</p>
            <p className="text-cream text-sm font-semibold truncate">{names.join(" · ")}</p>
          </div>
        </div>
      )}
    </>
  );
}
