"use client";

import { useEffect, useState } from "react";
import { Trophy } from "@phosphor-icons/react";
import { ACHIEVEMENTS } from "@/lib/liondesk/stats";

// Shows a celebratory banner when achievements are newly unlocked, then fades.
export default function AchievementBanner({ ids }: { ids: string[] }) {
  const [show, setShow] = useState<string[]>([]);
  useEffect(() => {
    if (ids.length === 0) return;
    setShow(ids);
    const t = setTimeout(() => setShow([]), 6000);
    return () => clearTimeout(t);
  }, [ids]);

  if (show.length === 0) return null;
  const names = show.map((id) => {
    if (id.startsWith("levelup:")) { const p = id.split(":"); return `Level ${p[1]}: ${p[2]}`; }
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
