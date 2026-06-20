"use client";

import { useMemo } from "react";
import useSWR from "swr";
import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import { useAuth } from "@/lib/auth";
import { cdnUrl } from "@/lib/cdn";
import { apiGet } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { useEloLeaderboard } from "@/lib/hooks";
import {
  Medal,
  Diamond,
  DiamondsFour,
  Heart,
  Flame,
  Crown,
  Lightning,
  Clock,
  Brain,
  Sword,
  Target,
  Users,
  Trophy,
  CheckCircle,
  CurrencyDollar,
  Lock,
  Shield,
} from "@phosphor-icons/react";

/* ── Tier definitions (bottom → top) ──
   2026-06-09: tiers are placed by arena ELO, not win counts. `minElo`
   thresholds extend the duel-page getEloTier ladder (Bronze 0, then +200
   per tier from 1200) up through the four prestige tiers. Everyone starts
   at ELO 1000 → Bronze. */
const TIERS = [
  { name: "BRONZE", minElo: 0, color: "#CD7F32", range: "0–1199 Elo", tagline: "Freshman", Icon: Medal, iconColor: "#CD7F32", iconWeight: "regular" as const, image: cdnUrl("/bronze.png") },
  { name: "SILVER", minElo: 1200, color: "#C0C0C0", range: "1200–1399 Elo", tagline: "Scholar", Icon: Medal, iconColor: "#C0C0C0", iconWeight: "regular" as const, image: cdnUrl("/silver.png") },
  { name: "GOLD", minElo: 1400, color: "#FFD700", range: "1400–1599 Elo", tagline: "Honor Roll", Icon: Medal, iconColor: "#FFD700", iconWeight: "regular" as const, image: cdnUrl("/gold.png") },
  { name: "PLATINUM", minElo: 1600, color: "#00CED1", range: "1600–1799 Elo", tagline: "Dean's List", Icon: Diamond, iconColor: "#00CED1", iconWeight: "regular" as const, image: cdnUrl("/platinum.png") },
  { name: "DIAMOND", minElo: 1800, color: "#B9F2FF", range: "1800–1999 Elo", tagline: "Valedictorian", Icon: DiamondsFour, iconColor: "#B9F2FF", iconWeight: "regular" as const, image: cdnUrl("/diamond.png") },
  { name: "ONYX", minElo: 2000, color: "#1A1A2E", textColor: "#C0C0D0", glowColor: "#C0C0D0", range: "2000–2199 Elo", tagline: "Prodigy", Icon: Heart, iconColor: "#1A1A2E", iconWeight: "fill" as const, image: cdnUrl("/onix.png") },
  { name: "RUBY", minElo: 2200, color: "#E0115F", range: "2200–2399 Elo", tagline: "Olympiad", Icon: Flame, iconColor: "#E0115F", iconWeight: "fill" as const, image: cdnUrl("/ruby.png") },
  { name: "EMERALD", minElo: 2400, color: "#50C878", range: "2400–2599 Elo", tagline: "Mastermind", Icon: Crown, iconColor: "#50C878", iconWeight: "fill" as const, image: cdnUrl("/emerald.png") },
  { name: "LEGEND", minElo: 2600, color: "#FFD700", range: "2600+ Elo", tagline: "Immortal", Icon: Lightning, iconColor: "#FFD700", iconWeight: "fill" as const, image: cdnUrl("/legend.png") },
];

const TIER_WIDTHS = ["40%", "48%", "54%", "60%", "68%", "76%", "84%", "92%", "100%"];

export default function CompetePage() {
  const { user } = useAuth();
  const DISPLAY_NAME = user?.username || "Player";
  const tiersTopDown = [...TIERS].reverse();
  const widthsTopDown = [...TIER_WIDTHS];

  // Load real ELO leaderboard
  // 2026-05-25 (Phase A perf): raw fetch in useEffect → shared SWR hook so
  // the compete page no longer re-fetches on every mount. Hook already lives
  // in lib/hooks.ts with a 30s dedupe.
  const { data: topPlayersData } = useEloLeaderboard(5);
  const topPlayers: { rank: number; username: string; arena_elo: number }[] = topPlayersData ?? [];
  // Distinguish "still loading" (undefined) from "resolved, no ranked players"
  // ([]). Drives the leaderboard-preview skeleton vs the genuine empty state,
  // so we never flash a fake "rank #1 · 0 Elo" placeholder row.
  const leaderboardLoading = topPlayersData === undefined;

  // 2026-06-09 (bug fix): the hex stats + tier pyramid were hardcoded
  // (everyone rendered as LEGEND with fake "Unranked / 0 wins" hexes).
  // Wire them to the caller's real arena data instead:
  //   - /api/me/elo-rank → { elo, rank, totalRanked } (rank = strictly-ahead count + 1)
  //   - profiles.arena_wins/losses/draws → win count + games played
  //     (same direct profile select the duel page uses; these arena fields
  //      aren't on the shared useUserStats hook)
  const { data: eloRankData } = useSWR(
    user?.id ? `compete-elo-rank/${user.id}` : null,
    async () => {
      const r = await apiGet<{ elo: number | null; rank: number | null; totalRanked: number }>("/api/me/elo-rank");
      // THROW on failure (don't resolve null): a resolved-null would flip
      // `recordLoading` off and confidently render "Unranked" to a ranked
      // user. Throwing keeps `data` undefined → the "—" placeholders stay.
      // Global swr-config has shouldRetryOnError: false, so this surfaces
      // once; a later focus/mount revalidation can still recover.
      if (!r.ok || !r.data) throw new Error(r.error || "elo-rank fetch failed");
      return r.data;
    },
    { keepPreviousData: true, revalidateOnFocus: true }
  );

  const { data: arenaRecord } = useSWR(
    user?.id ? `compete-arena-record/${user.id}` : null,
    async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("arena_wins, arena_losses, arena_draws")
        .eq("id", user!.id)
        .single();
      // THROW on failure (don't default to zeros): zeros here would render
      // "0 wins / 0 played" to a player with a real record. Keeping `data`
      // undefined leaves recordLoading true → honest "—" placeholders.
      if (error || !data) throw new Error(error?.message || "arena record fetch failed");
      return {
        wins: data.arena_wins ?? 0,
        losses: data.arena_losses ?? 0,
        draws: data.arena_draws ?? 0,
      };
    },
    { keepPreviousData: true, revalidateOnFocus: true }
  );

  const myElo: number | null = eloRankData?.elo ?? null;
  const myRank: number | null = eloRankData?.rank ?? null;
  const totalRanked: number = eloRankData?.totalRanked ?? 0;
  const wins: number | null = arenaRecord ? arenaRecord.wins : null;
  const gamesPlayed: number | null = arenaRecord
    ? arenaRecord.wins + arenaRecord.losses + arenaRecord.draws
    : null;

  // null while ELO is loading → pyramid shows Bronze unlocked with NO "YOU"
  // badge (no flash of a wrong tier). A brand-new user (ELO 1000) lands on
  // Bronze with everything above locked.
  const currentTierIndex = useMemo(() => {
    if (myElo === null) return null;
    let idx = 0;
    for (let i = 0; i < TIERS.length; i++) {
      if (myElo >= TIERS[i].minElo) idx = i;
    }
    return idx;
  }, [myElo]);
  const effectiveTierIndex = currentTierIndex ?? 0;

  // "Ranked" = has actually played at least one arena match. Everyone has a
  // default arena_elo of 1000, so the rank number alone isn't enough.
  const recordLoading = eloRankData === undefined || arenaRecord === undefined;
  const isRanked = !recordLoading && myRank !== null && (gamesPlayed ?? 0) > 0;

  // Hex stats — real data only. "Win Streak" was removed: it isn't tracked
  // anywhere in the schema, so showing it would be fake UI.
  const hexStats = [
    {
      label: "Your Rank",
      value: recordLoading ? "—" : isRanked ? `#${myRank}` : "Unranked",
      color: "#FFD700",
      achieved: isRanked,
    },
    {
      label: "Wins",
      value: wins === null ? "—" : wins.toLocaleString(),
      color: "#22C55E",
      achieved: (wins ?? 0) > 0,
    },
    {
      label: "Goal",
      value: "Top 10%",
      color: "#4A90D9",
      achieved: isRanked && totalRanked > 0 && (myRank ?? Infinity) / totalRanked <= 0.1,
    },
  ];

  // Placement progress under the rank hex: real career match count, shown
  // until 5 matches are played. Hidden while loading (no fake "0 / 5").
  const placementGames = gamesPlayed === null ? null : Math.min(gamesPlayed, 5);
  const showPlacement = placementGames !== null && placementGames < 5;

  return (
    <ProtectedRoute>
      <FeatureGate feature="compete">
      <div
        data-force-dark
        className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden"
        style={{ isolation: "isolate" }}
      >
        {/* Extra ambient glow orbs */}
        <div className="absolute top-[15%] left-[20%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }} />
        <div className="absolute bottom-[20%] right-[15%] w-[400px] h-[400px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #00BFFF 0%, transparent 70%)" }} />
        <div className="absolute top-[60%] left-[50%] w-[600px] h-[600px] -translate-x-1/2 rounded-full pointer-events-none opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

          {/* ═══ 1. COMPETITIVE BANNER ═══
              Was a 14-line "MONTHLY COIN POOL · Coming Soon · Launching V2"
              placeholder that took the entire above-the-fold. Replaced with
              a single honest strip that says what IS shipping (Elo ladder
              + Fang multipliers per tier) plus a CTA to the leaderboard.
              The full prize-pool feature still lives in the roadmap — this
              just stops the page from leading with vapor. */}
          <div className="animate-slide-up mb-8" style={{ animationDelay: "0s" }}>
            <div className="relative overflow-hidden rounded-xl px-5 sm:px-7 py-4 sm:py-5 flex items-center gap-4 flex-wrap"
              style={{
                background: "linear-gradient(90deg, rgba(255,215,0,0.06) 0%, rgba(12,10,20,0.6) 60%)",
                border: "1px solid rgba(255,215,0,0.18)",
                boxShadow: "0 0 32px rgba(255,215,0,0.04)",
              }}>
              {/* Inline coin glyph — smaller than the full hero coin */}
              <div className="inline-flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-full shrink-0"
                style={{
                  background: "linear-gradient(145deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
                  boxShadow: "0 2px 10px rgba(255,215,0,0.25), inset 0 1px 2px rgba(255,255,255,0.3)",
                }}>
                <span className="font-bebas text-base sm:text-lg text-[#3a2800]" style={{ textShadow: "0 1px 0 rgba(255,255,255,0.3)" }}>$</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bebas text-base sm:text-lg text-cream/85 tracking-[0.16em] leading-none">
                  WEEKLY COMPETITIVE
                </p>
                <p className="text-cream/55 text-xs sm:text-[13px] font-syne mt-1 leading-snug">
                  Climb the Elo ladder. Fang multipliers per tier. Gold pays out the most. Live now.
                </p>
              </div>
              <Link
                href="/leaderboard"
                className="font-mono text-[10px] sm:text-[11px] uppercase tracking-[0.22em] text-gold/85 hover:text-gold transition-colors inline-flex items-center gap-1 shrink-0"
              >
                Leaderboard
                <span aria-hidden="true">→</span>
              </Link>
            </div>
          </div>

          {/* ═══ 2. HEXAGONAL STATS BAR ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.05s" }}>
            {/* Desktop: horizontal row with energy lines */}
            <div className="hidden sm:flex justify-center items-center gap-0">
              {hexStats.map((stat, i) => (
                <div key={stat.label} className="flex items-center">
                  {i > 0 && (
                    <div className={`energy-line ${stat.achieved ? "energy-line-active" : "energy-line-dim"}`} />
                  )}
                  <div className="flex flex-col items-center">
                    <div
                      className={`hex-clip ${i === 0 ? "w-28 h-28" : "w-24 h-24"} flex flex-col items-center justify-center transition-all duration-300
                        ${stat.achieved
                          ? "border-2"
                          : "border border-gray-700/40"
                        } ${i === 0 && !stat.achieved ? "hex-pulse" : ""}`}
                      style={{
                        background: stat.achieved
                          ? `linear-gradient(135deg, ${stat.color}25 0%, #04080F 70%)`
                          : "linear-gradient(135deg, #12121f 0%, #0a0a14 70%)",
                        borderColor: stat.achieved ? `${stat.color}50` : undefined,
                      }}
                    >
                      <p className={`font-bebas ${i === 0 ? "text-xl" : "text-2xl"} leading-none ${stat.achieved ? "" : "text-gray-600"}`}
                        style={stat.achieved ? { color: stat.color } : undefined}>
                        {stat.value}
                      </p>
                      <p className={`text-[8px] font-bold uppercase tracking-widest mt-1 ${stat.achieved ? "text-cream/60" : "text-gray-700"}`}>
                        {stat.label}
                      </p>
                    </div>
                    {i === 0 && showPlacement && (
                      <div className="mt-2 w-20">
                        {!isRanked && (
                          <div className="font-bebas text-[9px] tracking-widest text-center mb-0.5"
                            style={{ color: TIERS[effectiveTierIndex].color }}>
                            {TIERS[effectiveTierIndex].name}
                          </div>
                        )}
                        <div className="text-[9px] text-cream/55 text-center mb-1">Play 5 matches</div>
                        <div className="h-1.5 rounded-full bg-cream/[0.07] overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-gold/60 to-gold rounded-full motion-safe:transition-all motion-safe:duration-500"
                            style={{ width: `${(placementGames! / 5) * 100}%` }} />
                        </div>
                        <div className="text-[9px] text-cream/55 text-center mt-0.5">{placementGames} / 5</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile: centered wrap (3 stats) */}
            <div className="flex flex-wrap justify-center gap-4 sm:hidden">
              {hexStats.map((stat, i) => (
                <div key={stat.label} className="flex flex-col items-center">
                  <div
                    className={`hex-clip ${i === 0 ? "w-24 h-24" : "w-20 h-20"} flex flex-col items-center justify-center
                      ${stat.achieved ? "border" : "border border-gray-700/30"} ${i === 0 && !stat.achieved ? "hex-pulse" : ""}`}
                    style={{
                      background: stat.achieved
                        ? `linear-gradient(135deg, ${stat.color}25 0%, #04080F 70%)`
                        : "linear-gradient(135deg, #12121f 0%, #0a0a14 70%)",
                      borderColor: stat.achieved ? `${stat.color}50` : undefined,
                    }}
                  >
                    <p className={`font-bebas ${i === 0 ? "text-xl" : "text-2xl"} leading-none ${stat.achieved ? "" : "text-gray-600"}`}
                      style={stat.achieved ? { color: stat.color } : undefined}>
                      {stat.value}
                    </p>
                    <p className={`text-[8px] font-bold uppercase tracking-widest mt-0.5 ${stat.achieved ? "text-cream/60" : "text-gray-700"}`}>
                      {stat.label}
                    </p>
                  </div>
                  {i === 0 && showPlacement && (
                    <div className="mt-1.5 w-16">
                      {!isRanked && (
                        <div className="font-bebas text-[8px] tracking-widest text-center mb-0.5"
                          style={{ color: TIERS[effectiveTierIndex].color }}>
                          {TIERS[effectiveTierIndex].name}
                        </div>
                      )}
                      <div className="text-[8px] text-cream/55 text-center mb-0.5">Play 5 matches</div>
                      <div className="h-1 rounded-full bg-cream/10 overflow-hidden">
                        <div className="h-full bg-gold rounded-full motion-safe:transition-all motion-safe:duration-500"
                          style={{ width: `${(placementGames! / 5) * 100}%` }} />
                      </div>
                      <div className="text-[8px] text-cream/55 text-center mt-0.5">{placementGames}/5</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ═══ 3. ARENA HEADLINE ═══ */}
          <div className="text-center mb-10 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <div className="inline-flex items-center gap-2 mb-4 px-3.5 py-1.5 rounded-full"
              style={{
                background: "linear-gradient(135deg, rgba(74,144,217,0.10) 0%, rgba(74,144,217,0.03) 100%)",
                border: "1px solid rgba(74,144,217,0.25)",
                boxShadow: "0 0 18px rgba(74,144,217,0.06)",
              }}>
              <span className="relative inline-flex w-2 h-2">
                <span className="absolute inset-0 rounded-full bg-electric/40 motion-safe:animate-ping" />
                <span className="relative inline-block w-2 h-2 rounded-full bg-electric" />
              </span>
              <span className="font-bebas text-[11px] tracking-[0.28em] text-electric leading-none">
                LIVE ARENA
              </span>
            </div>
            <h1 className="font-bebas text-6xl sm:text-8xl chrome-text tracking-wider leading-none">
              <Sword size={52} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" /> COMPETE
            </h1>
            <p className="text-cream/60 text-sm sm:text-base mt-2 max-w-lg mx-auto">
              Choose your battleground. Climb the ranks. Earn real rewards.
            </p>
          </div>

          {/* ═══ 4. DUEL CARD — HERO ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.15s" }}>
            <div className="glow-red rounded-2xl tilt-card">
              <div className="relative overflow-hidden rounded-2xl clip-angled-br"
                style={{
                  background: "linear-gradient(135deg, #1f0808 0%, #150505 20%, #0d0303 50%, #060c18 100%)",
                  border: "1px solid rgba(239,68,68,0.3)",
                }}>
                {/* Inner glow gradient */}
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(239,68,68,0.08) 0%, transparent 60%)" }} />

                {/* MOST POPULAR ribbon */}
                <div className="absolute top-5 right-[-28px] w-[135px] text-center rotate-[35deg] text-[9px] font-extrabold uppercase tracking-widest py-1.5 z-10"
                  style={{
                    background: "linear-gradient(135deg, #EF4444, #DC2626)",
                    color: "#fff",
                    boxShadow: "0 2px 12px rgba(239,68,68,0.5)",
                  }}>
                  <Sword size={18} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" /> MOST POPULAR
                </div>

                <div className="relative p-7 sm:p-10">
                  <p className="text-5xl mb-4"><Sword size={52} weight="regular" aria-hidden="true" /></p>
                  <p className="font-bebas text-4xl sm:text-5xl tracking-wider text-[#EF4444] mb-3"
                    style={{ textShadow: "0 0 20px rgba(239,68,68,0.3)" }}>
                    1v1 DUEL
                  </p>
                  <p className="text-cream/60 text-sm sm:text-base leading-relaxed max-w-xl mb-2">
                    Challenge anyone to a head-to-head battle. Same 10 questions. 15 seconds each.
                    Speed bonus for fast answers. Winner takes the wagered Fangs.
                  </p>
                  <p className="text-cream/55 text-xs mb-6 flex items-center justify-center gap-1">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" /> Wager: 10–100 Fangs
                  </p>
                  <div className="flex flex-wrap gap-3 mb-6">
                    <Link href="/compete/arena/duel" className="btn-gold text-sm px-6 py-3 rounded-xl">
                      <Target size={18} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" /> Find Opponent
                    </Link>
                    <Link href="/compete/arena/duel" className="btn-outline text-sm px-6 py-3 rounded-xl">
                      <Users size={18} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" /> Challenge Friend
                    </Link>
                  </div>
                  <p className="text-cream/55 text-xs">
                    Wins count toward your monthly ranking and Elo rating
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ 4.5 GAME MODES — Competitive Arena ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.18s" }}>
            <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-2">
              GAME MODES
            </h2>
            <p className="text-cream/55 text-sm text-center mb-6 max-w-lg mx-auto">
              Five ranked modes in one Arena. Every match earns Elo and Fangs on the ranked ladders. Play 1v1 or squad up 2v2.
            </p>
            <Link href="/compete/arena" aria-label="Enter the Competitive Arena, five ranked modes" className="block glow-purple rounded-2xl tilt-card group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7] focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
              <div className="relative overflow-hidden rounded-2xl transition-all duration-300 motion-safe:group-hover:-translate-y-1"
                style={{
                  background: "linear-gradient(135deg, #120a1f 0%, #0a0618 35%, #060c18 100%)",
                  border: "1px solid rgba(168,85,247,0.3)",
                }}>
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: "radial-gradient(ellipse at 30% 20%, rgba(168,85,247,0.10) 0%, transparent 60%)" }} />
                <div className="relative p-7 sm:p-9">
                  <p className="font-bebas text-3xl sm:text-4xl tracking-wider text-[#A855F7] mb-4"
                    style={{ textShadow: "0 0 18px rgba(168,85,247,0.25)" }}>
                    COMPETITIVE ARENA
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
                    {[
                      { name: "Quiz Duel", icon: "🗡️", accent: "#FFD700", tag: "1v1" },
                      { name: "Sabotage", icon: "⚔️", accent: "#EF4444", tag: "Fight" },
                      { name: "Zoom Reveal", icon: "🔍", accent: "#00BFFF", tag: "Nerve" },
                      { name: "Spectrum", icon: "🎚️", accent: "#A855F7", tag: "Feel" },
                      { name: "Map Pin", icon: "📍", accent: "#50C878", tag: "Spatial" },
                    ].map((m) => (
                      <div key={m.name} className="rounded-xl py-3 px-2 text-center"
                        style={{ background: "rgba(255,255,255,0.03)", border: `1px solid ${m.accent}22` }}>
                        <p className="text-2xl mb-1" aria-hidden="true">{m.icon}</p>
                        <p className="font-bebas text-[11px] tracking-wider" style={{ color: m.accent }}>{m.name.toUpperCase()}</p>
                        <p className="text-cream/55 text-[9px] font-syne">{m.tag}</p>
                      </div>
                    ))}
                  </div>
                  <span className="inline-flex items-center gap-2 font-bebas text-lg tracking-wider px-7 py-2.5 rounded-xl"
                    style={{ background: "linear-gradient(135deg, #A855F7 0%, #8b3fd6 100%)", color: "#0a0a14" }}>
                    ENTER ARENA <span className="text-base" aria-hidden="true">&rarr;</span>
                  </span>
                </div>
              </div>
            </Link>
          </div>

          {/* ═══ 5. BLITZ + LEADERBOARD — Side by Side ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.2s" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Blitz */}
              <Link href="/compete/blitz" aria-label="Play Blitz Mode, 60 second speed round" className="block glow-yellow rounded-2xl tilt-card group cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#EAB308] focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
                <div className="relative overflow-hidden h-full rounded-2xl clip-angled-br transition-all duration-300 motion-safe:group-hover:-translate-y-1"
                  style={{
                    background: "linear-gradient(135deg, #1a1400 0%, #0f0a00 30%, #080600 50%, #060c18 100%)",
                    border: "1px solid rgba(234,179,8,0.25)",
                  }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: "radial-gradient(ellipse at 30% 30%, rgba(234,179,8,0.06) 0%, transparent 60%)" }} />
                  <div className="ribbon-diagonal" style={{ background: "linear-gradient(135deg, #FF6B00, #FF8C00)" }}>PLAY</div>
                  <div className="relative p-7">
                    <p className="text-4xl mb-3"><Lightning size={40} weight="fill" aria-hidden="true" /></p>
                    <p className="font-bebas text-2xl sm:text-3xl tracking-wider text-[#EAB308] mb-2"
                      style={{ textShadow: "0 0 15px rgba(234,179,8,0.2)" }}>
                      BLITZ MODE
                    </p>
                    <p className="text-cream/60 text-sm leading-relaxed mb-4">
                      Pure speed. No penalties.
                    </p>

                    <div className="grid grid-cols-3 gap-2 mb-5">
                      <div className="rounded-xl py-2.5 px-2 text-center"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,107,0,0.12)" }}>
                        <Clock size={20} weight="regular" aria-hidden="true" className="mx-auto mb-1 text-cream/70" />
                        <p className="font-bebas text-[11px] tracking-wider text-cream/80">60 SECONDS</p>
                        <p className="text-cream/55 text-[9px] font-syne">race the clock</p>
                      </div>
                      <div className="rounded-xl py-2.5 px-2 text-center"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,107,0,0.12)" }}>
                        <Brain size={20} weight="regular" aria-hidden="true" className="mx-auto mb-1 text-cream/70" />
                        <p className="font-bebas text-[11px] tracking-wider text-cream/80">ALL SUBJECTS</p>
                        <p className="text-cream/55 text-[9px] font-syne">random mix</p>
                      </div>
                      <div className="rounded-xl py-2.5 px-2 text-center"
                        style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,107,0,0.12)" }}>
                        <img src={cdnUrl("/F.png")} alt="" aria-hidden="true" className="w-5 h-5 object-contain mx-auto mb-1" />
                        <p className="font-bebas text-[11px] tracking-wider text-cream/80">2x FANGS</p>
                        <p className="text-cream/55 text-[9px] font-syne">per correct</p>
                      </div>
                    </div>

                    {/* Styled as the card's call-to-action, but NOT a real
                        <button> — the whole card is one <Link>, so a nested
                        interactive control would be invalid + an extra tab
                        stop. This is a presentational span. */}
                    <span className="inline-block font-bebas text-lg tracking-wider px-8 py-2.5 rounded-xl transition-transform motion-safe:group-active:scale-95"
                      style={{ background: "linear-gradient(135deg, #FF6B00 0%, #FF8C00 100%)", color: "#fff", boxShadow: "0 4px 16px rgba(255,107,0,0.3)" }}>
                      PLAY NOW
                    </span>
                  </div>
                </div>
              </Link>

              {/* Leaderboard */}
              <div className="glow-purple rounded-2xl tilt-card">
                <div className="relative overflow-hidden h-full rounded-2xl"
                  style={{
                    background: "linear-gradient(135deg, #150a1f 0%, #0d0618 30%, #080410 50%, #060c18 100%)",
                    border: "1px solid rgba(168,85,247,0.25)",
                  }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: "radial-gradient(ellipse at 50% 20%, rgba(168,85,247,0.06) 0%, transparent 60%)" }} />
                  <div className="relative p-7">
                    <p className="text-4xl mb-3"><Crown size={40} weight="fill" aria-hidden="true" /></p>
                    <p className="font-bebas text-2xl sm:text-3xl tracking-wider text-[#A855F7] mb-4"
                      style={{ textShadow: "0 0 15px rgba(168,85,247,0.2)" }}>
                      LEADERBOARD
                    </p>
                    <div className="space-y-2 mb-4">
                      {leaderboardLoading ? (
                        // Skeleton rows while the Elo leaderboard loads — no
                        // flash of a fabricated placeholder player.
                        Array.from({ length: 3 }).map((_, i) => (
                          <div key={i}
                            className="flex items-center gap-3 px-3 py-2 rounded-lg"
                            style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(168,85,247,0.1)" }}
                            aria-hidden="true">
                            <span className="h-3 w-4 rounded bg-cream/10 motion-safe:animate-pulse" />
                            <span className="h-3 flex-1 rounded bg-cream/10 motion-safe:animate-pulse" />
                            <span className="h-3 w-12 rounded bg-cream/10 motion-safe:animate-pulse" />
                          </div>
                        ))
                      ) : topPlayers.length === 0 ? (
                        <p className="text-cream/55 text-xs font-syne px-3 py-4 text-center">
                          No ranked players yet. Win an Arena match to claim the top spot.
                        </p>
                      ) : (
                        topPlayers.map((player) => {
                          const renderMedal = () => {
                            if (player.rank === 1) {
                              return <Crown size={14} weight="fill" aria-hidden="true" className="inline mr-1 -mt-0.5" color="#FFD700" />;
                            }
                            if (player.rank === 2) {
                              return <Medal size={14} weight="regular" aria-hidden="true" className="inline mr-1 -mt-0.5" color="#C0C0C0" />;
                            }
                            if (player.rank === 3) {
                              return <Medal size={14} weight="regular" aria-hidden="true" className="inline mr-1 -mt-0.5" color="#CD7F32" />;
                            }
                            return null;
                          };
                          return (
                            <div key={player.rank}
                              className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
                              style={{
                                background: player.rank <= 3
                                  ? "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(168,85,247,0.02) 100%)"
                                  : "rgba(255,255,255,0.02)",
                                border: "1px solid rgba(168,85,247,0.1)",
                              }}>
                              <span className="font-bebas text-sm text-cream/70 w-5">#{player.rank}</span>
                              <span className="text-cream/75 text-xs flex-1 font-medium">
                                {renderMedal()}
                                {player.username}
                              </span>
                              <span className="font-bebas text-xs text-cream/70">{player.arena_elo.toLocaleString()} Elo</span>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <div className="border-t border-cream/10 pt-3 mb-4">
                      <p className="text-cream/60 text-xs">
                        Your Rank:{" "}
                        {recordLoading ? (
                          <span className="inline-block align-middle h-3 w-10 rounded bg-cream/10 motion-safe:animate-pulse" aria-hidden="true" />
                        ) : (
                          <span className="text-cream/85 font-semibold">{isRanked ? `#${myRank}` : "Unranked"}</span>
                        )}
                      </p>
                    </div>
                    <Link href="/leaderboard"
                      className="text-[#C084FC] text-sm font-semibold hover:text-[#D8B4FE] transition-colors inline-flex items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A855F7]/70 focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
                      View Full Leaderboard <span className="text-base" aria-hidden="true">&rarr;</span>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ 6. WEEKLY TOURNAMENT ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.25s" }}>
            <div className="glow-blue rounded-2xl">
              <div className="relative overflow-hidden rounded-2xl clip-angled-br"
                style={{
                  background: "linear-gradient(135deg, #081020 0%, #060a1a 30%, #040818 60%, #04080F 100%)",
                  border: "1px solid rgba(59,130,246,0.25)",
                }}>
                <div className="absolute inset-0 pointer-events-none"
                  style={{ background: "radial-gradient(ellipse at 40% 30%, rgba(59,130,246,0.06) 0%, transparent 60%)" }} />
                <div className="ribbon-diagonal">SOON</div>
                <div className="relative p-7 sm:p-10">
                  <p className="font-bebas text-3xl sm:text-4xl tracking-wider text-[#3B82F6] mb-3"
                    style={{ textShadow: "0 0 15px rgba(59,130,246,0.2)" }}>
                    <Trophy size={32} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" /> WEEKLY TOURNAMENT
                  </p>
                  <p className="text-cream/60 text-sm sm:text-base leading-relaxed mb-6 max-w-xl">
                    Squad up with friends. Compete in a week-long bracket. Top 3 earn exclusive badges and Fang prizes.
                  </p>

                  {/* Bracket SVG */}
                  <div className="flex justify-center mb-6">
                    <svg width="300" height="110" viewBox="0 0 300 110" fill="none" className="opacity-60" aria-hidden="true" role="presentation">
                      {/* Round 1 — 8 slots */}
                      <rect x="0" y="2" width="44" height="18" rx="4" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.3)" strokeWidth="0.5" />
                      <rect x="0" y="26" width="44" height="18" rx="4" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.3)" strokeWidth="0.5" />
                      <rect x="0" y="58" width="44" height="18" rx="4" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.3)" strokeWidth="0.5" />
                      <rect x="0" y="82" width="44" height="18" rx="4" fill="rgba(59,130,246,0.15)" stroke="rgba(59,130,246,0.3)" strokeWidth="0.5" />
                      {/* Connectors R1→R2 */}
                      <path d="M44 11 H60 V23 H44" stroke="rgba(59,130,246,0.25)" strokeWidth="1" fill="none" />
                      <path d="M44 35 H60 V23 H44" stroke="rgba(59,130,246,0.25)" strokeWidth="1" fill="none" />
                      <path d="M60 23 H75" stroke="rgba(59,130,246,0.25)" strokeWidth="1" />
                      <path d="M44 67 H60 V79 H44" stroke="rgba(59,130,246,0.25)" strokeWidth="1" fill="none" />
                      <path d="M44 91 H60 V79 H44" stroke="rgba(59,130,246,0.25)" strokeWidth="1" fill="none" />
                      <path d="M60 79 H75" stroke="rgba(59,130,246,0.25)" strokeWidth="1" />
                      {/* Round 2 */}
                      <rect x="75" y="14" width="44" height="18" rx="4" fill="rgba(59,130,246,0.2)" stroke="rgba(59,130,246,0.35)" strokeWidth="0.5" />
                      <rect x="75" y="70" width="44" height="18" rx="4" fill="rgba(59,130,246,0.2)" stroke="rgba(59,130,246,0.35)" strokeWidth="0.5" />
                      {/* Connectors R2→Semi */}
                      <path d="M119 23 H140 V51 H119" stroke="rgba(59,130,246,0.3)" strokeWidth="1" fill="none" />
                      <path d="M119 79 H140 V51 H119" stroke="rgba(59,130,246,0.3)" strokeWidth="1" fill="none" />
                      <path d="M140 51 H160" stroke="rgba(59,130,246,0.3)" strokeWidth="1" />
                      {/* Semi */}
                      <rect x="160" y="42" width="48" height="18" rx="4" fill="rgba(59,130,246,0.25)" stroke="rgba(59,130,246,0.4)" strokeWidth="0.5" />
                      {/* Final connector */}
                      <path d="M208 51 H230" stroke="rgba(255,215,0,0.4)" strokeWidth="1.5" />
                      {/* Winner */}
                      <rect x="230" y="38" width="60" height="26" rx="6" fill="rgba(255,215,0,0.15)" stroke="rgba(255,215,0,0.4)" strokeWidth="1" />
                      <text x="260" y="55" textAnchor="middle" fontSize="10" fill="#FFD700" fontFamily="var(--font-bebas)" letterSpacing="0.1em">🏆 #1</text>
                    </svg>
                  </div>

                  <p className="text-cream/55 text-xs font-semibold uppercase tracking-wider text-center">
                    Coming Summer 2026
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ 7. HOW CASH REWARDS WORK ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.3s" }}>
            <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-6">
              HOW CASH REWARDS WORK
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              {[
                { step: 1, Icon: Sword, iconWeight: "regular" as const, title: "COMPETE", desc: "Win duels and climb the leaderboard. Your Elo rating determines your rank." },
                { step: 2, Icon: CheckCircle, iconWeight: "fill" as const, title: "VERIFY", desc: "Complete identity verification. One account per person." },
                { step: 3, Icon: CurrencyDollar, iconWeight: "regular" as const, title: "GET PAID", desc: "Top 20 verified players receive their cut monthly." },
              ].map((item) => (
                <div key={item.step} className="tilt-card rounded-2xl overflow-hidden"
                  style={{
                    background: "linear-gradient(135deg, #0c1025 0%, #080c1a 50%, #060c18 100%)",
                    border: "1px solid rgba(255,215,0,0.12)",
                  }}>
                  <div className="flex flex-col items-center text-center p-7">
                    {/* Diamond step number */}
                    <div className="diamond-step border border-gold/30 bg-gold/10 mb-5">
                      <span className="diamond-step-inner font-bebas text-lg text-gold">
                        {item.step}
                      </span>
                    </div>
                    <p className="font-bebas text-xl tracking-wider text-gold mb-2">
                      <item.Icon size={24} weight={item.iconWeight} aria-hidden="true" className="inline mr-1.5 -mt-0.5" /> {item.title}
                    </p>
                    <p className="text-cream/60 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-cream/55 text-xs text-center mt-5">
              Cash rewards go live with V2 in December 2026.
            </p>
          </div>

          {/* ═══ 8. RANKING TIERS — PYRAMID ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.35s" }}>
            <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-6">
              RANKING TIERS
            </h2>
            <div className="max-w-3xl mx-auto space-y-2.5">
              {tiersTopDown.map((tier, displayIdx) => {
                const origIdx = TIERS.length - 1 - displayIdx;
                const isLegend = tier.name === "LEGEND";
                const isOnyx = tier.name === "ONYX";
                // currentTierIndex is null while ELO loads → no "YOU" badge,
                // no achieved glow, everything above Bronze locked.
                const isCurrent = currentTierIndex !== null && origIdx === currentTierIndex;
                const isLocked = origIdx > effectiveTierIndex;
                const isAchieved = currentTierIndex !== null && origIdx < currentTierIndex;

                const tierColor = isLegend ? "#FFD700" : (isOnyx ? (tier.glowColor || "#C0C0D0") : tier.color);
                const textColor = isOnyx ? (tier.textColor || "#C0C0D0") : tier.color;
                const staggerDelay = 0.35 + (TIERS.length - 1 - displayIdx) * 0.04;

                return (
                  <div key={tier.name} className="flex justify-center animate-slide-up group"
                    style={{ animationDelay: `${staggerDelay}s` }}>
                    <div className="relative flex items-center" style={{ width: widthsTopDown[displayIdx] }}>
                      {isCurrent && (
                        <div className="absolute -left-8 top-1/2 -translate-y-1/2 text-cream/60 text-sm font-bold animate-pulse" aria-hidden="true">
                          ▶
                        </div>
                      )}

                      <div
                        className={`relative w-full rounded-xl px-4 py-3 sm:px-5 sm:py-3.5 flex items-center gap-3 overflow-hidden transition-all duration-300
                          ${isCurrent ? "tier-active" : ""}
                          ${isLegend && !isLocked ? "legend-bar-bg legend-sparkle" : ""}`}
                        style={{
                          "--tier-color-glow": `${tierColor}60`,
                          background: isLocked
                            ? "linear-gradient(135deg, #0d0d15 0%, #0a0a12 100%)"
                            : isLegend
                            ? undefined
                            : `linear-gradient(135deg, ${tier.color}18 0%, ${tier.color}06 100%)`,
                          border: isLocked
                            ? "1px solid #16161f"
                            : isOnyx
                            ? `1px solid ${tier.glowColor || "#C0C0D0"}40`
                            : `1px solid ${tier.color}35`,
                          boxShadow: isLocked ? undefined
                            : isCurrent ? undefined
                            : isAchieved ? `0 0 8px ${tierColor}20` : undefined,
                          opacity: isLocked ? 0.4 : 1,
                        } as React.CSSProperties}
                      >
                        <div className="flex-shrink-0 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center">
                          {isLocked ? (
                            <span className="text-lg sm:text-xl"><Lock size={20} weight="regular" aria-hidden="true" /></span>
                          ) : (
                            <div className="gem-shimmer w-10 h-10 sm:w-12 sm:h-12" style={{ "--gem-color": tierColor } as React.CSSProperties}>
                              <img
                                src={tier.image}
                                alt={tier.tagline}
                                className="w-10 h-10 sm:w-12 sm:h-12 object-contain"
                              />
                            </div>
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-bebas text-sm sm:text-base tracking-wider ${isLocked ? "text-gray-600" : isLegend ? "legend-text" : ""}`}
                              style={!isLocked && !isLegend ? { color: textColor } : undefined}>
                              {tier.tagline.toUpperCase()}
                            </span>
                            {isCurrent && (
                              <span className="text-[8px] font-bold uppercase tracking-widest text-cream/50 bg-cream/[0.07] px-2 py-0.5 rounded-md">
                                YOU
                              </span>
                            )}
                          </div>
                        </div>

                        <span className={`font-bebas text-[10px] sm:text-xs tracking-wider flex-shrink-0 ${isLocked ? "text-gray-700" : "text-cream/55"}`}>
                          {tier.range}
                        </span>

                        {/* Shine sweep across entire bar */}
                        {!isLocked && (
                          <div
                            className="tier-bar-shine"
                            style={{ "--shine-color": `${tierColor}` } as React.CSSProperties}
                          />
                        )}

                        {/* Hover tooltip */}
                        <div className="absolute left-1/2 -translate-x-1/2 -top-10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-20">
                          <div className="bg-[#0a0e18] border border-cream/10 rounded-lg px-4 py-1.5 shadow-xl whitespace-nowrap">
                            <span className={`font-syne text-xs font-bold ${isLegend ? "legend-text" : ""}`}
                              style={!isLegend ? { color: isOnyx ? (tier.textColor || "#C0C0D0") : tier.color } : undefined}>
                              {DISPLAY_NAME}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ═══ 9. USERNAME COLOR PREVIEW ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.4s" }}>
            <div className="rounded-2xl text-center p-7"
              style={{
                background: "linear-gradient(135deg, #0c1020 0%, #080c18 50%, #060c18 100%)",
                border: "1px solid rgba(74,144,217,0.15)",
              }}>
              <p className="font-bebas text-xl tracking-wider text-cream/60 mb-4">
                YOUR NAME IN THE ARENA
              </p>
              <p className="font-syne text-2xl font-bold mb-2"
                style={{ color: TIERS[effectiveTierIndex].color, textShadow: `0 0 20px ${TIERS[effectiveTierIndex].color}40` }}>
                {DISPLAY_NAME}
              </p>
              {effectiveTierIndex < TIERS.length - 1 && (
                <div className="mt-3">
                  <p className="text-cream/55 text-[10px] uppercase tracking-widest mb-1.5">Next rank:</p>
                  <p className={`font-syne text-xl font-bold opacity-50 ${TIERS[effectiveTierIndex + 1].name === "LEGEND" ? "legend-text" : ""}`}
                    style={TIERS[effectiveTierIndex + 1].name !== "LEGEND" ? { color: TIERS[effectiveTierIndex + 1].color } : undefined}>
                    {DISPLAY_NAME}
                  </p>
                  <p className="text-cream/55 text-[10px] mt-1">
                    {TIERS[effectiveTierIndex + 1].range} to unlock{" "}
                    <span style={{ color: TIERS[effectiveTierIndex + 1].name === "LEGEND" ? "#FFD700" : TIERS[effectiveTierIndex + 1].color }}>
                      {TIERS[effectiveTierIndex + 1].name}
                    </span>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* ═══ 10. FAIR PLAY NOTICE ═══ */}
          <div className="animate-slide-up" style={{ animationDelay: "0.45s" }}>
            <div className="rounded-2xl flex items-start gap-5 p-7"
              style={{
                background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
                border: "1px solid rgba(74,144,217,0.15)",
              }}>
              <div className="text-3xl flex-shrink-0"><Shield size={32} weight="fill" aria-hidden="true" /></div>
              <div>
                <p className="font-bebas text-xl tracking-wider text-electric mb-1.5"
                  style={{ textShadow: "0 0 10px rgba(74,144,217,0.2)" }}>
                  FAIR PLAY PROTECTED
                </p>
                <p className="text-cream/60 text-sm leading-relaxed">
                  Lionade uses tab detection, timing analysis, and behavioral pattern monitoring.
                  Cheaters are permanently banned from cash rewards.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
