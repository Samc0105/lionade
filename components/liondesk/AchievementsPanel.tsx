"use client";

import { useEffect, useState } from "react";
import { Trophy, LockSimple, CheckCircle } from "@phosphor-icons/react";
import { ACHIEVEMENTS, computeUnlocked, getStats, getHistory, getCareerLevel, type TechhubStats, type HistoryEntry, type CareerLevel } from "@/lib/liondesk/stats";
import { getMaxNightSurvived, getEndlessBest } from "@/lib/liondesk/nightshift";
import { THEMES, getEquippedThemeId, setEquippedTheme, isThemeUnlocked } from "@/lib/liondesk/themes";
import { isMuted, setMuted } from "@/lib/liondesk/sound";

export default function AchievementsPanel() {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [stats, setStats] = useState<TechhubStats | null>(null);
  const [night, setNight] = useState({ max: 0, endless: 0 });
  const [equipped, setEquipped] = useState("standard");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [career, setCareer] = useState<CareerLevel | null>(null);
  const [soundOn, setSoundOn] = useState(true);

  useEffect(() => {
    setMounted(true);
    setUnlocked(computeUnlocked());
    setStats(getStats());
    setNight({ max: getMaxNightSurvived(), endless: getEndlessBest() });
    setEquipped(getEquippedThemeId());
    setHistory(getHistory());
    setCareer(getCareerLevel());
    setSoundOn(!isMuted());
  }, []);

  function equip(id: string) {
    setEquippedTheme(id);
    setEquipped(id);
  }
  function toggleSound() {
    const next = !soundOn;
    setMuted(!next);
    setSoundOn(next);
  }

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
      {/* career level */}
      {mounted && career && (
        <div className="rounded-2xl border border-electric/25 bg-electric/[0.05] p-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl flex items-center justify-center font-bebas text-2xl text-cream flex-shrink-0" style={{ background: "rgba(74,144,217,0.18)", border: "1px solid rgba(74,144,217,0.4)" }}>{career.level}</div>
            <div className="flex-1 min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-electric/90">level {career.level}</p>
              <p className="font-bebas text-2xl text-cream tracking-wide leading-none">{career.title}</p>
              <div className="h-1.5 rounded-full overflow-hidden bg-white/10 mt-2">
                <div className="h-full" style={{ width: `${career.pct}%`, background: "linear-gradient(90deg,#4A90D9,#FFD700)" }} />
              </div>
              <p className="font-mono text-[9px] text-cream/45 mt-1">{career.intoLevel} / {career.forNext} XP to level {career.level + 1}</p>
            </div>
          </div>
        </div>
      )}

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

      {/* settings */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">settings</p>
        <div className="flex items-center justify-between rounded-lg border border-white/[0.07] px-3 py-2.5">
          <span className="text-cream text-sm">Sound</span>
          <button onClick={toggleSound} className={`px-3 py-1 rounded-md font-mono text-[11px] border transition-colors ${soundOn ? "border-[#2BBE6B]/50 bg-[#2BBE6B]/10 text-[#2BBE6B]" : "border-white/15 text-cream/55"}`}>{soundOn ? "On" : "Off"}</button>
        </div>
      </div>

      {/* desk themes */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">desk themes</p>
        <div className="flex flex-wrap gap-2">
          {THEMES.map((t) => {
            const ok = mounted && isThemeUnlocked(t, unlocked);
            const on = equipped === t.id;
            const need = t.unlock ? ACHIEVEMENTS.find((a) => a.id === t.unlock)?.name ?? t.unlock : null;
            return (
              <button key={t.id} disabled={!ok} onClick={() => equip(t.id)} className={`rounded-lg border px-3 py-2 text-left transition-colors ${on ? "border-gold/60 bg-gold/10" : ok ? "border-white/12 hover:bg-white/[0.05]" : "border-white/[0.06] opacity-40 cursor-not-allowed"}`}>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-sm border border-white/15" style={{ backgroundColor: t.bg }} />
                  <span className="text-cream text-sm">{t.name}</span>
                  {on && <span className="font-mono text-[8px] uppercase tracking-wider text-gold ml-1">equipped</span>}
                </div>
                {!ok && need && <p className="font-mono text-[9px] text-cream/40 mt-1">unlock: {need}</p>}
              </button>
            );
          })}
        </div>
      </div>

      {/* recent runs */}
      {history.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">recent runs</p>
          <ul className="space-y-1.5">
            {history.slice(0, 10).map((h, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.015] px-3 py-2">
                <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: h.kind === "night" ? "#9DB4E0" : "#C9A2F2", background: h.kind === "night" ? "rgba(110,139,192,0.12)" : "rgba(168,85,247,0.12)" }}>{h.kind}</span>
                <span className="text-cream text-sm font-semibold truncate">{h.label}</span>
                <span className="ml-auto font-mono text-[10px] text-cream/45 truncate text-right">{h.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
