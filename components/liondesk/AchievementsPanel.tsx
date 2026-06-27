"use client";

import { useEffect, useState } from "react";
import { Trophy, LockSimple, CheckCircle } from "@phosphor-icons/react";
import { ACHIEVEMENTS, computeUnlocked, getStats, type TechhubStats } from "@/lib/liondesk/stats";
import { getMaxNightSurvived, getEndlessBest } from "@/lib/liondesk/nightshift";

export default function AchievementsPanel() {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [stats, setStats] = useState<TechhubStats | null>(null);
  const [night, setNight] = useState({ max: 0, endless: 0 });

  useEffect(() => {
    setMounted(true);
    setUnlocked(computeUnlocked());
    setStats(getStats());
    setNight({ max: getMaxNightSurvived(), endless: getEndlessBest() });
  }, []);

  const total = ACHIEVEMENTS.length;
  const got = mounted ? unlocked.length : 0;
  const pct = Math.round((got / total) * 100);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

  const tiles = [
    { label: "shifts cleared", value: stats?.shiftsCleared ?? 0 },
    { label: "perfect (100%)", value: stats?.perfectShifts ?? 0 },
    { label: "nights survived", value: night.max },
    { label: "endless best", value: night.endless ? fmt(night.endless) : "—" },
    { label: "mutators seen", value: stats?.mutatorsSeen.length ?? 0 },
    { label: "tracks played", value: stats?.tracksPlayed.length ?? 0 },
  ];

  return (
    <div className="space-y-6">
      {/* progress header */}
      <div className="rounded-2xl border border-gold/20 bg-gold/[0.04] p-5">
        <div className="flex items-center gap-3">
          <Trophy size={26} weight="fill" color="#FFD700" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-bebas text-2xl text-cream tracking-wide leading-none">{mounted ? `${got} / ${total}` : "—"} unlocked</p>
            <div className="h-1.5 rounded-full overflow-hidden bg-white/10 mt-2">
              <div className="h-full" style={{ width: `${mounted ? pct : 0}%`, background: "linear-gradient(90deg,#FFD700,#FFA500)" }} />
            </div>
          </div>
        </div>
      </div>

      {/* lifetime stats */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-white/[0.07] p-2.5 text-center">
            <p className="font-bebas text-xl tabular-nums text-cream leading-none">{mounted ? t.value : "—"}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      {/* achievement grid */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {ACHIEVEMENTS.map((a) => {
          const on = mounted && unlocked.includes(a.id);
          return (
            <li key={a.id} className="rounded-xl border p-3 flex items-center gap-3" style={{ borderColor: on ? "rgba(255,215,0,0.35)" : "rgba(255,255,255,0.07)", background: on ? "rgba(255,215,0,0.05)" : "rgba(255,255,255,0.015)" }}>
              {on ? <CheckCircle size={22} weight="fill" color="#FFD700" aria-hidden="true" /> : <LockSimple size={20} weight="fill" color="#6B7280" aria-hidden="true" />}
              <div className="min-w-0">
                <p className="font-syne font-semibold text-sm" style={{ color: on ? "#F5EBDA" : "rgba(245,235,218,0.55)" }}>{a.name}</p>
                <p className="text-cream/45 text-[11px] leading-snug">{a.desc}</p>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
