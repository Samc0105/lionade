"use client";

import { useEffect, useState } from "react";
import { Trophy, LockSimple, CheckCircle, Lightning, Medal } from "@phosphor-icons/react";
import { ACHIEVEMENTS, computeUnlocked, getStats, getHistory, getCareerLevel, type TechhubStats, type HistoryEntry, type CareerLevel } from "@/lib/liondesk/stats";
import { getMaxNightSurvived, getEndlessBest } from "@/lib/liondesk/nightshift";
import { THEMES, getEquippedThemeId, setEquippedTheme, isThemeUnlocked, unlockedStreakIds } from "@/lib/liondesk/themes";
import { QUEST_BADGES, getEarnedQuestBadgeIds } from "@/lib/liondesk/quests";
import { getPlayStreak, STREAK_MILESTONES, type PlayStreak } from "@/lib/liondesk/playstreak";
import { isMuted, setMuted } from "@/lib/liondesk/sound";
import { getReputation, REP_DEPTS } from "@/lib/liondesk/reputation";
import { CareerSagaCard } from "@/components/liondesk/PromotionMoment";
import { chapterForLevel, nextPromotion } from "@/lib/liondesk/saga";

export default function AchievementsPanel() {
  const [mounted, setMounted] = useState(false);
  const [unlocked, setUnlocked] = useState<string[]>([]);
  const [stats, setStats] = useState<TechhubStats | null>(null);
  const [night, setNight] = useState({ max: 0, endless: 0 });
  const [equipped, setEquipped] = useState("standard");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [career, setCareer] = useState<CareerLevel | null>(null);
  const [soundOn, setSoundOn] = useState(true);
  const [reputation, setReputation] = useState<Record<string, number>>({});
  const [streak, setStreak] = useState<PlayStreak>({ current: 0, best: 0, lastDay: "" });
  const [questBadges, setQuestBadges] = useState<string[]>([]);

  useEffect(() => {
    setMounted(true);
    setUnlocked(computeUnlocked());
    setStats(getStats());
    setNight({ max: getMaxNightSurvived(), endless: getEndlessBest() });
    setEquipped(getEquippedThemeId());
    setHistory(getHistory());
    setCareer(getCareerLevel());
    setSoundOn(!isMuted());
    setReputation(getReputation());
    setStreak(getPlayStreak());
    setQuestBadges(getEarnedQuestBadgeIds());
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

  // Streak themes resolve via "streak:N" ids merged into the achievement set.
  const themeUnlocked = mounted ? [...unlocked, ...unlockedStreakIds(streak.best)] : [];
  // Cosmetic quest badges earned from the daily/weekly quests on the hub.
  const earnedBadges = new Set(mounted ? questBadges : []);
  const earnedBadgeCount = mounted ? questBadges.length : 0;
  const streakThemeName = (m: number) => THEMES.find((t) => t.unlock === `streak:${m}`)?.name ?? null;
  const nextMilestone = STREAK_MILESTONES.find((m) => streak.best < m) ?? null;
  const remaining = nextMilestone ? nextMilestone - streak.current : 0;
  const streakNote = !mounted
    ? "…"
    : streak.current >= 1
      ? nextMilestone
        ? `${remaining} day${remaining === 1 ? "" : "s"} to ${streakThemeName(nextMilestone) ?? "the next reward"}. Clock in daily to keep it alive.`
        : `Every streak theme unlocked. Keep clocking in to hold your best of ${streak.best} days.`
      : streak.best > 0
        ? `Your streak lapsed at ${streak.best} days. Clear a shift today to start it again.`
        : "Clear a shift today to start a streak. Reach 3, 7, 14, and 30 days to unlock desk themes.";

  const tiles = [
    { label: "shifts cleared", value: stats?.shiftsCleared ?? 0 },
    { label: "perfect (100%)", value: stats?.perfectShifts ?? 0 },
    { label: "nights survived", value: night.max },
    { label: "endless best", value: night.endless ? fmt(night.endless) : "none yet" },
    { label: "mutators seen", value: stats?.mutatorsSeen.length ?? 0 },
    { label: "tracks played", value: stats?.tracksPlayed.length ?? 0 },
    { label: "best score", value: stats?.bestShiftScore ?? 0 },
  ];

  return (
    <div className="space-y-6">
      {/* career level + saga chapter. Both sit inside the mount + career guard so
          the localStorage-derived level never flashes a zero. CareerSagaCard is
          presentational; the already-mounted career.level feeds it the resting
          chapter and the next promotion to tease. Cosmetic, it grants nothing. */}
      {mounted && career && (
        <>
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
          <CareerSagaCard chapter={chapterForLevel(career.level)} next={nextPromotion(career.level)} />
        </>
      )}

      {/* progress header */}
      <div className="rounded-2xl border border-gold/20 bg-gold/[0.04] p-5">
        <div className="flex items-center gap-3">
          <Trophy size={26} weight="fill" color="#FFD700" aria-hidden="true" />
          <div className="flex-1">
            <p className="font-bebas text-2xl text-cream tracking-wide leading-none">{mounted ? `${got} / ${total}` : "…"} unlocked</p>
            <div className="h-1.5 rounded-full overflow-hidden bg-white/10 mt-2">
              <div className="h-full" style={{ width: `${mounted ? pct : 0}%`, background: "linear-gradient(90deg,#FFD700,#FFA500)" }} />
            </div>
          </div>
        </div>
      </div>

      {/* lifetime stats */}
      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-7 gap-2">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg border border-white/[0.07] p-2.5 text-center">
            <p className="font-bebas text-xl tabular-nums text-cream leading-none">{mounted ? t.value : "…"}</p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">{t.label}</p>
          </div>
        ))}
      </div>

      {/* streak milestones */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">streak milestones</p>
        <div className="rounded-2xl border border-orange-400/25 bg-orange-400/[0.05] p-4">
          <div className="flex items-center gap-3">
            <Lightning size={24} weight="fill" color="#FB923C" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              <p className="font-bebas text-2xl text-cream tracking-wide leading-none">{mounted ? `${streak.current}-day streak` : "…"}</p>
              <p className="font-mono text-[10px] text-cream/45 mt-1">{streakNote}</p>
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-3">
            {STREAK_MILESTONES.map((m) => {
              const reached = mounted && streak.best >= m;
              const name = streakThemeName(m);
              return (
                <div key={m} className="rounded-lg border p-2.5 text-center" style={{ borderColor: reached ? "rgba(251,146,60,0.4)" : "rgba(255,255,255,0.07)", background: reached ? "rgba(251,146,60,0.06)" : "rgba(255,255,255,0.015)" }}>
                  <div className="flex items-center justify-center gap-1">
                    {mounted && (reached ? <CheckCircle size={14} weight="fill" color="#FB923C" aria-hidden="true" /> : <LockSimple size={12} weight="fill" color="#6B7280" aria-hidden="true" />)}
                    <span className="font-bebas text-lg tabular-nums text-cream leading-none">{m}</span>
                  </div>
                  <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45 mt-1">{name ? `${name} theme` : `${m} days`}</p>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* department reputation */}
      <div>
        <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">department reputation</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {REP_DEPTS.map((d) => {
            const v = mounted ? (reputation[d] ?? 50) : 50;
            const color = v >= 70 ? "#2BBE6B" : v >= 40 ? "#F59E0B" : "#EF4444";
            return (
              <div key={d} className="flex items-center gap-2 rounded-lg border border-white/[0.06] px-3 py-2">
                <span className="text-cream text-sm w-24 truncate">{d}</span>
                <span className="flex-1 h-1.5 rounded-full overflow-hidden bg-white/10"><span className="block h-full" style={{ width: `${v}%`, background: color }} /></span>
                <span className="font-mono text-[10px] tabular-nums" style={{ color }}>{v}</span>
              </div>
            );
          })}
        </div>
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
            const ok = mounted && isThemeUnlocked(t, themeUnlocked);
            const on = equipped === t.id;
            const need = t.unlock
              ? t.unlock.startsWith("streak:")
                ? `${t.unlock.split(":")[1]} day streak`
                : ACHIEVEMENTS.find((a) => a.id === t.unlock)?.name ?? t.unlock
              : null;
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

      {/* quest badges (cosmetic, earned from the daily/weekly quests on the hub).
          A separate collection from the desk themes; never grants Fangs. Static
          styling, so it is reduced-motion safe by construction. */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">quest badges</p>
          <span className="font-mono text-[10px] tabular-nums text-cream/45">{mounted ? `${earnedBadgeCount} / ${QUEST_BADGES.length}` : "…"}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          {QUEST_BADGES.map((b) => {
            const got = earnedBadges.has(b.id);
            return (
              <div
                key={b.id}
                className={`rounded-lg border px-3 py-2 ${got ? "" : "opacity-45"}`}
                style={{ borderColor: got ? `${b.color}66` : "rgba(255,255,255,0.06)", background: got ? `${b.color}12` : "rgba(255,255,255,0.015)" }}
              >
                <div className="flex items-center gap-2">
                  {mounted && (got ? <Medal size={15} weight="fill" color={b.color} aria-hidden="true" /> : <LockSimple size={13} weight="fill" color="#6B7280" aria-hidden="true" />)}
                  <span className="text-cream text-sm">{b.name}</span>
                  <span className="font-mono text-[8px] uppercase tracking-wider px-1 py-0.5 rounded" style={{ color: b.color, background: `${b.color}1a` }}>{b.tier}</span>
                </div>
                <p className="font-mono text-[9px] text-cream/40 mt-1">{b.desc}</p>
              </div>
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
