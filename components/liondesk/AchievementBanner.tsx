"use client";

import { useEffect, useState } from "react";
import { Trophy } from "@phosphor-icons/react";
import { ACHIEVEMENTS } from "@/lib/liondesk/stats";
import { takePendingStreakMilestone, streakBannerId } from "@/lib/liondesk/playstreak";

// Shows a celebratory banner when achievements are newly unlocked, then fades.
// Also surfaces a streak milestone moment: recordPlayDay stashes a crossed
// milestone, and we consume it once here so the moment fires on whichever play
// surface ends the streak-extending shift. Entry uses the shared animate-slide-up
// keyframe, which is already disabled under prefers-reduced-motion in globals.css.
export default function AchievementBanner({ ids }: { ids: string[] }) {
  const [show, setShow] = useState<string[]>([]);
  // Consume the pending streak milestone (once) and merge it with any freshly
  // unlocked achievements. Kept separate from the auto-hide timer so a streak
  // only banner still dismisses correctly even when consumed in StrictMode.
  useEffect(() => {
    const milestone = takePendingStreakMilestone();
    const merged = milestone != null ? [...ids, streakBannerId(milestone)] : ids;
    if (merged.length === 0) return;
    setShow(merged);
  }, [ids]);
  useEffect(() => {
    if (show.length === 0) return;
    const t = setTimeout(() => setShow([]), 6000);
    return () => clearTimeout(t);
  }, [show]);

  if (show.length === 0) return null;
  const names = show.map((id) => {
    if (id.startsWith("levelup:")) { const p = id.split(":"); return `Level ${p[1]}: ${p[2]}`; }
    if (id.startsWith("streak:")) { return `${id.split(":")[1]} day streak`; }
    return ACHIEVEMENTS.find((a) => a.id === id)?.name ?? id;
  });
  return (
    <div className="animate-slide-up rounded-xl border border-gold/40 bg-gold/[0.08] p-3 flex items-center gap-3">
      <Trophy size={22} weight="fill" color="#FFD700" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/90">achievement{names.length > 1 ? "s" : ""} unlocked</p>
        <p className="text-cream text-sm font-semibold truncate">{names.join(" · ")}</p>
      </div>
    </div>
  );
}
