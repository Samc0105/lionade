"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useDailyMissions, useActiveBet, type DailyMission } from "@/lib/hooks";
import { useIdleAttention } from "@/lib/use-idle-attention";
import { cdnUrl } from "@/lib/cdn";
import BottomSheet from "@/components/ui/BottomSheet";
import { Target, Coins } from "@phosphor-icons/react";
import type { ActiveBet } from "@/lib/db";

/**
 * MissionsBetFloat — floating pill on /quiz that surfaces Today's Missions
 * and the active Daily Bet without leaving the quiz flow.
 *
 * Design contract:
 *   - Bottom-right cluster, above QuickNoteShortcut + FocusMusicToggle.
 *   - Same idle-attention dim treatment as siblings.
 *   - Fang icon + active-count badge.
 *   - Brief scale/glow pulse when any mission's progress ticks up. Pulse
 *     is gated behind `prefers-reduced-motion: no-preference`.
 *
 * Data flow:
 *   - Reads from `useDailyMissions` + `useActiveBet` (shared SWR cache
 *     keys with the Dashboard).
 *   - Updates are driven by the quiz page calling `mutate(...)` on the
 *     same keys after each successful handleSelect.
 */
export default function MissionsBetFloat() {
  const { user } = useAuth();
  const uid = user?.id;
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(false);
  const { attentioned, bind } = useIdleAttention(10_000);

  const { data: missionsData } = useDailyMissions(uid);
  const { data: activeBet } = useActiveBet(uid);

  const missions = missionsData?.missions ?? [];

  // Total surfaces count: unclaimed missions + 1 if active bet exists.
  // We don't surface already-claimed missions to keep the badge meaningful.
  const activeCount = useMemo(() => {
    const liveMissions = missions.filter(m => !m.claimed).length;
    const betCount = activeBet ? 1 : 0;
    return liveMissions + betCount;
  }, [missions, activeBet]);

  // Pulse trigger: when the SUM of mission progress increases vs the
  // previous snapshot, briefly pulse the badge. Refs avoid a re-render
  // loop. Skip the first observed value (initial hydration is not a tick).
  // Memoize sum so this effect only fires when the NUMBER changes, not on
  // every SWR poll where the missions array gets a new reference.
  const progressSum = useMemo(
    () => missions.reduce((acc, m) => acc + m.progress, 0),
    [missions],
  );
  const prevSumRef = useRef<number | null>(null);
  useEffect(() => {
    const prev = prevSumRef.current;
    // Always advance the ref so back-to-back ticks compare against the
    // latest baseline, not a stale pre-pulse value.
    prevSumRef.current = progressSum;
    if (prev === null || progressSum <= prev) return;
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;
    setPulse(true);
    const t = setTimeout(() => setPulse(false), 600);
    return () => clearTimeout(t);
  }, [progressSum]);

  if (!uid) return null;

  const dim = !attentioned;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Open quiz missions and bet sheet. ${activeCount} active.`}
        {...bind}
        style={{
          opacity: dim ? 0.4 : 1,
          filter: dim ? "blur(0.6px)" : "none",
          transform: pulse ? "scale(1.06)" : undefined,
          boxShadow: pulse
            ? "0 0 0 2px rgba(255,215,0,0.35), 0 0 18px rgba(255,215,0,0.45)"
            : undefined,
        }}
        className="
          fixed z-30 right-4 md:right-6
          bottom-[310px] md:bottom-[280px]
          hidden sm:inline-flex items-center gap-1.5
          rounded-full px-3 py-2
          bg-white/[0.04] hover:bg-white/[0.08]
          border border-white/[0.1] hover:border-white/[0.2]
          font-mono text-[10px] uppercase tracking-[0.22em] text-cream/70 hover:text-cream
          transition-[opacity,filter,background-color,border-color,transform,box-shadow] duration-500 ease-out active:scale-[0.97]
          shadow-lg shadow-black/30
          backdrop-blur-md
        "
      >
        <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3.5 h-3.5 object-contain" />
        <span>Missions</span>
        <span
          className="
            inline-flex items-center justify-center
            min-w-[18px] h-[18px] rounded-full px-1
            bg-gold/20 border border-gold/40
            font-mono text-[9.5px] text-gold
          "
        >
          {activeCount}
        </span>
      </button>

      <BottomSheet
        open={open}
        onClose={() => setOpen(false)}
        ariaLabel="Today's missions and daily bet"
      >
        <SheetBody missions={missions} activeBet={activeBet ?? null} />
      </BottomSheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sheet contents
// ─────────────────────────────────────────────────────────────────────
function SheetBody({
  missions,
  activeBet,
}: {
  missions: DailyMission[];
  activeBet: ActiveBet | null;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <Target size={13} className="text-gold" weight="fill" />
        <h2 className="font-bebas text-lg tracking-[0.18em] text-cream uppercase">
          Today&apos;s Missions &amp; Bet
        </h2>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40 mb-4">
        Live progress as you answer.
      </p>

      <div className="flex flex-col gap-3 mb-5">
        {missions.length === 0 && (
          <p className="text-cream/45 text-[13px] font-syne">
            No active missions right now. Check back after the daily reset.
          </p>
        )}
        {missions.map(m => (
          <MissionRow key={m.id} mission={m} />
        ))}
      </div>

      <div className="h-px bg-white/[0.06] my-4" />

      <div className="flex items-center gap-2 mb-2">
        <Coins size={12} className="text-gold" weight="fill" />
        <h3 className="font-bebas text-sm tracking-[0.18em] text-cream/85 uppercase">
          Daily Bet
        </h3>
      </div>

      {activeBet ? (
        <div
          className="rounded-[14px] border border-gold/25 bg-gold/[0.04] p-3"
        >
          <div className="flex items-center justify-between mb-1">
            <span className="font-bebas text-base text-gold tracking-wider">
              {activeBet.coins_staked} Fangs staked
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/55">
              {activeBet.subject ?? "Any subject"}
            </span>
          </div>
          <p className="text-cream/70 text-[12px] font-syne">
            Hit {activeBet.target_score} of {activeBet.target_total} to win.
          </p>
        </div>
      ) : (
        <p className="text-cream/45 text-[13px] font-syne">
          No active bet. Place one on the dashboard.
        </p>
      )}
    </div>
  );
}

function MissionRow({ mission }: { mission: DailyMission }) {
  const progressPct = Math.min((mission.progress / mission.target) * 100, 100);
  return (
    <div
      className="
        rounded-[14px] p-3
        border border-white/[0.06]
        bg-white/[0.02]
        relative overflow-hidden
      "
    >
      <div
        className="absolute top-0 left-0 right-0 h-[2px]"
        style={{ background: `linear-gradient(90deg, ${mission.color}, transparent)` }}
      />

      <div className="flex items-start gap-3 mb-2">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0"
          style={{ background: `${mission.color}15` }}
        >
          <span className="text-base">{mission.icon}</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bebas text-[14px] tracking-wider text-cream leading-tight">
            {mission.title}
          </p>
          <p className="text-cream/55 text-[10.5px] mt-0.5 leading-snug">
            {mission.description}
          </p>
        </div>
        <span
          className="text-[9px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ background: `${mission.color}15`, color: mission.color }}
        >
          +{mission.coinReward}
        </span>
      </div>

      <div className="flex items-center justify-between mb-1">
        <span className="text-cream/55 text-[9px] font-mono">
          {mission.claimed
            ? "Claimed"
            : mission.completed
              ? "Ready to claim on dashboard"
              : `${mission.progress}/${mission.target}`}
        </span>
        {!mission.claimed && (
          <span className="text-cream/45 text-[9px] font-mono">
            {Math.round(progressPct)}%
          </span>
        )}
      </div>
      <div
        className="w-full h-1.5 rounded-full overflow-hidden"
        style={{ background: "rgba(255,255,255,0.05)" }}
      >
        <div
          className="h-full rounded-full transition-[width] duration-700 ease-out"
          style={{
            width: `${Math.max(progressPct, progressPct > 0 ? 4 : 0)}%`,
            background: mission.claimed
              ? "linear-gradient(90deg, #2ECC71, #27AE60)"
              : `linear-gradient(90deg, ${mission.color}90, ${mission.color})`,
            boxShadow:
              progressPct > 0
                ? `0 0 6px ${mission.claimed ? "#2ECC71" : mission.color}40`
                : "none",
          }}
        />
      </div>
    </div>
  );
}
