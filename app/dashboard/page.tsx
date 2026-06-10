"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useUserStats, useSubjectStats, useQuizHistory, useWeeklyLeaderboard, useDailyMissions, useActiveBet } from "@/lib/hooks";
import { getDailyProgress, getUserAchievements, getBestScores, getActiveBounties, getUserBountyProgress, getLastResolvedBet, getWeeklyActivityChart } from "@/lib/db";
import type { Bounty, UserBounty, ActiveBet } from "@/lib/db";
import {
  getLevelProgress,
  formatCoins,
  SUBJECT_ICONS,
  SUBJECT_COLORS,
  DefaultSubjectIcon,
} from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import { cdnUrl } from "@/lib/cdn";
import { apiPost, apiGet, swrFetcher } from "@/lib/api-client";
import useSWR from "swr";
import CountUp from "@/components/CountUp";
import FluidReveal from "@/components/FluidReveal";
import DailyDrillWidget from "@/components/DailyDrillWidget";
import StreakReviveBanner from "@/components/StreakReviveBanner";
import DailyReadyNudge from "@/components/DailyReadyNudge";
import ProUpgradeNudge from "@/components/ProUpgradeNudge";
import { toastError, toastSuccess } from "@/lib/toast";
import AnimatedUsername from "@/components/AnimatedUsername";
import { useEquippedUsernameEffect } from "@/lib/use-username-effect";
import dynamic from "next/dynamic";
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
import {
  ArrowsClockwise,
  Lock,
  Sun,
  Fire,
  BookOpen,
  Sword,
  Check,
  DiceFive,
  Confetti as ConfettiIcon,
  SmileySad,
  Target,
  Crown,
  Medal,
} from "@phosphor-icons/react";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Let\u2019s build momentum.";
  if (h < 18) return "Keep the streak alive.";
  return "One more win before midnight.";
}

/* ── Circular stat widget ── */
function CircleStat({ value, label, icon, color, size = 90 }: {
  value: React.ReactNode; label: string; icon: React.ReactNode; color: string; size?: number;
}) {
  return (
    <div className="flex flex-col items-center gap-1.5 group">
      <div className="relative rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-105"
        style={{ width: size, height: size, background: `linear-gradient(135deg, ${color}15, ${color}08)`, border: `1.5px solid ${color}25`, boxShadow: `0 0 20px ${color}08` }}>
        <div className="text-center">
          <span className="text-sm block mb-0.5">{icon}</span>
          <span className="font-bebas text-lg leading-none" style={{ color }}>{value}</span>
        </div>
        {/* Orbiting dot */}
        <div className="absolute inset-0 rounded-full" style={{ animation: "orbit-stat 8s linear infinite" }}>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
        </div>
      </div>
      <span className="text-cream/55 text-[9px] font-mono tracking-wider uppercase">{label}</span>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}

function DashboardContent() {
  const { user, refreshUser } = useAuth();
  const { stats } = useUserStats(user?.id);
  // Shop V2 — drives the "Welcome back, {name}" hero header username effect.
  const usernameEffect = useEquippedUsernameEffect();
  // Hydration gate. useAuth + SWR seed from localStorage on the client,
  // so SSR (and the first client render commit) sees an empty cache while
  // the very next render sees populated data. Any conditional inside this
  // tree that depends on `stats` or `streakInfo` therefore renders
  // differently across those two passes. We gate those conditionals on
  // `mounted` so server + first client render agree, then flip post-mount.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  // ── Perf 2026-05-17: 14 uncached calls + hand-rolled sessionStorage cache
  //    → SWR. The bespoke `lionade_dash_*` sessionStorage layer is DELETED:
  //    the global persistent localStorage <SWRConfig> (app/layout.tsx) now
  //    supplies last-known data instantly on re-nav and revalidates in the
  //    background — that was the whole point of the audit. Shared hooks
  //    (subject stats / quiz history / weekly leaderboard) dedupe app-wide;
  //    everything else is keyed page-locally with stable string keys. State
  //    that is mutated optimistically (userBounties via claimBounty,
  //    dailyMissions via claimMission, activeBet via placeBet) stays useState
  //    and is hydrated from SWR onSuccess so those local mutations survive a
  //    background revalidation. Read-only data is derived directly. No new
  //    ad-hoc cache is introduced — the provider is the single cache.
  type RecentQuiz = { id: string; subject: string; total_questions: number; correct_answers: number; coins_earned: number; completed_at: string };
  type SubjStat = { subject: string; questionsAnswered: number; correctAnswers: number; coinsEarned: number };
  type LbRow = { rank: number; user_id: string; username: string; coins_this_week: number };
  type WeeklyChart = { day: string; date: string; questions: number; correct: number; coins: number; xp: number }[];
  type DailyMission = { id: string; title: string; description: string; icon: string; type: string; target: number; coinReward: number; xpReward: number; color: string; progress: number; completed: boolean; claimed: boolean };

  const uid = user?.id;

  const { data: subjectStatsData } = useSubjectStats(uid);
  const subjectStats: SubjStat[] = (subjectStatsData as SubjStat[] | undefined) ?? [];

  const { data: recentQuizzesData } = useQuizHistory(uid, 5);
  const recentQuizzes: RecentQuiz[] = (recentQuizzesData as RecentQuiz[] | undefined) ?? [];

  const { data: dailyProgressData } = useSWR(
    uid ? `dashboard-daily-progress/${uid}` : null,
    () => getDailyProgress(uid!).catch(() => ({ questions_answered: 0, coins_earned: 0 })),
    { keepPreviousData: true }
  );
  const dailyProgress = dailyProgressData ?? { questions_answered: 0, coins_earned: 0 };

  const { data: achievementsData } = useSWR(
    uid ? `dashboard-achievements/${uid}` : null,
    () => getUserAchievements(uid!).catch(() => []),
    { keepPreviousData: true }
  );
  const achievements: { achievement_key: string; unlocked_at: string }[] = achievementsData ?? [];

  const { data: bestScoresData } = useSWR(
    uid ? `dashboard-best-scores/${uid}` : null,
    () => getBestScores(uid!).catch(() => ({})),
    { keepPreviousData: true }
  );
  const bestScores: Record<string, { best: number; total: number }> = bestScoresData ?? {};

  const { data: leaderboardData } = useWeeklyLeaderboard(5);
  const leaderboard: LbRow[] = (leaderboardData as LbRow[] | undefined) ?? [];

  const { data: bountiesData } = useSWR(
    "dashboard-active-bounties",
    () => getActiveBounties().catch(() => []),
    { keepPreviousData: true }
  );
  const bounties: Bounty[] = bountiesData ?? [];
  // `undefined` = SWR in flight (pulse skeletons); resolved empty array = the
  // board is genuinely empty (show the "no bounties" card). Mirrors the
  // missions/subjects loading-vs-empty split elsewhere on this page.
  const bountiesLoading = bountiesData === undefined;

  // userBounties — locally mutated by claimBounty → keep useState, hydrate from SWR.
  const [userBounties, setUserBounties] = useState<UserBounty[]>([]);
  useSWR(
    uid ? `dashboard-user-bounties/${uid}` : null,
    () => getUserBountyProgress(uid!).catch(() => []),
    { keepPreviousData: true, onSuccess: (d) => setUserBounties(d ?? []) }
  );

  // activeBet — locally mutated by placeBet → keep useState, hydrate from
  // the shared `useActiveBet` hook (lib/hooks.ts) so the Quiz "Missions &
  // Bet" float and Dashboard read from the same SWR cache.
  const [activeBet, setActiveBet] = useState<ActiveBet | null>(null);
  const { data: activeBetData } = useActiveBet(uid);
  useEffect(() => {
    setActiveBet(activeBetData ?? null);
  }, [activeBetData]);

  const { data: lastBetData } = useSWR(
    uid ? `dashboard-last-bet/${uid}` : null,
    () => getLastResolvedBet(uid!).catch(() => null),
    { keepPreviousData: true }
  );
  const lastBet: ActiveBet | null = lastBetData ?? null;

  // Fire Confetti exactly once per resolved-win the user observes. Tracks the
  // last bet ID we've already celebrated in this session so SWR re-validations
  // don't replay the burst on every focus/poll.
  const [betCelebrateKey, setBetCelebrateKey] = useState(0);
  const celebratedBetIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!lastBet?.id || !lastBet.won || !lastBet.resolved_at) return;
    if (celebratedBetIdRef.current === lastBet.id) return;
    celebratedBetIdRef.current = lastBet.id;
    setBetCelebrateKey(k => k + 1);
  }, [lastBet?.id, lastBet?.won, lastBet?.resolved_at]);

  const [betStake, setBetStake] = useState(10);
  const [betTarget, setBetTarget] = useState(8);

  const { data: weeklyChartData } = useSWR(
    uid ? `dashboard-weekly-chart/${uid}` : null,
    () => getWeeklyActivityChart(uid!).catch(() => []),
    { keepPreviousData: true }
  );
  const weeklyChart: WeeklyChart = (weeklyChartData as WeeklyChart | undefined) ?? [];
  const [chartAnimated, setChartAnimated] = useState(false);
  // Trigger the chart fill once data is present (mirrors the prior
  // setTimeout-after-fetch behaviour, no flash-of-empty).
  useEffect(() => {
    if (weeklyChart.length > 0) {
      const t = setTimeout(() => setChartAnimated(true), 300);
      return () => clearTimeout(t);
    }
  }, [weeklyChart.length]);

  const [placingBet, setPlacingBet] = useState(false);

  const { data: eloRankData } = useSWR(
    uid ? `dashboard-elo-rank/${uid}` : null,
    async () => {
      const r = await apiGet<{ rank: number | null }>("/api/me/elo-rank");
      return r.ok && r.data ? r.data.rank : null;
    },
    { keepPreviousData: true }
  );
  const eloRank: number | null = eloRankData ?? null;

  // dailyMissions — locally mutated by claimMission → keep useState, hydrate
  // from the shared `useDailyMissions` hook (lib/hooks.ts). Same SWR cache as
  // the Quiz "Missions & Bet" float so post-answer mutate() updates both.
  const [dailyMissions, setDailyMissions] = useState<DailyMission[]>([]);
  const [missionsResetIn, setMissionsResetIn] = useState("");
  const { data: dailyMissionsData, mutate: mutateMissions } = useDailyMissions(uid);
  // Loading vs resolved-but-empty: the fetcher swallows API failures into an
  // empty payload, and the server always generates daily missions for every
  // user — so once resolved, an empty list IS the error case (retry card),
  // while `undefined` is the only true loading state (pulse skeletons).
  const missionsLoading = dailyMissionsData === undefined;
  useEffect(() => {
    setDailyMissions(dailyMissionsData?.missions ?? []);
    setMissionsResetIn(dailyMissionsData?.resetsIn ?? "");
  }, [dailyMissionsData]);

  // Side-effect (not data): rotate bounties at most once per hour per browser.
  //
  // 2026-05-25 (Phase A perf): previously fired POST /api/bounties/rotate on
  // EVERY dashboard mount, including every tab-switch back. With tab-switching
  // being a common dashboard interaction this was an unbounded write storm
  // against the rotate endpoint. Now gated by a localStorage timestamp so the
  // request fires at most once per hour per device. Server still owns the
  // canonical rotation cadence — this is a client-side coalesce, not a
  // correctness change. (Long-term we'll move rotation to a Supabase cron;
  // tracked separately.)
  useEffect(() => {
    if (!uid) return;
    const LS_KEY = "bounties-last-rotation";
    const ROTATE_INTERVAL_MS = 60 * 60 * 1000; // 1h
    try {
      const lastStr = localStorage.getItem(LS_KEY);
      const last = lastStr ? Number(lastStr) : 0;
      if (Number.isFinite(last) && Date.now() - last < ROTATE_INTERVAL_MS) {
        return;
      }
    } catch {
      // localStorage unavailable (private mode etc) — fall through and let
      // the rotate request fire. Better-safe than skipping rotation entirely.
    }
    apiPost("/api/bounties/rotate", {}).catch(() => {});
    try {
      localStorage.setItem(LS_KEY, String(Date.now()));
    } catch {
      /* ignore quota / disabled */
    }
  }, [uid]);
  // Counter instead of boolean: rapid claims re-increment this, which remounts
  // the Confetti component via `key` and fires a fresh burst even if the
  // previous burst hasn't finished yet.
  const [celebrateKey, setCelebrateKey] = useState(0);

  // Daily login bonus is now claimed via the Clock In button in the
  // navbar (24h rolling cooldown + history popover). No auto-claim here.

  if (!user) return null; // ProtectedRoute handles redirect

  const claimBounty = async (bountyId: string) => {
    const bounty = bounties.find(b => b.id === bountyId);
    const res = await apiPost<{ coinsAwarded?: number }>("/api/claim-bounty", { bountyId });
    if (res.ok) {
      setUserBounties(prev => prev.map(ub => ub.bounty_id === bountyId ? { ...ub, claimed: true } : ub));
      await refreshUser();
      const reward = bounty?.coin_reward ?? res.data?.coinsAwarded ?? 0;
      toastSuccess(reward > 0 ? `Bounty claimed. +${reward} Fangs` : "Bounty claimed");
      setCelebrateKey(k => k + 1);
    } else {
      toastError("Couldn't claim bounty. Please try again.");
    }
  };

  const claimMission = async (missionId: string) => {
    const mission = dailyMissions.find(m => m.id === missionId);
    const res = await apiPost("/api/missions/claim", { missionId });
    if (res.ok) {
      setDailyMissions(prev => prev.map(m => m.id === missionId ? { ...m, claimed: true } : m));
      await refreshUser();
      toastSuccess(mission ? `${mission.title}. +${mission.coinReward} Fangs` : "Mission claimed");
      setCelebrateKey(k => k + 1);
    } else {
      toastError("Couldn't claim mission. Please try again.");
    }
  };

  const placeBet = async () => {
    if (placingBet || coins < betStake) return;
    setPlacingBet(true);
    try {
      const res = await apiPost<{ success: boolean; bet: ActiveBet }>("/api/place-bet", {
        coinsStaked: betStake,
        targetScore: betTarget,
      });
      if (res.ok && res.data?.success) {
        setActiveBet(res.data.bet);
        await refreshUser();
        toastSuccess(`Bet placed. ${betStake} Fangs on ${betTarget}/10.`);
      } else {
        toastError("Couldn't place bet. Please try again.");
      }
    } catch {
      toastError("Couldn't place bet. Please try again.");
    } finally {
      setPlacingBet(false);
    }
  };

  const BET_MULTIPLIERS: Record<number, number> = { 7: 1.5, 8: 2, 9: 3, 10: 5 };

  const coins = stats?.coins ?? user.coins;
  const streak = stats?.streak ?? user.streak;
  const xp = stats?.xp ?? user.xp;
  const userLevel = stats?.level ?? user.level;
  const statsReady = !!stats || user.statsLoaded;
  const levelInfo = getLevelProgress(xp);
  const { level } = levelInfo;
  const progress = levelInfo.progressPercent;
  const xpToNext = levelInfo.xpNeededForNext;
  const currentXp = levelInfo.currentXpInLevel;
  const todayCoins = dailyProgress.coins_earned;
  const displaySubjects = subjectStats;
  // SWR resolution flags — `undefined` means in-flight (no-flash-of-zero gate);
  // a resolved empty array means the user genuinely has no data yet.
  const subjectsLoading = subjectStatsData === undefined;
  const dailyProgressReady = dailyProgressData !== undefined;
  const dailyDone = dailyProgress.questions_answered > 0;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const cardShapes = [
    "rounded-[24px]",
    "rounded-tl-[32px] rounded-br-[32px] rounded-tr-[8px] rounded-bl-[8px]",
    "rounded-[24px]",
    "rounded-tr-[32px] rounded-bl-[32px] rounded-tl-[8px] rounded-br-[8px]",
    "rounded-[24px]",
  ];

  return (
    <>
      <style jsx global>{`
        @keyframes orbit-stat {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.5s ease both;
        }
        /* Hero aurora — purely decorative, GPU-only drift */
        @keyframes hero-aurora-drift {
          0%   { transform: translate3d(-4%, 0, 0) scale(1); opacity: 0.55; }
          50%  { transform: translate3d( 4%, -2%, 0) scale(1.05); opacity: 0.75; }
          100% { transform: translate3d(-4%, 0, 0) scale(1); opacity: 0.55; }
        }
        .hero-aurora {
          animation: hero-aurora-drift 14s ease-in-out infinite;
          will-change: transform, opacity;
        }
        /* Daily Bet idle highlight — subtle gold halo cycle */
        @keyframes bet-card-pulse {
          0%, 100% { box-shadow: 0 0 24px rgba(255,215,0,0.04), inset 0 0 0 1px rgba(255,215,0,0.10); }
          50%      { box-shadow: 0 0 30px rgba(255,215,0,0.10), inset 0 0 0 1px rgba(255,215,0,0.18); }
        }
        .bet-idle-pulse {
          animation: bet-card-pulse 4.2s ease-in-out infinite;
          will-change: box-shadow;
        }
        /* Daily Bet active "in play" — electric blue + gold double halo */
        @keyframes bet-active-pulse {
          0%, 100% { box-shadow: 0 0 22px rgba(74,144,217,0.08), 0 0 12px rgba(255,215,0,0.05), inset 0 0 0 1px rgba(74,144,217,0.18); }
          50%      { box-shadow: 0 0 34px rgba(74,144,217,0.18), 0 0 18px rgba(255,215,0,0.10), inset 0 0 0 1px rgba(74,144,217,0.32); }
        }
        .bet-active-pulse {
          animation: bet-active-pulse 2.8s ease-in-out infinite;
          will-change: box-shadow;
        }
        /* In-play status dot — small breathing ping */
        @keyframes bet-status-ping {
          0%, 100% { transform: scale(1); opacity: 0.95; }
          50%      { transform: scale(1.45); opacity: 0.35; }
        }
        .bet-status-ping {
          animation: bet-status-ping 1.6s ease-in-out infinite;
          will-change: transform, opacity;
        }
        /* Win burst — one-shot gold ring sweep on resolved win */
        @keyframes bet-win-burst {
          0%   { box-shadow: 0 0 0 0 rgba(255,215,0,0.45), 0 0 22px rgba(255,215,0,0.10); }
          60%  { box-shadow: 0 0 0 14px rgba(255,215,0,0.00), 0 0 40px rgba(255,215,0,0.22); }
          100% { box-shadow: 0 0 0 0 rgba(255,215,0,0.00), 0 0 26px rgba(255,215,0,0.14); }
        }
        .bet-win-burst {
          animation: bet-win-burst 1.6s cubic-bezier(.2,.7,.2,1) 1 forwards;
          will-change: box-shadow;
        }
        /* Win numeral — slow shimmer pass on the big Fangs total */
        @keyframes bet-win-numeral {
          0%   { transform: scale(0.92); opacity: 0; filter: brightness(1.05); }
          55%  { transform: scale(1.04); opacity: 1; filter: brightness(1.35); }
          100% { transform: scale(1);    opacity: 1; filter: brightness(1.10); }
        }
        .bet-win-numeral {
          animation: bet-win-numeral 900ms cubic-bezier(.2,.7,.2,1) 1 both;
          will-change: transform, opacity, filter;
        }
        /* Loss state — calm fade-in, no shame */
        @keyframes bet-loss-rise {
          from { opacity: 0; transform: translate3d(0, 6px, 0); }
          to   { opacity: 1; transform: translate3d(0, 0, 0); }
        }
        .bet-loss-rise {
          animation: bet-loss-rise 520ms ease-out 1 both;
          will-change: transform, opacity;
        }
        /* Lift effect for clickable tiles — transform-only */
        .dash-lift { transition: transform 220ms cubic-bezier(.2,.7,.2,1), box-shadow 220ms ease; will-change: transform; }
        .dash-lift:hover { transform: translate3d(0, -2px, 0); }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none !important; opacity: 1 !important; transform: none !important; }
          .hero-aurora { animation: none !important; }
          .bet-idle-pulse { animation: none !important; }
          .bet-active-pulse { animation: none !important; }
          .bet-status-ping { animation: none !important; }
          .bet-win-burst { animation: none !important; }
          .bet-win-numeral { animation: none !important; transform: none !important; opacity: 1 !important; filter: none !important; }
          .bet-loss-rise { animation: none !important; opacity: 1 !important; transform: none !important; }
          .dash-lift:hover { transform: none !important; }
        }
      `}</style>

      {/* Celebration confetti on bounty/mission claim — keyed on a counter
          so rapid-fire claims remount the component and always fire fresh. */}
      <Confetti key={celebrateKey} trigger={celebrateKey > 0} count={50} duration={1400} />
      {/* Daily Bet win — separate channel so it can coexist with claim bursts.
          Heavier count + longer duration to match the bigger moment. */}
      <Confetti key={`bet-${betCelebrateKey}`} trigger={betCelebrateKey > 0} count={80} duration={1800} />

      <div className="min-h-screen pt-16 pb-20 md:pb-8 relative overflow-hidden">
        {/* Background floating shapes */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
          <div className="geo-float absolute" style={{ top: "10%", right: "5%", animationDuration: "16s" }}>
            <div style={{ width: 20, height: 20, border: "1px solid rgba(74,144,217,0.08)", transform: "rotate(45deg)" }} />
          </div>
          <div className="geo-spin absolute" style={{ bottom: "20%", left: "3%", animationDuration: "22s" }}>
            <div style={{ width: 30, height: 30, border: "1px solid rgba(255,215,0,0.06)", borderRadius: "50%" }} />
          </div>
          <div className="geo-float absolute" style={{ top: "50%", right: "8%", animationDelay: "-5s", animationDuration: "14s" }}>
            <svg width="18" height="16" viewBox="0 0 18 16"><polygon points="9,0 18,16 0,16" fill="none" stroke="rgba(74,144,217,0.06)" strokeWidth="1" /></svg>
          </div>
        </div>

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 relative z-10">

          {/* ═══ 1) Hero Header ═══ */}
          <div className="mb-7 animate-slide-up relative">
            {/* Aurora glow — purely decorative, sits behind the welcome line */}
            <div className="absolute -top-10 -left-12 w-[420px] h-[180px] pointer-events-none hero-aurora"
              aria-hidden="true"
              style={{
                background: "radial-gradient(ellipse at center, rgba(74,144,217,0.18) 0%, rgba(155,89,182,0.08) 35%, transparent 70%)",
                filter: "blur(28px)",
              }}
            />
            <div className="flex items-start justify-between gap-4 relative">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-electric/55 mb-1.5">
                  Command Bridge
                </p>
                <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-wider leading-[0.95]">
                  Welcome back, {usernameEffect === "none"
                    ? <span className="shimmer-text">{user.username}</span>
                    : <AnimatedUsername username={user.username} effect={usernameEffect} size="lg" className="font-bebas tracking-wider" />}
                </h1>
                <p className="text-cream/65 text-sm mt-2 font-syne">{getGreeting()}</p>
              </div>
              <div className="hidden sm:flex flex-col items-end gap-1.5 flex-shrink-0">
                <p className="text-cream/30 text-[11px] font-mono tracking-wider uppercase">{today}</p>
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full bg-electric/10 text-electric/85 border border-electric/20">
                  <span className="w-1.5 h-1.5 rounded-full bg-electric animate-pulse" />
                  Ready to study
                </span>
              </div>
            </div>
          </div>

          {/* ═══ 2) Circular Stats Row ═══ */}
          <div className="flex justify-center sm:justify-start gap-6 sm:gap-8 mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            <Link href="/wallet" className="press-feedback inline-block">
              <CircleStat icon={<img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain mx-auto" />} value={statsReady ? <CountUp id="dash-coins" value={coins} format={formatCoins} /> : <span className="text-cream/30">{"—"}</span>} label={dailyProgressReady ? `+${todayCoins} today` : "— today"} color="#FFD700" />
            </Link>
            <div className="flex flex-col items-center gap-1.5 group">
              <div className={`relative rounded-full flex items-center justify-center transition-transform duration-300 group-hover:scale-105 ${statsReady && streak >= 1 ? "streak-fire-glow" : ""}`}
                style={{ width: 90, height: 90, background: `linear-gradient(135deg, #E67E2215, #E67E2208)`, border: `1.5px solid #E67E2225`, boxShadow: statsReady && streak >= 1 ? `0 0 ${12 + Math.min(streak, 10) * 3}px rgba(230,126,34,${0.15 + Math.min(streak, 10) * 0.04})` : `0 0 20px #E67E2208` }}>
                <div className="text-center">
                  <Fire size={16} weight="fill" color="#E67E22" className="mx-auto mb-0.5" aria-hidden="true" />
                  <span className="font-bebas text-lg leading-none" style={{ color: "#E67E22" }}>{statsReady ? <CountUp id="dash-streak" value={streak} duration={400} /> : <span className="text-cream/30">{"—"}</span>}</span>
                </div>
                <div className="absolute inset-0 rounded-full" style={{ animation: "orbit-stat 8s linear infinite" }}>
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full" style={{ background: "#E67E22", boxShadow: `0 0 6px #E67E22` }} />
                </div>
              </div>
              <span className="text-cream/55 text-[9px] font-mono tracking-wider uppercase">quiz streak</span>
            </div>
            <CircleStat icon={levelInfo.tier.icon} value={<>Lv.<CountUp id="dash-level" value={level} duration={400} /></>} label={levelInfo.tier.name} color={levelInfo.tier.color} />
            <CircleStat icon={<BookOpen size={20} weight="regular" color="#9B59B6" aria-hidden="true" />} value={subjectsLoading ? <span className="text-cream/30">{"—"}</span> : <CountUp id="dash-subjects" value={displaySubjects.length} duration={400} />} label="subjects" color="#9B59B6" />
            <Link href="/leaderboard" className="press-feedback inline-block">
              <CircleStat icon={<Sword size={20} weight="regular" color="#E74C3C" aria-hidden="true" />} value={eloRank ? <>#<CountUp id="dash-rank" value={eloRank} duration={400} /></> : "\u2014"} label="rank" color="#E74C3C" />
            </Link>
          </div>
          {mounted && statsReady && streak >= 3 && (
            <div className="mb-6 animate-slide-up flex items-center gap-2 px-4 py-2.5 rounded-full w-fit mx-auto sm:mx-0" style={{ background: "linear-gradient(135deg, rgba(230,126,34,0.12), rgba(255,215,0,0.08))", border: "1px solid rgba(230,126,34,0.2)" }}>
              <Fire size={18} weight="fill" color="#E67E22" className="streak-fire-glow" aria-hidden="true" />
              <span className="text-cream/80 text-xs font-semibold">You&apos;re on fire! {streak} streak</span>
            </div>
          )}

          {/* ═══ 3) Level Progress ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.08s" }}>
            {!statsReady ? (
              /* xp is seeded from the auth fallback — skeleton until stats resolve (no flash-of-zero) */
              <>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="h-4 w-44 rounded bg-white/5 animate-pulse" />
                  <div className="h-3 w-28 rounded bg-white/5 animate-pulse" />
                </div>
                <div className="w-full h-3 rounded-full bg-white/[0.04] animate-pulse" />
              </>
            ) : (
            <>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm">{levelInfo.tier.icon}</span>
                <span className="font-bebas text-sm tracking-wider" style={{ color: levelInfo.tier.color }}>
                  Lv.{level} {levelInfo.tier.name}
                </span>
                <span className="text-cream/55 text-[10px]">
                  {currentXp.toLocaleString()} / {levelInfo.isMaxLevel ? "MAX" : xpToNext.toLocaleString()} XP
                </span>
              </div>
              <span className="text-cream/25 text-[10px]">
                {levelInfo.isMaxLevel ? "MAX LEVEL" : `${progress.toFixed(0)}% \u2022 ${(xpToNext - currentXp).toLocaleString()} XP to Lv.${level + 1}`}
              </span>
            </div>
            <div className="w-full h-3 rounded-full overflow-hidden relative" style={{ background: "rgba(255,255,255,0.04)" }}>
              <div className="h-full rounded-full xp-bar-fill"
                style={{ width: `${Math.max(progress, 2)}%`, background: `linear-gradient(90deg, ${levelInfo.tier.color}90, ${levelInfo.tier.color})`, boxShadow: `0 0 12px ${levelInfo.tier.color}50, 0 0 24px ${levelInfo.tier.color}20`, transition: "width 1.2s cubic-bezier(0.25, 0.46, 0.45, 0.94)" }} />
            </div>
            </>
            )}
          </div>

          {/* ═══ 3.3) Daily ready nudge — only renders when the daily Clock In is available ═══ */}
          <DailyReadyNudge />

          {/* ═══ 3.4) Streak Revive — only renders when a 24h grace window is open ═══ */}
          <StreakReviveBanner />

          {/* ═══ 3.45) Free → Pro upgrade nudge — only renders for free-tier users ═══ */}
          <ProUpgradeNudge />

          {/* ═══ 3.5) Your Classes — quick row that links into the notebook ═══ */}
          <YourClassesRow />

          {/* ═══ 3.7) Daily Drill — 5 questions you got wrong ═══ */}
          <DailyDrillWidget />

          {/* ═══ 4) Today's Missions ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bebas text-xl text-cream tracking-wider">TODAY&apos;S MISSIONS</h2>
              {missionsResetIn && (
                <span className="text-cream/25 text-[10px] font-mono">Resets in {missionsResetIn}</span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {dailyMissions.map((mission, i) => {
                const progressPct = Math.min((mission.progress / mission.target) * 100, 100);
                const shapes = [
                  "rounded-tl-[24px] rounded-br-[24px] rounded-tr-[8px] rounded-bl-[8px]",
                  "rounded-[16px]",
                  "rounded-tr-[24px] rounded-bl-[24px] rounded-tl-[8px] rounded-br-[8px]",
                ];
                return (
                  <div key={mission.id} className={`${shapes[i]} p-4 relative overflow-hidden transition-all duration-300 hover:scale-[1.02] group`}
                    style={{
                      // Bucket A consistency: idle missions now carry a low-opacity
                      // wash of their own mission.color so the card's identity reads
                      // at a glance, not only via the top accent stripe. Completed
                      // + claimed states keep their existing brighter tints so they
                      // still pop louder than idle.
                      background: mission.claimed
                        ? "linear-gradient(135deg, rgba(46,204,113,0.08), rgba(46,204,113,0.03))"
                        : mission.completed
                        ? "linear-gradient(135deg, rgba(255,215,0,0.1), rgba(255,165,0,0.05))"
                        : `linear-gradient(135deg, ${mission.color}14, ${mission.color}05)`,
                      boxShadow: mission.completed && !mission.claimed
                        ? `0 0 0 1.5px ${mission.color}40, 0 0 20px ${mission.color}15`
                        : mission.claimed
                        ? "0 0 0 1px rgba(255,255,255,0.05)"
                        : `0 0 0 1px ${mission.color}20`,
                    }}>
                    {/* Accent line */}
                    <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: `linear-gradient(90deg, ${mission.color}, transparent)` }} />

                    <div className="flex items-start gap-3 mb-3">
                      <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                        style={{ background: `${mission.color}15`, boxShadow: `0 0 12px ${mission.color}10` }}>
                        <span className="text-lg">{mission.icon}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-bebas text-sm tracking-wider text-cream leading-tight">{mission.title}</p>
                        <p className="text-cream/60 text-[10px] mt-0.5 leading-tight">{mission.description}</p>
                      </div>
                    </div>

                    {/* Rewards */}
                    <div className="flex items-center gap-1.5 mb-3">
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${mission.color}15`, color: mission.color }}>
                        +{mission.coinReward} Fangs
                      </span>
                      <span className="text-[9px] font-semibold px-2 py-0.5 rounded-full bg-electric/10 text-electric/80">
                        +{mission.xpReward} XP
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="mb-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-cream/55 text-[9px] font-mono">
                          {mission.claimed ? "Claimed" : mission.completed ? "Complete!" : `${mission.progress}/${mission.target}`}
                        </span>
                        {!mission.claimed && <span className="text-cream/55 text-[9px]">{Math.round(progressPct)}%</span>}
                      </div>
                      <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                        <div className={`h-full rounded-full transition-all duration-1000 ease-out ${progressPct > 0 && progressPct < 100 && !mission.claimed ? "progress-shimmer" : ""}`}
                          style={{
                            width: `${Math.max(progressPct, progressPct > 0 ? 4 : 0)}%`,
                            background: mission.claimed
                              ? "linear-gradient(90deg, #2ECC71, #27AE60)"
                              : `linear-gradient(90deg, ${mission.color}90, ${mission.color})`,
                            boxShadow: progressPct > 0 ? `0 0 6px ${mission.claimed ? "#2ECC71" : mission.color}40` : "none",
                          }} />
                      </div>
                    </div>

                    {/* Claim button */}
                    {mission.completed && !mission.claimed && (
                      <button onClick={() => claimMission(mission.id)}
                        className="w-full py-1.5 rounded-full text-[11px] font-bold text-navy transition-all duration-200 active:scale-95 breathe-glow"
                        style={{ background: `linear-gradient(90deg, ${mission.color}, ${mission.color}CC)` }}>
                        Claim Reward
                      </button>
                    )}
                    {mission.claimed && (
                      <div className="text-center">
                        <span className="text-[10px] font-semibold text-emerald-400/70 inline-flex items-center gap-1"><Check size={12} weight="bold" aria-hidden="true" /> Reward Claimed</span>
                      </div>
                    )}
                  </div>
                );
              })}
              {dailyMissions.length === 0 && missionsLoading && (
                <>
                  {[0, 1, 2].map(i => (
                    <div key={i} className="rounded-[16px] p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                      <div className="h-10 w-10 rounded-full bg-white/5 mb-3" />
                      <div className="h-3 w-24 rounded bg-white/5 mb-2" />
                      <div className="h-2 w-32 rounded bg-white/3" />
                    </div>
                  ))}
                </>
              )}
              {dailyMissions.length === 0 && !missionsLoading && (
                /* Missions exist for every user every day, so a resolved-empty
                   payload means the fetch failed — red-glass retry card. */
                <div className="sm:col-span-3 rounded-2xl border border-red-400/30 bg-red-400/5 p-5 text-center">
                  <p className="font-syne text-sm text-red-300 mb-3">Missions didn&apos;t load. Give it another shot.</p>
                  <button
                    type="button"
                    onClick={() => mutateMissions()}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
                  >
                    <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
                    Retry
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ═══ 5) Daily Bet ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.16s" }}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-bebas text-xl text-cream tracking-wider">DAILY BET</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/30">
                {activeBet ? "In play" : lastBet && lastBet.resolved_at ? (lastBet.won ? "Last round: Won" : "Last round: Settled") : "Risk / Reward"}
              </span>
            </div>
            {(() => {
              const stateClass = activeBet
                ? "bet-active-pulse"
                : lastBet && lastBet.resolved_at && lastBet.won
                  ? "bet-win-burst"
                  : !activeBet && !lastBet
                    ? "bet-idle-pulse"
                    : "bet-idle-pulse";
              const borderColor = activeBet
                ? "rgba(74,144,217,0.28)"
                : lastBet && lastBet.resolved_at && lastBet.won
                  ? "rgba(255,215,0,0.35)"
                  : lastBet && lastBet.resolved_at && !lastBet.won
                    ? "rgba(255,255,255,0.08)"
                    : "rgba(255,215,0,0.1)";
              const topAccent = activeBet
                ? "linear-gradient(90deg, #4A90D9, #6AABF0, transparent)"
                : lastBet && lastBet.resolved_at && lastBet.won
                  ? "linear-gradient(90deg, #FFD700, #FFA500, #FFD700, transparent)"
                  : lastBet && lastBet.resolved_at && !lastBet.won
                    ? "linear-gradient(90deg, rgba(255,255,255,0.18), transparent)"
                    : "linear-gradient(90deg, #FFD700, #FFA500, transparent)";
              return (
            <div className={`rounded-tl-[28px] rounded-br-[28px] rounded-tr-[10px] rounded-bl-[10px] p-5 relative overflow-hidden ${stateClass}`}
              style={{ background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)", border: `1px solid ${borderColor}`, boxShadow: "0 0 24px rgba(255,215,0,0.04)" }}>
              <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: topAccent }} />

              {activeBet ? (
                <div>
                  <div className="flex items-center gap-3 mb-4">
                    <DiceFive size={28} weight="fill" color="#FFD700" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full font-mono text-[9px] uppercase tracking-[0.22em] text-electric"
                          style={{ background: "rgba(74,144,217,0.12)", border: "1px solid rgba(74,144,217,0.32)" }}
                        >
                          <span
                            className="bet-status-ping inline-block w-1.5 h-1.5 rounded-full"
                            style={{ background: "#6AABF0", boxShadow: "0 0 8px rgba(106,171,240,0.85)" }}
                            aria-hidden="true"
                          />
                          In play
                        </span>
                        <span className="text-cream/55 text-[10px]">
                          Score {activeBet.target_score}/{activeBet.target_total} on your next quiz
                        </span>
                      </div>
                      <p className="font-bebas text-cream/75 tracking-[0.14em] text-[11px] uppercase mt-1.5">
                        Resolves on your next quiz finish
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
                    <div
                      className="rounded-[14px] p-3"
                      style={{ background: "rgba(255,215,0,0.06)", border: "1px solid rgba(255,215,0,0.18)" }}
                    >
                      <span className="block font-mono text-[9px] uppercase tracking-[0.22em] text-gold/70 mb-1">Staked</span>
                      <div className="flex items-end gap-1.5">
                        <span className="font-bebas text-gold leading-none text-[34px] tracking-wider">
                          {activeBet.coins_staked > 0 ? activeBet.coins_staked : "—"}
                        </span>
                        <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain mb-1" />
                      </div>
                    </div>

                    <div className="flex flex-col items-center gap-1 px-1">
                      <span
                        className="font-bebas text-gold tracking-wider text-[15px] leading-none px-2 py-1 rounded-full"
                        style={{ background: "rgba(255,215,0,0.10)", border: "1px solid rgba(255,215,0,0.30)" }}
                      >
                        {BET_MULTIPLIERS[activeBet.target_score] ?? 1}X
                      </span>
                      <span className="text-cream/35 text-[14px] leading-none">&rarr;</span>
                    </div>

                    <div
                      className="rounded-[14px] p-3"
                      style={{ background: "rgba(74,144,217,0.06)", border: "1px solid rgba(74,144,217,0.22)" }}
                    >
                      <span className="block font-mono text-[9px] uppercase tracking-[0.22em] text-electric/70 mb-1">To win</span>
                      <div className="flex items-end gap-1.5">
                        <span className="font-bebas text-electric leading-none text-[34px] tracking-wider">
                          {activeBet.coins_staked > 0 ? Math.floor(activeBet.coins_staked * (BET_MULTIPLIERS[activeBet.target_score] ?? 1)) : "—"}
                        </span>
                        <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain mb-1" />
                      </div>
                    </div>
                  </div>
                </div>
              ) : lastBet && lastBet.resolved_at ? (
                <div className={lastBet.won ? "" : "bet-loss-rise"}>
                  {lastBet.won ? (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <ConfettiIcon size={22} weight="fill" color="#FFD700" aria-hidden="true" />
                        <span
                          className="font-mono text-[9px] uppercase tracking-[0.28em] px-2 py-0.5 rounded-full"
                          style={{ background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.35)", color: "#FFD700" }}
                        >
                          Won
                        </span>
                        <span className="font-mono text-[10px] tracking-[0.2em] text-cream/45 uppercase">
                          {BET_MULTIPLIERS[lastBet.target_score] ?? 1}X payout
                        </span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-bebas text-gold leading-[0.9] text-[64px] tracking-wider bet-win-numeral">
                          +{lastBet.coins_won > 0 ? lastBet.coins_won : 0}
                        </span>
                        <img src={cdnUrl("/F.png")} alt="Fangs" className="w-7 h-7 object-contain mb-2" />
                        <span className="font-bebas text-gold/80 tracking-[0.14em] text-base uppercase mb-3 ml-1">
                          Fangs
                        </span>
                      </div>
                      <p className="text-cream/55 text-[11px] mt-1">
                        Staked {lastBet.coins_staked} on {lastBet.target_score}/{lastBet.target_total}. Run it back below.
                      </p>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <SmileySad size={22} weight="regular" color="rgba(238,244,255,0.55)" aria-hidden="true" />
                        <span
                          className="font-mono text-[9px] uppercase tracking-[0.28em] px-2 py-0.5 rounded-full text-cream/60"
                          style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.10)" }}
                        >
                          Settled
                        </span>
                        <span className="font-mono text-[10px] tracking-[0.2em] text-cream/40 uppercase">
                          Streak still alive
                        </span>
                      </div>
                      <div className="flex items-end gap-2">
                        <span className="font-bebas text-cream/70 leading-[0.9] text-[48px] tracking-wider">
                          Tomorrow&apos;s
                        </span>
                      </div>
                      <div className="flex items-end gap-2 -mt-1">
                        <span className="font-bebas text-gold/70 leading-[0.9] text-[48px] tracking-wider">
                          Yours.
                        </span>
                      </div>
                      <p className="text-cream/45 text-[11px] mt-2">
                        Lost {lastBet.coins_staked} Fangs on {lastBet.target_score}/{lastBet.target_total}. Reload below for the next swing.
                      </p>
                    </div>
                  )}

                  {/* Show bet form below */}
                  <div className="border-t border-white/[0.06] pt-3 mt-2">
                    <div className="flex flex-wrap items-center gap-3">
                      <div>
                        <span className="font-mono text-cream/45 text-[9px] uppercase tracking-[0.22em] block mb-1.5">Stake</span>
                        <div className="flex gap-1.5">
                          {[10, 25, 50].map(amt => (
                            <button key={amt} onClick={() => setBetStake(amt)}
                              className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all duration-200 ${betStake === amt ? "text-navy" : "text-cream/50 hover:text-cream/70"}`}
                              style={betStake === amt ? { background: "linear-gradient(90deg, #FFD700, #FFA500)", boxShadow: "0 0 8px rgba(255,215,0,0.3)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                              {amt} <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain inline" />
                            </button>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="font-mono text-cream/45 text-[9px] uppercase tracking-[0.22em] block mb-1.5">Target</span>
                        <div className="flex gap-1.5">
                          {[7, 8, 9, 10].map(t => (
                            <button key={t} onClick={() => setBetTarget(t)}
                              className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-2xl text-[11px] font-bold transition-all duration-200 ${betTarget === t ? "text-navy" : "text-cream/50 hover:text-cream/70"}`}
                              style={betTarget === t ? { background: "linear-gradient(90deg, #4A90D9, #6AABF0)", boxShadow: "0 0 8px rgba(74,144,217,0.3)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                              <span className="leading-none">{t}/10</span>
                              <span className={`font-mono leading-none text-[8.5px] tracking-[0.18em] uppercase ${betTarget === t ? "text-navy/70" : "text-gold/70"}`}>
                                {BET_MULTIPLIERS[t]}x
                              </span>
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="font-mono text-cream/45 text-[9px] uppercase tracking-[0.22em] block mb-1">To win</span>
                        <div className="flex items-end gap-1">
                          <span className="font-bebas text-gold leading-none text-[22px] tracking-wider">
                            {Math.floor(betStake * (BET_MULTIPLIERS[betTarget] ?? 1))}
                          </span>
                          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain mb-0.5" />
                        </div>
                        <span className="font-mono text-gold/60 text-[9px] uppercase tracking-[0.18em] mt-0.5">
                          {BET_MULTIPLIERS[betTarget]}x
                        </span>
                      </div>
                    </div>
                    <button onClick={placeBet} disabled={placingBet || coins < betStake}
                      className="mt-3 w-full py-2.5 rounded-full font-bebas tracking-[0.22em] uppercase text-[13px] transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ background: coins >= betStake ? "linear-gradient(90deg, #FFD700, #FFA500)" : "rgba(255,255,255,0.06)", color: coins >= betStake ? "#0a1020" : "rgba(255,255,255,0.3)", boxShadow: coins >= betStake ? "0 0 16px rgba(255,215,0,0.2)" : "none" }}>
                      {placingBet ? "Placing..." : coins < betStake ? "Not enough Fangs" : `Run it back · ${betStake} Fangs`}
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <DiceFive size={28} weight="fill" color="#FFD700" aria-hidden="true" />
                    <div>
                      <p className="font-bebas text-cream tracking-[0.14em] text-[15px] uppercase">Bet on Yourself</p>
                      <p className="text-cream/60 text-[11px]">Risk {betStake} Fangs, win {Math.floor(betStake * (BET_MULTIPLIERS[betTarget] ?? 1))}.</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-3">
                    <div>
                      <span className="font-mono text-cream/45 text-[9px] uppercase tracking-[0.22em] block mb-1.5">Stake</span>
                      <div className="flex gap-1.5">
                        {[10, 25, 50].map(amt => (
                          <button key={amt} onClick={() => setBetStake(amt)}
                            className={`px-3 py-1.5 rounded-full text-[11px] font-bold transition-all duration-200 ${betStake === amt ? "text-navy" : "text-cream/50 hover:text-cream/70"}`}
                            style={betStake === amt ? { background: "linear-gradient(90deg, #FFD700, #FFA500)", boxShadow: "0 0 8px rgba(255,215,0,0.3)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                            {amt} <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain inline" />
                          </button>
                        ))}
                      </div>
                    </div>
                    <div>
                      <span className="font-mono text-cream/45 text-[9px] uppercase tracking-[0.22em] block mb-1.5">Target</span>
                      <div className="flex gap-1.5">
                        {[7, 8, 9, 10].map(t => (
                          <button key={t} onClick={() => setBetTarget(t)}
                            className={`flex flex-col items-center gap-0.5 px-2.5 py-1.5 rounded-2xl text-[11px] font-bold transition-all duration-200 ${betTarget === t ? "text-navy" : "text-cream/50 hover:text-cream/70"}`}
                            style={betTarget === t ? { background: "linear-gradient(90deg, #4A90D9, #6AABF0)", boxShadow: "0 0 8px rgba(74,144,217,0.3)" } : { background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}>
                            <span className="leading-none">{t}/10</span>
                            <span className={`font-mono leading-none text-[8.5px] tracking-[0.18em] uppercase ${betTarget === t ? "text-navy/70" : "text-gold/70"}`}>
                              {BET_MULTIPLIERS[t]}x
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="font-mono text-cream/45 text-[9px] uppercase tracking-[0.22em] block mb-1">To win</span>
                      <div className="flex items-end gap-1">
                        <span className="font-bebas text-gold leading-none text-[22px] tracking-wider">
                          {Math.floor(betStake * (BET_MULTIPLIERS[betTarget] ?? 1))}
                        </span>
                        <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain mb-0.5" />
                      </div>
                      <span className="font-mono text-gold/60 text-[9px] uppercase tracking-[0.18em] mt-0.5">
                        {BET_MULTIPLIERS[betTarget]}x
                      </span>
                    </div>
                  </div>
                  <button onClick={placeBet} disabled={placingBet || coins < betStake}
                    className="mt-3 w-full py-2.5 rounded-full font-bebas tracking-[0.22em] uppercase text-[13px] transition-all duration-200 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                    style={{ background: coins >= betStake ? "linear-gradient(90deg, #FFD700, #FFA500)" : "rgba(255,255,255,0.06)", color: coins >= betStake ? "#0a1020" : "rgba(255,255,255,0.3)", boxShadow: coins >= betStake ? "0 0 16px rgba(255,215,0,0.2)" : "none" }}>
                    {placingBet ? "Placing..." : coins < betStake ? "Not enough Fangs" : `Place Bet · ${betStake} Fangs`}
                  </button>
                </div>
              )}
            </div>
              );
            })()}
          </div>

          {/* ═══ 5c) Bounty Board ═══ */}
          <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.17s" }}>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-bebas text-xl text-cream tracking-wider">BOUNTY BOARD</h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/30">Live targets</span>
            </div>

            {/* Daily Bounties */}
            {bounties.filter(b => b.type === "daily").length > 0 && (
              <div className="mb-4">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-gold text-xs font-semibold">DAILY</span>
                  <span className="text-cream/55 text-[10px]">Resets at midnight</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bounties.filter(b => b.type === "daily").slice(0, 3).map((bounty) => {
                    const ub = userBounties.find(u => u.bounty_id === bounty.id);
                    const progress = ub?.progress ?? 0;
                    const pct = Math.min((progress / bounty.requirement_value) * 100, 100);
                    const completed = ub?.completed ?? false;
                    const claimed = ub?.claimed ?? false;
                    return (
                      <div key={bounty.id} className="rounded-[20px] p-4 relative overflow-hidden transition-all duration-200 hover:scale-[1.02]"
                        style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.10), rgba(255,215,0,0.03))", border: completed && !claimed ? "1px solid rgba(255,215,0,0.35)" : "1px solid rgba(255,215,0,0.18)", boxShadow: completed && !claimed ? "0 0 16px rgba(255,215,0,0.12)" : "none" }}>
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #FFD700, transparent)" }} />
                        <p className="font-semibold text-cream text-sm">{bounty.title}</p>
                        <p className="text-cream/60 text-[11px] mt-0.5 leading-relaxed">{bounty.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-gold text-[10px] font-bold">+{bounty.coin_reward} <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain inline" /></span>
                          <span className="text-electric text-[10px] font-bold">+{bounty.xp_reward} XP</span>
                        </div>
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-cream/55 text-[10px]">{progress}/{bounty.requirement_value}</span>
                            {claimed && <span className="text-gold text-[10px] font-bold">Claimed</span>}
                          </div>
                          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                            <div className={`h-full rounded-full transition-all duration-700 ${pct > 0 && pct < 100 && !claimed ? "progress-shimmer" : ""}`} style={{ width: `${pct}%`, background: claimed ? "rgba(255,215,0,0.3)" : "linear-gradient(90deg, #FFD700, #FFA500)" }} />
                          </div>
                        </div>
                        {completed && !claimed && (
                          <button onClick={() => claimBounty(bounty.id)} className="mt-3 w-full py-2 rounded-full text-xs font-bold text-navy transition-all duration-200 active:scale-95 breathe-glow"
                            style={{ background: "linear-gradient(90deg, #FFD700, #FFA500)", boxShadow: "0 0 16px rgba(255,215,0,0.3)" }}>
                            Claim Reward
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Weekly Bounties */}
            {bounties.filter(b => b.type === "weekly").length > 0 && (
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-[#9B59B6] text-xs font-semibold">WEEKLY</span>
                  <span className="text-cream/55 text-[10px]">Resets every Monday</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {bounties.filter(b => b.type === "weekly").slice(0, 6).map((bounty) => {
                    const ub = userBounties.find(u => u.bounty_id === bounty.id);
                    const progress = ub?.progress ?? 0;
                    const pct = Math.min((progress / bounty.requirement_value) * 100, 100);
                    const completed = ub?.completed ?? false;
                    const claimed = ub?.claimed ?? false;
                    return (
                      <div key={bounty.id} className="rounded-[20px] p-4 relative overflow-hidden transition-all duration-200 hover:scale-[1.02]"
                        style={{ background: "linear-gradient(135deg, rgba(155,89,182,0.10), rgba(155,89,182,0.03))", border: completed && !claimed ? "1px solid rgba(155,89,182,0.35)" : "1px solid rgba(155,89,182,0.20)", boxShadow: completed && !claimed ? "0 0 16px rgba(155,89,182,0.12)" : "none" }}>
                        <div className="absolute top-0 left-0 right-0 h-[2px]" style={{ background: "linear-gradient(90deg, #9B59B6, transparent)" }} />
                        <p className="font-semibold text-cream text-sm">{bounty.title}</p>
                        <p className="text-cream/60 text-[11px] mt-0.5 leading-relaxed">{bounty.description}</p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="text-gold text-[10px] font-bold">+{bounty.coin_reward} <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain inline" /></span>
                          <span className="text-electric text-[10px] font-bold">+{bounty.xp_reward} XP</span>
                        </div>
                        <div className="mt-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-cream/55 text-[10px]">{progress}/{bounty.requirement_value}</span>
                            {claimed && <span className="text-[#9B59B6] text-[10px] font-bold">Claimed</span>}
                          </div>
                          <div className="w-full h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                            <div className={`h-full rounded-full transition-all duration-700 ${pct > 0 && pct < 100 && !claimed ? "progress-shimmer" : ""}`} style={{ width: `${pct}%`, background: claimed ? "rgba(155,89,182,0.3)" : "linear-gradient(90deg, #9B59B6, #8E44AD)" }} />
                          </div>
                        </div>
                        {completed && !claimed && (
                          <button onClick={() => claimBounty(bounty.id)} className="mt-3 w-full py-2 rounded-full text-xs font-bold text-white transition-all duration-200 active:scale-95 breathe-glow"
                            style={{ background: "linear-gradient(90deg, #9B59B6, #8E44AD)" }}>
                            Claim Reward
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {bounties.length === 0 && bountiesLoading && (
              /* Bounties still in flight — pulse bounty-card silhouettes, never
                 a flash of the empty state on cold load. */
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[0, 1].map(i => (
                  <div key={i} className="rounded-[20px] p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                    <div className="h-3 w-28 rounded bg-white/5 mb-2" />
                    <div className="h-2 w-40 rounded bg-white/[0.03] mb-4" />
                    <div className="h-2.5 w-20 rounded bg-white/[0.03] mb-3" />
                    <div className="h-1.5 w-full rounded-full bg-white/[0.04]" />
                  </div>
                ))}
              </div>
            )}

            {bounties.length === 0 && !bountiesLoading && (
              <div className="rounded-[20px] p-6 text-center" style={{ background: "linear-gradient(135deg, rgba(13,21,40,0.5), rgba(10,16,32,0.5))", border: "1px solid rgba(255,215,0,0.06)" }}>
                <Target size={32} weight="regular" color="rgba(238,244,255,0.4)" className="mx-auto mb-2" aria-hidden="true" />
                <p className="text-cream/55 text-xs mb-3">No bounties available right now. Fresh ones drop every day.</p>
                <Link href="/quiz" className="inline-block font-syne font-semibold text-[11px] px-4 py-2 rounded-full border border-gold/30 text-gold hover:bg-gold/10 transition-all">
                  Earn Fangs with a quiz
                </Link>
              </div>
            )}
          </div>

          {/* ═══ 6) Two-Column Lower ═══ */}
          <div className="grid lg:grid-cols-3 gap-6">

            {/* Left: Subjects as cards */}
            <div className="lg:col-span-2 animate-slide-up" style={{ animationDelay: "0.2s" }}>
              <Link href="/learn" className="flex items-baseline justify-between mb-3 group">
                <h2 className="font-bebas text-xl text-cream tracking-wider">YOUR SUBJECTS</h2>
                <span className="text-cream/55 text-[10px] font-mono uppercase tracking-[0.2em] group-hover:text-electric transition-colors">Learn &rarr;</span>
              </Link>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {displaySubjects.slice(0, 6).map((stat, i) => {
                  const accuracy = stat.questionsAnswered > 0 ? Math.round((stat.correctAnswers / stat.questionsAnswered) * 100) : 0;
                  const SubjectIcon = SUBJECT_ICONS[stat.subject] ?? DefaultSubjectIcon;
                  const color = SUBJECT_COLORS[stat.subject as keyof typeof SUBJECT_COLORS] ?? "#4A90D9";
                  return (
                    <Link key={stat.subject} href="/learn">
                      <div className={`tilt-card subject-tilt group p-4 ${cardShapes[i % cardShapes.length]}`}
                        style={{ background: `linear-gradient(135deg, ${color}08 0%, #080E1A 100%)`, border: `1px solid ${color}15` }}>
                        {/* Top accent */}
                        <div className="absolute top-0 left-0 right-0 h-[2px] opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                          style={{ background: `linear-gradient(90deg, ${color}, transparent)` }} />

                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0"
                            style={{ background: `${color}12`, border: `1px solid ${color}20` }}>
                            <SubjectIcon size={20} weight="regular" color={color} aria-hidden="true" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-cream text-sm">{stat.subject}</span>
                              <span className="text-xs font-mono" style={{ color }}>{accuracy}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-white/[0.06] rounded-full overflow-hidden">
                              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${accuracy}%`, background: `linear-gradient(90deg, ${color}80, ${color})` }} />
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center justify-between mt-3">
                          <span className="text-cream/25 text-[10px]">{stat.questionsAnswered} answered</span>
                          {bestScores[stat.subject] ? (
                            <span className="text-[10px] font-semibold" style={{ color }}>Best: {bestScores[stat.subject].best}/{bestScores[stat.subject].total}</span>
                          ) : (
                            <span className="text-cream/55 text-[10px]">No attempts yet</span>
                          )}
                        </div>
                      </div>
                    </Link>
                  );
                })}
                {displaySubjects.length === 0 && subjectsLoading && (
                  /* Subjects still in flight — compact pulse cards, never a void */
                  <>
                    {[0, 1].map(i => (
                      <div key={i} className="rounded-[24px] p-4 animate-pulse" style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.04)" }}>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-white/5 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            <div className="h-3 w-24 rounded bg-white/5 mb-2" />
                            <div className="h-1.5 w-full rounded-full bg-white/[0.03]" />
                          </div>
                        </div>
                        <div className="h-2.5 w-20 rounded bg-white/[0.03] mt-3" />
                      </div>
                    ))}
                  </>
                )}
                {displaySubjects.length === 0 && !subjectsLoading && (
                  /* Resolved-but-empty — intentional first-quiz invite */
                  <div className="sm:col-span-2 rounded-[20px] p-8 text-center"
                    style={{ background: "linear-gradient(135deg, rgba(13,21,40,0.5) 0%, rgba(10,16,32,0.5) 100%)", border: "1px solid rgba(155,89,182,0.12)" }}>
                    <BookOpen size={32} weight="regular" color="#9B59B6" className="mx-auto mb-3" aria-hidden="true" />
                    <p className="font-bebas text-lg text-cream/80 tracking-wider">Your subjects live here</p>
                    <p className="text-cream/40 text-xs mt-1 mb-4 leading-relaxed">Take one quiz and Lionade starts tracking your accuracy and best scores in every subject you touch.</p>
                    <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-5 py-2.5 rounded-full text-navy transition-all duration-200 active:scale-95"
                      style={{ background: "linear-gradient(90deg, #FFD700, #FFA500)", boxShadow: "0 0 16px rgba(255,215,0,0.25)" }}>
                      Start your first quiz
                    </Link>
                  </div>
                )}
              </div>

              {/* ═══ 7-Day Activity Chart — sits below YOUR SUBJECTS, fills the column next to Achievements ═══ */}
              <FluidReveal className="mt-6">
                <div className="flex items-baseline justify-between mb-4">
                  <h2 className="font-bebas text-xl text-cream tracking-wider">WEEKLY ACTIVITY</h2>
                  <div className="flex items-center gap-4 text-[10px]">
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#4A90D9" }} /> Questions</span>
                    <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: "#22C55E" }} /> Correct</span>
                  </div>
                </div>
                <div className="rounded-2xl p-5 sm:p-6 relative overflow-hidden"
                  style={{
                    background: "linear-gradient(160deg, rgba(74,144,217,0.06) 0%, rgba(10,16,32,0.95) 30%, rgba(8,14,26,1) 100%)",
                    border: "1px solid rgba(74,144,217,0.1)",
                  }}>
                  {/* Subtle grid lines */}
                  <div className="absolute inset-0 pointer-events-none" style={{ opacity: 0.04 }}>
                    {[25, 50, 75].map(pct => (
                      <div key={pct} className="absolute left-0 right-0 border-t border-white" style={{ bottom: `${pct}%` }} />
                    ))}
                  </div>

                  {(() => {
                    const maxQ = Math.max(...weeklyChart.map(d => d.questions), 1);
                    const totalWeek = weeklyChart.reduce((s, d) => s + d.questions, 0);
                    const totalCorrect = weeklyChart.reduce((s, d) => s + d.correct, 0);
                    const totalCoins = weeklyChart.reduce((s, d) => s + d.coins, 0);

                    // Resolved week with zero activity (DB zero-fills all 7 days):
                    // swap the zero-monument chart + punitive "0% accuracy" row for
                    // an intentional invite. While the fetch is in flight
                    // (weeklyChartData === undefined) keep the existing frame so we
                    // never flash the empty state over cached data.
                    if (weeklyChartData !== undefined && totalWeek === 0) {
                      return (
                        <div className="relative z-10 flex flex-col items-center justify-center text-center" style={{ minHeight: 240 }}>
                          <Target size={32} weight="regular" color="rgba(74,144,217,0.6)" className="mb-3" aria-hidden="true" />
                          <p className="font-bebas text-lg text-cream/80 tracking-wider">A quiet week so far</p>
                          <p className="text-cream/40 text-xs mt-1 mb-4 leading-relaxed max-w-xs">One quiz puts your first bars on this chart and Fangs in your wallet.</p>
                          <Link href="/quiz" className="inline-block font-syne font-bold text-xs px-5 py-2.5 rounded-full text-navy transition-all duration-200 active:scale-95"
                            style={{ background: "linear-gradient(90deg, #FFD700, #FFA500)", boxShadow: "0 0 16px rgba(255,215,0,0.25)" }}>
                            Take today&apos;s quiz
                          </Link>
                        </div>
                      );
                    }

                    return (
                      <>
                        {/* Bar chart — taller than v0 since we now own the empty space */}
                        <div className="flex items-end justify-between gap-2 sm:gap-3 relative z-10" style={{ height: 240 }}>
                          {weeklyChart.map((d, i) => {
                            const isToday = i === weeklyChart.length - 1;
                            const qHeight = (d.questions / maxQ) * 100;
                            const cHeight = (d.correct / maxQ) * 100;

                            return (
                              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                                {/* Tooltip on hover */}
                                <div className="absolute -top-16 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none z-20"
                                  style={{ minWidth: 110 }}>
                                  <div className="rounded-lg px-3 py-2 text-center"
                                    style={{ background: "rgba(10,16,32,0.95)", border: "1px solid rgba(74,144,217,0.3)", boxShadow: "0 4px 20px rgba(0,0,0,0.5)" }}>
                                    <p className="text-cream text-[10px] font-semibold">{d.date}</p>
                                    <p className="text-electric text-[9px]">{d.questions} questions · {d.correct} correct</p>
                                    {d.coins > 0 && <p className="text-gold text-[9px]">+{d.coins} Fangs</p>}
                                  </div>
                                </div>

                                {/* Bars container */}
                                <div className="w-full flex items-end justify-center gap-1.5" style={{ height: 200 }}>
                                  {/* Questions bar */}
                                  <div className="rounded-t-md transition-all duration-1000 ease-out relative overflow-hidden"
                                    style={{
                                      width: "42%",
                                      height: chartAnimated ? `${Math.max(qHeight, d.questions > 0 ? 8 : 0)}%` : "0%",
                                      background: "linear-gradient(180deg, #4A90D9 0%, #2D6BB5 100%)",
                                      boxShadow: d.questions > 0 ? "0 0 12px rgba(74,144,217,0.35)" : undefined,
                                      transitionDelay: `${i * 80}ms`,
                                    }}>
                                    <div className="absolute inset-0 opacity-20"
                                      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 50%)" }} />
                                  </div>
                                  {/* Correct bar */}
                                  <div className="rounded-t-md transition-all duration-1000 ease-out relative overflow-hidden"
                                    style={{
                                      width: "42%",
                                      height: chartAnimated ? `${Math.max(cHeight, d.correct > 0 ? 8 : 0)}%` : "0%",
                                      background: "linear-gradient(180deg, #22C55E 0%, #16A34A 100%)",
                                      boxShadow: d.correct > 0 ? "0 0 12px rgba(34,197,94,0.35)" : undefined,
                                      transitionDelay: `${i * 80 + 100}ms`,
                                    }}>
                                    <div className="absolute inset-0 opacity-20"
                                      style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.3) 0%, transparent 50%)" }} />
                                  </div>
                                </div>

                                {/* Day label */}
                                <span className={`text-[11px] font-bebas tracking-wider mt-1 ${isToday ? "text-electric" : "text-cream/35"}`}>
                                  {isToday ? "Today" : d.day}
                                </span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Summary stats below chart */}
                        <div className="flex items-center justify-between mt-5 pt-4 border-t border-white/[0.04]">
                          <div className="flex items-center gap-5 sm:gap-7">
                            <div>
                              <span className="font-bebas text-2xl text-electric tabular-nums">{totalWeek}</span>
                              <span className="text-cream/55 text-[10px] ml-1.5 uppercase tracking-wider">questions</span>
                            </div>
                            <div>
                              <span className="font-bebas text-2xl text-green-400 tabular-nums">{totalWeek > 0 ? Math.round((totalCorrect / totalWeek) * 100) : 0}%</span>
                              <span className="text-cream/55 text-[10px] ml-1.5 uppercase tracking-wider">accuracy</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                            <span className="font-bebas text-2xl text-gold tabular-nums">{totalCoins}</span>
                            <span className="text-cream/55 text-[10px] ml-0.5 uppercase tracking-wider">earned</span>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </FluidReveal>

            </div>

            {/* Right sidebar */}
            <div className="space-y-5">

              {/* This Week — Leaderboard */}
              <div className="animate-slide-up" style={{ animationDelay: "0.18s" }}>
                <Link href="/leaderboard" className="flex items-baseline justify-between mb-3 group">
                  <h2 className="font-bebas text-xl text-cream tracking-wider">THIS WEEK</h2>
                  <span className="text-cream/55 text-[10px] font-mono uppercase tracking-[0.2em] group-hover:text-electric transition-colors">View All &rarr;</span>
                </Link>
                <Link href="/leaderboard" className="block rounded-[20px] p-4 space-y-2 dash-lift"
                  style={{ background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)", border: "1px solid rgba(74,144,217,0.08)" }}>
                  {leaderboard.length > 0 ? (
                    <>
                      {leaderboard.slice(0, 3).map((entry) => {
                        const medalColor = entry.rank === 1 ? "#FFD700" : entry.rank === 2 ? "#C0C0C0" : "#CD7F32";
                        const isMe = entry.user_id === user.id;
                        return (
                          <div key={entry.user_id} className={`flex items-center gap-2.5 py-1.5 px-2 rounded-lg ${isMe ? "bg-electric/8" : ""}`}>
                            {entry.rank === 1
                              ? <Crown size={16} weight="fill" color={medalColor} aria-hidden="true" />
                              : <Medal size={16} weight="fill" color={medalColor} aria-hidden="true" />}
                            <span className={`text-xs flex-1 truncate ${isMe ? "text-electric font-semibold" : "text-cream/60"}`}>
                              {entry.username}{isMe ? " (you)" : ""}
                            </span>
                            <span className="text-[10px] font-mono text-gold">{formatCoins(entry.coins_this_week)}</span>
                          </div>
                        );
                      })}
                      {(() => {
                        const myRank = leaderboard.find(e => e.user_id === user.id);
                        if (myRank && myRank.rank > 3) {
                          return (
                            <div className="flex items-center gap-2.5 py-1.5 px-2 rounded-lg bg-electric/8 mt-1 border-t border-white/[0.04]">
                              <span className="text-cream/60 text-[10px] font-mono w-5 text-center">#{myRank.rank}</span>
                              <span className="text-xs flex-1 text-electric font-semibold truncate">{myRank.username} (you)</span>
                              <span className="text-[10px] font-mono text-gold">{formatCoins(myRank.coins_this_week)}</span>
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-cream/55 text-xs mb-2">No activity this week yet.</p>
                      <span className="inline-block font-syne font-semibold text-[11px] px-3 py-1.5 rounded-full border border-gold/30 text-gold/85 bg-gold/5">
                        Climb the board
                      </span>
                    </div>
                  )}
                </Link>
              </div>

              {/* Recent Activity */}
              <div className="animate-slide-up" style={{ animationDelay: "0.22s" }}>
                <Link href="/quiz" className="flex items-baseline justify-between mb-3 group">
                  <h2 className="font-bebas text-xl text-cream tracking-wider">RECENT ACTIVITY</h2>
                  <span className="text-cream/55 text-[10px] font-mono uppercase tracking-[0.2em] group-hover:text-electric transition-colors">Quiz &rarr;</span>
                </Link>
                {recentQuizzes.length > 0 ? (
                  <div className="space-y-1">
                    {recentQuizzes.map((quiz, i) => {
                      const RecentIcon = SUBJECT_ICONS[quiz.subject] ?? DefaultSubjectIcon;
                      const recentColor = SUBJECT_COLORS[quiz.subject as keyof typeof SUBJECT_COLORS] ?? "#4A90D9";
                      return (
                      <Link key={quiz.id} href="/quiz" className={`flex items-center gap-3 py-2.5 px-3 dash-lift hover:bg-white/[0.03] cursor-pointer ${
                        i % 2 === 0 ? "rounded-[16px]" : "rounded-tl-[20px] rounded-br-[20px] rounded-tr-[6px] rounded-bl-[6px]"
                      }`}>
                        <div className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0"
                          style={{ background: `${recentColor}14`, border: `1px solid ${recentColor}25` }}>
                          <RecentIcon size={16} weight="regular" color={recentColor} aria-hidden="true" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-cream text-xs font-semibold truncate">{quiz.subject}</p>
                          <p className="text-cream/40 text-[10px] font-mono tracking-wider">{timeAgo(quiz.completed_at)}</p>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs font-mono text-cream/60">{quiz.correct_answers}/{quiz.total_questions}</span>
                          <span className="text-xs font-bold text-gold">+{quiz.coins_earned}</span>
                        </div>
                      </Link>
                      );
                    })}
                  </div>
                ) : (
                  <div className="rounded-[20px] p-6 text-center"
                    style={{ background: "linear-gradient(135deg, rgba(13,21,40,0.5) 0%, rgba(10,16,32,0.5) 100%)", border: "1px solid rgba(74,144,217,0.06)" }}>
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-8 h-8 object-contain mx-auto mb-2" />
                    <p className="font-bebas text-base text-cream/50 tracking-wider">No activity yet</p>
                    <p className="text-cream/25 text-xs mt-1 mb-4 leading-relaxed">Take your first quiz to start tracking progress.</p>
                    <Link href="/quiz" className="inline-block font-syne font-semibold text-xs px-4 py-2 rounded-full transition-all duration-200 active:scale-95 border border-electric/30 text-electric hover:bg-electric/10">
                      Start Quiz
                    </Link>
                  </div>
                )}
              </div>

              {/* Achievements */}
              <div className="animate-slide-up" style={{ animationDelay: "0.24s" }}>
                <Link href="/profile" className="flex items-baseline justify-between mb-3 group">
                  <h2 className="font-bebas text-xl text-cream tracking-wider">ACHIEVEMENTS <span className="text-cream/30 text-xs font-mono ml-1">{achievements.length}/8</span></h2>
                  <span className="text-cream/55 text-[10px] font-mono uppercase tracking-[0.2em] group-hover:text-electric transition-colors">Profile &rarr;</span>
                </Link>
                <div className="grid grid-cols-4 gap-2">
                  {([
                    { key: "first_quiz",    illustration: "ach-first-steps",     name: "First Steps" },
                    { key: "perfect_score", illustration: "ach-perfectionist",   name: "Perfectionist" },
                    { key: "streak_3",      illustration: "ach-on-fire",         name: "On Fire" },
                    { key: "streak_7",      illustration: "ach-dedicated",       name: "Dedicated" },
                    { key: "coins_100",     illustration: "ach-coin-collector",  name: "Coin Collector" },
                    { key: "coins_500",     illustration: "ach-big-saver",       name: "Big Saver" },
                    { key: "quizzes_10",    illustration: "ach-quiz-master",     name: "Quiz Master" },
                    { key: "quizzes_50",    illustration: "ach-scholar",         name: "Scholar" },
                  ] as { key: string; illustration: string; name: string }[]).map((ach) => {
                    const unlocked = achievements.some(a => a.achievement_key === ach.key);
                    return (
                      <div
                        key={ach.key}
                        className={`flex flex-col items-center p-2 rounded-xl ${unlocked ? "achievement-tile-unlocked" : "transition-all duration-200"}`}
                        style={{
                          background: unlocked ? "rgba(255,215,0,0.06)" : "rgba(255,255,255,0.02)",
                          border: unlocked ? "1px solid rgba(255,215,0,0.15)" : "1px solid rgba(255,255,255,0.04)",
                          boxShadow: unlocked ? "0 0 12px rgba(255,215,0,0.1)" : "none",
                        }}
                      >
                        {unlocked ? (
                          <img
                            src={`/illustrations/${ach.illustration}.png`}
                            alt=""
                            width={40}
                            height={40}
                            className="w-10 h-10 object-contain"
                            aria-hidden="true"
                          />
                        ) : (
                          <Lock
                            size={22}
                            weight="regular"
                            color="rgba(238,244,255,0.25)"
                            aria-hidden="true"
                            className="mx-auto my-2"
                          />
                        )}
                        <span className={`text-[8px] mt-1 text-center leading-tight ${unlocked ? "text-cream/60" : "text-cream/55"}`}>{ach.name}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Ninny's Notes — computed from real stats, no mock copy.
                  Generates up to 3 facts ranked by usefulness; falls back to
                  a welcome message for new users. */}
              {(() => {
                const notes: { text: string; weakSubject?: string }[] = [];

                // Find best + weakest subjects by accuracy (require ≥ 5 answers so noise doesn't dominate)
                const ranked = subjectStats
                  .filter(s => s.questionsAnswered >= 5)
                  .map(s => ({
                    subject: s.subject,
                    accuracy: Math.round((s.correctAnswers / s.questionsAnswered) * 100),
                    answered: s.questionsAnswered,
                  }))
                  .sort((a, b) => b.accuracy - a.accuracy);

                if (ranked.length >= 2) {
                  const best = ranked[0];
                  const worst = ranked[ranked.length - 1];
                  if (best.accuracy >= 70) {
                    notes.push({ text: `${best.subject} is your strongest, ${best.accuracy}% accuracy. Stack Fangs while you're hot.` });
                  }
                  if (worst.accuracy < 60 && worst.subject !== best.subject) {
                    notes.push({ text: `${worst.subject} accuracy is ${worst.accuracy}%. A quick round could move that fast.`, weakSubject: worst.subject });
                  }
                }

                // Weekly trend: today vs 3-day average
                if (weeklyChart.length >= 4) {
                  const today = weeklyChart[weeklyChart.length - 1];
                  const prev3 = weeklyChart.slice(-4, -1);
                  const prev3Avg = prev3.reduce((s, d) => s + d.questions, 0) / prev3.length;
                  if (today.questions === 0 && prev3Avg > 0) {
                    notes.push({ text: `You haven't studied yet today. A 10-question round keeps the streak safe.` });
                  } else if (today.questions > prev3Avg * 1.5 && today.questions >= 5) {
                    notes.push({ text: `${today.questions} questions today, above your usual pace. Nice gear.` });
                  }
                }

                // Streak-aware nudge
                if (streak >= 7) {
                  notes.push({ text: `${streak}-day streak. Don't break it now.` });
                } else if (streak === 0 && subjectStats.length > 0) {
                  notes.push({ text: `No active streak. One quiz today starts a new one.` });
                }

                // Fallback for empty/new users
                if (notes.length === 0) {
                  notes.push({ text: subjectStats.length === 0
                    ? `Take your first quiz. Ninny will start spotting patterns after a few rounds.`
                    : `Keep answering. Ninny needs a bit more data to spot patterns.`
                  });
                }

                const topNotes = notes.slice(0, 3);
                const weakSubject = topNotes.find(n => n.weakSubject)?.weakSubject;

                return (
                  <div className="animate-slide-up" style={{ animationDelay: "0.26s" }}>
                    <h2 className="font-bebas text-xl text-cream tracking-wider mb-3">NINNY&apos;S NOTES</h2>
                    <div className="rounded-tl-[24px] rounded-br-[24px] rounded-tr-[8px] rounded-bl-[8px] p-4 idle-glow-ninny"
                      style={{ background: "linear-gradient(135deg, #0d1528 0%, #0a1020 100%)", border: "1px solid rgba(74,144,217,0.08)" }}>
                      <div className="space-y-2.5 mb-4">
                        {topNotes.map((note, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-electric text-[10px] mt-0.5 flex-shrink-0">&#x25CF;</span>
                            <p className="text-cream/50 text-xs leading-relaxed">{note.text}</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Link
                          href={weakSubject ? `/quiz?subject=${encodeURIComponent(weakSubject)}` : "/learn"}
                          className="text-[11px] font-semibold py-1.5 px-3 rounded-full border border-electric/20 text-electric/60 bg-electric/5 hover:bg-electric/10 transition-colors"
                        >
                          {weakSubject ? `Drill ${weakSubject}` : "Pick a Subject"}
                        </Link>
                        <Link href="/learn" className="text-[11px] font-semibold py-1.5 px-3 rounded-full border border-electric/20 text-electric/60 bg-electric/5 hover:bg-electric/10 transition-colors">
                          Daily Quiz
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Your Classes — compact dashboard row.
// Renders chips for the user's first 4 active classes with their next exam
// countdown, plus a "+ new" tile. Hidden entirely if the user has no
// classes yet (no empty state — keeps the dashboard clean for new users
// who haven't onboarded into Class Notebook yet).
// ─────────────────────────────────────────────────────────────────────────────
function YourClassesRow() {
  const { data } = useSWR<{
    classes: Array<{
      id: string;
      name: string;
      shortCode: string | null;
      color: string;
      emoji: string | null;
      nextExamDate: string | null;
    }>;
  }>("/api/classes", swrFetcher, {
    keepPreviousData: true,
  });
  const classes = data?.classes ?? [];

  if (classes.length === 0) return null;

  const top = classes.slice(0, 4);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const daysFor = (d: string | null) => {
    if (!d) return null;
    const target = new Date(d + "T00:00:00");
    return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
  };

  return (
    <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.08s" }}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-bebas text-xl text-cream tracking-wider">YOUR CLASSES</h2>
        <a
          href="/classes"
          className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/60 hover:text-cream transition-colors"
        >
          All →
        </a>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        {top.map((c) => {
          const days = daysFor(c.nextExamDate);
          return (
            <a
              key={c.id}
              href={`/classes/${c.id}`}
              className="group relative rounded-[10px] border border-white/[0.06] bg-white/[0.02]
                hover:border-white/[0.15] hover:bg-white/[0.04] transition-all duration-200
                px-3 py-2.5 flex flex-col gap-0.5 overflow-hidden"
            >
              <span
                className="absolute top-0 left-0 right-0 h-[2px]"
                style={{ background: c.color }}
                aria-hidden="true"
              />
              <div className="flex items-center gap-1.5 min-w-0">
                {c.emoji && <span className="text-[14px] leading-none shrink-0">{c.emoji}</span>}
                <span className="font-syne font-semibold text-[13px] text-cream truncate">
                  {c.name}
                </span>
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-cream/45">
                {days === null
                  ? "no exam set"
                  : days < 0
                    ? "exam passed"
                    : days === 0
                      ? "exam today"
                      : `${days}d to exam`}
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}
