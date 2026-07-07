"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import { useAuth } from "@/lib/auth";
import { getLeaderboard, getLadderLeaderboard, type EloLadder } from "@/lib/db";
import { formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";
import { avatarFor } from "@/lib/avatar";
import { Crown, Medal, Sword, TrendUp, Trophy, Brain, Fire, Crosshair, UsersThree, ArrowUp } from "@phosphor-icons/react";
import AnimatedUsername from "@/components/AnimatedUsername";
import Avatar from "@/components/Avatar";
import EquippedFlair from "@/components/EquippedFlair";
import { apiPost } from "@/lib/api-client";
import {
  resolveRowUsernameEffect,
  resolveRowNameColor,
  useEquippedUsernameEffect,
  useEquippedCosmetics,
} from "@/lib/use-username-effect";

type Filter = "duel" | "competitive" | "squad" | "weekly";

const FILTER_ORDER: Filter[] = ["duel", "competitive", "squad", "weekly"];

const LADDER_FOR: Record<Exclude<Filter, "weekly">, EloLadder> = {
  duel: "arena_elo",
  competitive: "competitive_elo",
  squad: "squad_elo",
};

interface LbEntry {
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  streak: number;
  coins_this_week: number;
  elo?: number;
  equipped_username_effect?: string | null;
  equipped_frame?: string | null;
  equipped_name_color?: string | null;
  equipped_avatar_aura?: string | null;
}

export default function LeaderboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();
  const myEffect = useEquippedUsernameEffect();
  // Self cosmetics — prefer live self values over the row when I appear in a list.
  const myCosmetics = useEquippedCosmetics();
  const [filter, setFilter] = useState<Filter>("duel");
  // Bumped by the error card's "Try again" — setFilter(filter) was a no-op
  // (same value = no re-render = no refetch), so the retry button did nothing.
  const [reloadKey, setReloadKey] = useState(0);
  // `entries === null` means "not resolved yet" → render skeletons, never an
  // empty/zero board (no flash-of-empty). `[]` is a genuine empty board.
  const [entries, setEntries] = useState<LbEntry[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Founder-badge flair per user, resolved via a server endpoint. founder_grants
  // is RLS-restricted to own rows, so the anon client behind getLadderLeaderboard
  // cannot read other users' grants — we enrich best-effort after the board loads.
  const [flairByUser, setFlairByUser] = useState<Record<string, string>>({});
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const loading = entries === null && !loadError;
  const isElo = filter !== "weekly";

  useEffect(() => {
    let active = true;
    setEntries(null);
    setLoadError(false);
    setFlairByUser({});

    // Best-effort founder-flair enrichment via a server route (the anon client
    // can't read other users' RLS-protected founder_grants). Never blocks the
    // board: on any failure the rows simply render without pills.
    const enrichFlair = (lbRows: { user_id: string }[]) => {
      const ids = lbRows.map((r) => r.user_id).filter(Boolean);
      if (ids.length === 0) return;
      apiPost<{ flair: Record<string, string> }>("/api/cosmetics/flair-batch", { userIds: ids })
        .then((res) => { if (active && res.ok && res.data) setFlairByUser(res.data.flair); })
        .catch(() => {});
    };

    if (filter !== "weekly") {
      getLadderLeaderboard(LADDER_FOR[filter], 200).then(data => {
        if (!active) return;
        const mapped: LbEntry[] = data.map(d => ({
          rank: d.rank,
          user_id: d.user_id,
          username: d.username,
          avatar_url: d.avatar_url,
          level: d.level,
          streak: d.streak,
          coins_this_week: 0,
          elo: d.elo,
          equipped_username_effect: d.equipped_username_effect ?? null,
          equipped_frame: d.equipped_frame ?? null,
          equipped_name_color: d.equipped_name_color ?? null,
          equipped_avatar_aura: d.equipped_avatar_aura ?? null,
        }));
        setEntries(mapped);
        enrichFlair(mapped);
      }).catch(() => { if (active) { setEntries([]); setLoadError(true); } });
    } else {
      getLeaderboard(200).then(data => {
        if (!active) return;
        setEntries(data);
        enrichFlair(data);
      }).catch(() => { if (active) { setEntries([]); setLoadError(true); } });
    }
    return () => { active = false; };
  }, [filter, reloadKey]);

  const rows = entries ?? [];
  const topThree = rows.slice(0, 3);

  const rankBorderColor: Record<number, string> = { 1: "#FFD700", 2: "#9CA3AF", 3: "#B45309" };

  const ELO_TIERS = [
    { name: "Bronze",   min: 0,    max: 1199, color: "#CD7F32" },
    { name: "Silver",   min: 1200, max: 1399, color: "#C0C0C0" },
    { name: "Gold",     min: 1400, max: 1599, color: "#FFD700" },
    { name: "Platinum", min: 1600, max: 1799, color: "#00CED1" },
    { name: "Diamond",  min: 1800, max: 9999, color: "#B9F2FF" },
  ];
  const getEloTier = (elo: number) =>
    ELO_TIERS.find(t => elo >= t.min && elo <= t.max) ?? ELO_TIERS[0];

  const renderRankIcon = (rank: number, size: number) => {
    if (rank === 1) return <Crown size={size} weight="fill" color="#FFD700" aria-hidden="true" />;
    if (rank === 2) return <Medal size={size} weight="fill" color="#9CA3AF" aria-hidden="true" />;
    if (rank === 3) return <Medal size={size} weight="fill" color="#B45309" aria-hidden="true" />;
    return null;
  };

  const displayValue = (entry: LbEntry) =>
    isElo ? `${(entry.elo ?? 1000).toLocaleString()} ELO` : formatCoins(entry.coins_this_week);

  // Full spoken standing for each row so screen-reader users get the rank,
  // name, score, and (on ELO ladders) the tier without relying on color tint.
  const rowAriaLabel = (entry: LbEntry, isMe: boolean): string => {
    const value = isElo
      ? `${(entry.elo ?? 1000).toLocaleString()} Elo`
      : `${formatCoins(entry.coins_this_week)} Fangs`;
    const tier = isElo ? `, ${getEloTier(entry.elo ?? 1000).name} tier` : "";
    return `Rank ${entry.rank}${isMe ? " (you)" : ""}: ${entry.username}, ${value}${tier}, level ${entry.level}, ${entry.streak} day streak`;
  };

  // Roving-focus arrow-key nav for the tablist (Left/Right + Home/End).
  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (index + 1) % FILTER_ORDER.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (index - 1 + FILTER_ORDER.length) % FILTER_ORDER.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = FILTER_ORDER.length - 1;
    else return;
    e.preventDefault();
    setFilter(FILTER_ORDER[next]);
    tabRefs.current[next]?.focus();
  };

  const myEntry = rows.find(e => e.user_id === user?.id);
  const myRank = myEntry ? rows.indexOf(myEntry) + 1 : null;
  const personAboveMe = myRank && myRank > 1 ? rows[myRank - 2] : null;
  const myValue = myEntry ? (isElo ? (myEntry.elo ?? 1000) : myEntry.coins_this_week) : null;
  const aboveValue = personAboveMe ? (isElo ? (personAboveMe.elo ?? 1000) : personAboveMe.coins_this_week) : null;
  const gapToAbove = myValue != null && aboveValue != null ? Math.max(0, aboveValue - myValue) : null;

  const filterLabel =
    filter === "duel" ? "Quiz Duel Rankings"
    : filter === "competitive" ? "Competitive Rankings"
    : filter === "squad" ? "Squad Rankings"
    : "Weekly Rankings";

  return (
    <ProtectedRoute>
      <FeatureGate feature="leaderboard">
      <div className="min-h-screen pt-20">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <BackButton />

          {/* Header */}
          <div className="text-center mb-10 animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-electric/10 border border-electric/30 rounded-full px-3 py-1 text-electric text-[11px] font-semibold uppercase tracking-[0.18em] mb-4">
              <span className="relative inline-flex w-2 h-2" aria-hidden="true">
                <span className="absolute inline-flex w-full h-full rounded-full bg-electric opacity-60 motion-safe:animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-electric" />
              </span>
              Live Ladder
            </span>
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider mb-3">LEADERBOARD</h1>
            <span className="inline-flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-full px-4 py-1.5 text-gold text-sm font-semibold mb-3">
              <Crown size={16} weight="fill" color="currentColor" aria-hidden="true" />
              {filterLabel}
            </span>
            <p className="text-cream/60 text-base">
              {isElo ? "Ranked by Elo across the season." : "Top earners reset every Sunday midnight."}
            </p>
          </div>

          {/* Filters — ranked-ladder tabs (ARIA tablist + arrow-key roving focus) */}
          <div
            role="tablist"
            aria-label="Leaderboard ranking"
            className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-navy-50 border border-electric/20 rounded-xl p-1.5 mb-8 animate-slide-up"
            style={{ animationDelay: "0.1s" }}
          >
            {([
              { key: "duel" as const, label: "Quiz Duel", Icon: Sword },
              { key: "competitive" as const, label: "Competitive", Icon: Crosshair },
              { key: "squad" as const, label: "Squad", Icon: UsersThree },
              { key: "weekly" as const, label: "Weekly Fangs", Icon: TrendUp },
            ]).map((tab, i) => {
              const selected = filter === tab.key;
              return (
                <button
                  key={tab.key}
                  ref={(el) => { tabRefs.current[i] = el; }}
                  role="tab"
                  id={`lb-tab-${tab.key}`}
                  aria-selected={selected}
                  aria-controls="lb-panel"
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setFilter(tab.key)}
                  onKeyDown={(e) => onTabKeyDown(e, i)}
                  className={`py-2.5 px-2 min-h-[44px] rounded-lg text-sm font-semibold transition-all duration-200 inline-flex items-center justify-center gap-1.5
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy
                    ${selected ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/60 hover:text-cream hover:bg-white/5"}`}
                >
                  <tab.Icon size={16} weight={selected ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div role="tabpanel" id="lb-panel" aria-labelledby={`lb-tab-${filter}`}>

          {/* Polite live region — announces board state to screen readers as the
              selected ladder loads / resolves / errors. Visually hidden. */}
          <p className="sr-only" role="status" aria-live="polite">
            {loading
              ? `Loading ${filterLabel}`
              : loadError
                ? "Could not load the leaderboard. Please try again."
                : rows.length === 0
                  ? `${filterLabel}: no players yet`
                  : `${filterLabel}: ${rows.length} ${rows.length === 1 ? "player" : "players"} ranked`}
          </p>

          {/* Overtake hero callout — visible above podium when user is logged in
              and ranked. Creates a direct competitive prompt. */}
          {!loading && !loadError && user && myEntry && myRank && personAboveMe && (
            <div
              className="mb-6 p-4 rounded-2xl border border-electric/30 bg-gradient-to-r from-electric/12 via-electric/6 to-transparent backdrop-blur-sm animate-slide-up will-change-transform"
              style={{ animationDelay: "0.15s" }}
            >
              <div className="flex items-center gap-4">
                <div className="hidden sm:flex flex-col items-center justify-center w-14 h-14 rounded-xl bg-electric/15 border border-electric/30 flex-shrink-0">
                  <ArrowUp size={20} weight="bold" color="#00D4FF" aria-hidden="true" />
                  <span className="font-bebas text-[11px] text-electric leading-none mt-0.5">CLIMB</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-electric/80 mb-0.5">Your next move</p>
                  <p className="text-cream text-sm sm:text-base">
                    Beat{" "}
                    <span className="font-semibold text-cream">
                      <AnimatedUsername
                        username={personAboveMe.username}
                        effect={resolveRowUsernameEffect(personAboveMe.equipped_username_effect)}
                        nameColor={resolveRowNameColor(personAboveMe.equipped_name_color)}
                        size="sm"
                      />
                    </span>{" "}
                    to take <span className="font-bebas text-xl text-gold align-middle">#{myRank - 1}</span>
                    {gapToAbove != null && gapToAbove > 0 && (
                      <span className="text-cream/60 text-xs sm:text-sm">
                        {" "}{isElo ? `· ${gapToAbove.toLocaleString()} ELO away` : `· ${formatCoins(gapToAbove)} away`}
                      </span>
                    )}
                  </p>
                </div>
                {filter === "duel" && (
                  <button
                    onClick={() => router.push(`/compete/arena/duel?challenge=${encodeURIComponent(personAboveMe.username)}`)}
                    aria-label={`Challenge ${personAboveMe.username} to a duel`}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg bg-electric text-white text-sm font-semibold shadow-lg shadow-electric/30 hover:brightness-110 transition-all active:scale-95 will-change-transform
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                  >
                    <Sword size={14} weight="fill" color="currentColor" aria-hidden="true" />
                    Challenge
                  </button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3" aria-hidden="true">
              {[1,2,3,4,5].map(i => (
                <div key={i} className="h-16 rounded-xl bg-white/5 motion-safe:animate-pulse" style={{ animationDelay: `${i * 80}ms` }} />
              ))}
            </div>
          ) : loadError ? (
            <div className="card text-center py-16">
              <div className="flex justify-center mb-4">
                <Trophy size={52} weight="fill" color="#9CA3AF" aria-hidden="true" />
              </div>
              <p className="font-bebas text-3xl text-cream tracking-wider mb-2">Could not load the board</p>
              <p className="text-cream/60 text-sm mb-6">Something went wrong fetching the rankings. Try again.</p>
              <button
                onClick={() => setReloadKey((k) => k + 1)}
                className="btn-gold px-8 py-3 inline-flex items-center gap-2 min-h-[44px]
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
              >
                <ArrowUp size={16} weight="bold" color="currentColor" aria-hidden="true" />
                Try again
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="card text-center py-16">
              <div className="flex justify-center mb-4">
                <Trophy size={52} weight="fill" color="#FFD700" aria-hidden="true" />
              </div>
              <p className="font-bebas text-3xl text-cream tracking-wider mb-2">Be the first on the board</p>
              <p className="text-cream/60 text-sm mb-6">Take a quiz, earn Fangs, and claim the #1 spot.</p>
              <a href="/quiz" className="inline-block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-navy">
                <span className="btn-gold px-8 py-3 inline-flex items-center gap-2 min-h-[44px]">
                  <Brain size={16} weight="fill" color="currentColor" aria-hidden="true" />
                  Take a Quiz
                </span>
              </a>
            </div>
          ) : (
            <>
              {/* Podium */}
              {topThree.length >= 3 && (
                <div className="relative grid grid-cols-3 gap-3 mb-8 animate-slide-up" style={{ animationDelay: "0.2s" }}>
                  {/* Soft podium glow backdrop */}
                  <div
                    aria-hidden="true"
                    className="absolute inset-x-0 -top-6 bottom-0 pointer-events-none"
                    style={{
                      background: "radial-gradient(60% 80% at 50% 0%, rgba(255,215,0,0.10) 0%, rgba(255,215,0,0) 70%)",
                    }}
                  />

                  {/* 2nd */}
                  <div
                    className="relative flex flex-col items-center pt-8"
                    role="group"
                    aria-label={`Second place, Silver tier: ${topThree[1]?.username}, ${isElo ? `${(topThree[1]?.elo ?? 1000).toLocaleString()} Elo` : `${formatCoins(topThree[1]?.coins_this_week ?? 0)} Fangs`}`}
                  >
                    <div className="rounded-2xl border border-gray-400/30 bg-gradient-to-b from-gray-400/10 to-transparent w-full pt-3 pb-4 px-2 flex flex-col items-center">
                      <div className="mb-2"><Medal size={28} weight="fill" color="#9CA3AF" aria-hidden="true" /></div>
                      <div className="mb-2 rounded-full border-2 border-gray-400 will-change-transform"
                        aria-hidden="true"
                        style={{ boxShadow: "0 0 18px #9CA3AF55" }}>
                        <Avatar
                          url={avatarFor(topThree[1]?.username, topThree[1]?.avatar_url)}
                          alt=""
                          size="md"
                          frame={topThree[1]?.user_id === user?.id ? myCosmetics.frame : topThree[1]?.equipped_frame}
                          aura={topThree[1]?.user_id === user?.id ? myCosmetics.aura : topThree[1]?.equipped_avatar_aura}
                        />
                      </div>
                      <p className="text-cream text-xs font-bold text-center truncate w-full" aria-hidden="true">
                        <AnimatedUsername
                          username={topThree[1]?.username}
                          effect={topThree[1]?.user_id === user?.id ? myEffect : resolveRowUsernameEffect(topThree[1]?.equipped_username_effect)}
                          nameColor={topThree[1]?.user_id === user?.id ? myCosmetics.nameColor : resolveRowNameColor(topThree[1]?.equipped_name_color)}
                          size="sm"
                        />
                      </p>
                      <div className="flex justify-center mt-0.5" aria-hidden="true">
                        <EquippedFlair flair={topThree[1]?.user_id === user?.id ? myCosmetics.flair : flairByUser[topThree[1]?.user_id ?? ""]} compact />
                      </div>
                      <p className="text-gray-300 font-bebas text-lg flex items-center justify-center gap-1" aria-hidden="true">
                        {isElo ? `${(topThree[1]?.elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" /> {formatCoins(topThree[1]?.coins_this_week ?? 0)}</>}
                      </p>
                      <span className="mt-1 text-[10px] bg-white/5 border border-gray-400/30 text-gray-300 px-2 py-0.5 rounded-full font-semibold tracking-wide" aria-hidden="true">SILVER · #2</span>
                    </div>
                  </div>

                  {/* 1st */}
                  <div
                    className="relative flex flex-col items-center"
                    role="group"
                    aria-label={`First place, Gold tier: ${topThree[0]?.username}, ${isElo ? `${(topThree[0]?.elo ?? 1000).toLocaleString()} Elo` : `${formatCoins(topThree[0]?.coins_this_week ?? 0)} Fangs`}`}
                  >
                    <div className="rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/15 to-transparent w-full pt-3 pb-4 px-2 flex flex-col items-center shadow-xl shadow-gold/10">
                      <div className="relative">
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 motion-safe:animate-float will-change-transform">
                          <Crown size={40} weight="fill" color="#FFD700" aria-hidden="true" />
                        </div>
                        <div className="rounded-full border-4 border-gold mb-2 shadow-xl shadow-gold/30" aria-hidden="true">
                          <Avatar
                            url={avatarFor(topThree[0]?.username, topThree[0]?.avatar_url)}
                            alt=""
                            size="lg"
                            frame={topThree[0]?.user_id === user?.id ? myCosmetics.frame : topThree[0]?.equipped_frame}
                            aura={topThree[0]?.user_id === user?.id ? myCosmetics.aura : topThree[0]?.equipped_avatar_aura}
                          />
                        </div>
                      </div>
                      <p className="text-gold text-sm font-bold text-center" aria-hidden="true">
                        <AnimatedUsername
                          username={topThree[0]?.username}
                          effect={topThree[0]?.user_id === user?.id ? myEffect : resolveRowUsernameEffect(topThree[0]?.equipped_username_effect)}
                          nameColor={topThree[0]?.user_id === user?.id ? myCosmetics.nameColor : resolveRowNameColor(topThree[0]?.equipped_name_color)}
                          size="sm"
                        />
                      </p>
                      <div className="flex justify-center mt-0.5" aria-hidden="true">
                        <EquippedFlair flair={topThree[0]?.user_id === user?.id ? myCosmetics.flair : flairByUser[topThree[0]?.user_id ?? ""]} compact />
                      </div>
                      <p className="text-gold font-bebas text-xl glow-gold flex items-center justify-center gap-1" aria-hidden="true">
                        {isElo ? `${(topThree[0]?.elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="" className="w-5 h-5 object-contain" /> {formatCoins(topThree[0]?.coins_this_week ?? 0)}</>}
                      </p>
                      <span className="mt-1 text-[10px] bg-gold/15 border border-gold/40 text-gold px-2 py-0.5 rounded-full font-bold tracking-wide" aria-hidden="true">GOLD · #1 GOAT</span>
                    </div>
                  </div>

                  {/* 3rd */}
                  <div
                    className="relative flex flex-col items-center pt-12"
                    role="group"
                    aria-label={`Third place, Bronze tier: ${topThree[2]?.username}, ${isElo ? `${(topThree[2]?.elo ?? 1000).toLocaleString()} Elo` : `${formatCoins(topThree[2]?.coins_this_week ?? 0)} Fangs`}`}
                  >
                    <div className="rounded-2xl border border-amber-600/30 bg-gradient-to-b from-amber-600/10 to-transparent w-full pt-3 pb-4 px-2 flex flex-col items-center">
                      <div className="mb-2"><Medal size={26} weight="fill" color="#B45309" aria-hidden="true" /></div>
                      <div className="mb-2 rounded-full border-2 border-amber-600 will-change-transform"
                        aria-hidden="true"
                        style={{ boxShadow: "0 0 14px #B4530944" }}>
                        <Avatar
                          url={avatarFor(topThree[2]?.username, topThree[2]?.avatar_url)}
                          alt=""
                          size="md"
                          frame={topThree[2]?.user_id === user?.id ? myCosmetics.frame : topThree[2]?.equipped_frame}
                          aura={topThree[2]?.user_id === user?.id ? myCosmetics.aura : topThree[2]?.equipped_avatar_aura}
                        />
                      </div>
                      <p className="text-cream text-xs font-bold text-center truncate w-full" aria-hidden="true">
                        <AnimatedUsername
                          username={topThree[2]?.username}
                          effect={topThree[2]?.user_id === user?.id ? myEffect : resolveRowUsernameEffect(topThree[2]?.equipped_username_effect)}
                          nameColor={topThree[2]?.user_id === user?.id ? myCosmetics.nameColor : resolveRowNameColor(topThree[2]?.equipped_name_color)}
                          size="sm"
                        />
                      </p>
                      <div className="flex justify-center mt-0.5" aria-hidden="true">
                        <EquippedFlair flair={topThree[2]?.user_id === user?.id ? myCosmetics.flair : flairByUser[topThree[2]?.user_id ?? ""]} compact />
                      </div>
                      <p className="text-amber-500 font-bebas text-lg flex items-center justify-center gap-1" aria-hidden="true">
                        {isElo ? `${(topThree[2]?.elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" /> {formatCoins(topThree[2]?.coins_this_week ?? 0)}</>}
                      </p>
                      <span className="mt-1 text-[10px] bg-amber-600/15 border border-amber-600/30 text-amber-500 px-2 py-0.5 rounded-full font-semibold tracking-wide" aria-hidden="true">BRONZE · #3</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Full list — a ranked ordered list; each row carries its full
                  standing in an aria-label so SR users get rank + name + score
                  + tier (tier is NOT conveyed by the color tint alone). */}
              <ol role="list" className="space-y-2 animate-slide-up list-none p-0 m-0" style={{ animationDelay: "0.3s" }}>
                {rows.map((entry, i) => {
                  const isMe = entry.user_id === user?.id;
                  const isTop = entry.rank <= 3;
                  const tier = isElo ? getEloTier(entry.elo ?? 1000) : null;
                  return (
                    <li key={entry.user_id}
                      aria-label={rowAriaLabel(entry, isMe)}
                      className={`fluid-card-hover flex items-center gap-4 p-4 rounded-xl border will-change-transform
                        ${isMe ? "border-electric/60 bg-electric/10 shadow-lg shadow-electric/15" : isTop ? "border-gold/30 bg-gold/5" : !isElo ? "border-electric/10 bg-navy-50 hover:border-electric/30" : ""}`}
                      style={{
                        animationDelay: `${i * 50}ms`,
                        ...(!isMe && !isTop && tier ? {
                          background: `linear-gradient(135deg, ${tier.color}14, ${tier.color}06)`,
                          borderColor: `${tier.color}33`,
                        } : {}),
                      }}>
                      <div className="w-10 flex-shrink-0 text-center flex items-center justify-center" aria-hidden="true">
                        {isTop ? renderRankIcon(entry.rank, 24)
                          : <span className={`font-bebas text-2xl leading-none ${isMe ? "text-electric" : "text-cream/60"}`}>{entry.rank}</span>}
                      </div>
                      <div className={`rounded-full border-2 flex-shrink-0
                        ${isMe ? "border-electric" : isTop ? "" : "border-electric/20"}`}
                        aria-hidden="true"
                        style={{
                          borderColor: isTop && !isMe ? rankBorderColor[entry.rank] : undefined,
                          boxShadow: isMe ? "0 0 16px rgba(0, 212, 255, 0.45)" : undefined,
                        }}>
                        <Avatar
                          url={avatarFor(entry.username, entry.avatar_url)}
                          alt=""
                          size="xs"
                          frame={isMe ? myCosmetics.frame : entry.equipped_frame}
                          aura={isMe ? myCosmetics.aura : entry.equipped_avatar_aura}
                        />
                      </div>
                      <div className="flex-1 min-w-0" aria-hidden="true">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-bold text-sm truncate ${isMe ? "text-electric" : "text-cream"}`}>
                            <AnimatedUsername
                              username={entry.username}
                              effect={isMe ? myEffect : resolveRowUsernameEffect(entry.equipped_username_effect)}
                              nameColor={isMe ? myCosmetics.nameColor : resolveRowNameColor(entry.equipped_name_color)}
                              size="sm"
                            />
                          </span>
                          {isMe && <span className="text-[10px] font-bold tracking-[0.16em] bg-electric/20 text-electric px-2 py-0.5 rounded-full border border-electric/40 uppercase">You</span>}
                          <EquippedFlair flair={isMe ? myCosmetics.flair : flairByUser[entry.user_id]} />
                          {tier && (
                            <span
                              className="text-[10px] font-semibold tracking-wide px-2 py-0.5 rounded-full border"
                              style={{
                                color: tier.color,
                                borderColor: `${tier.color}66`,
                                backgroundColor: `${tier.color}1A`,
                              }}
                            >
                              {tier.name}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-cream/60 inline-flex items-center gap-1 mt-0.5">
                          Lvl {entry.level} <span aria-hidden="true">·</span>
                          <Fire size={14} weight="fill" color="#F97316" aria-hidden="true" />
                          {entry.streak}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <div className="flex items-center gap-1.5" aria-hidden="true">
                          {!isElo && <img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" />}
                          <span className={`font-bebas text-xl ${entry.rank === 1 ? "text-gold glow-gold" : "text-cream"}`}>
                            {displayValue(entry)}
                          </span>
                        </div>
                        {!isMe && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/compete/arena/duel?challenge=${encodeURIComponent(entry.username)}`);
                            }}
                            className="w-11 h-11 rounded-lg flex items-center justify-center
                              bg-white/5 hover:bg-electric/15 border border-white/10 hover:border-electric/40
                              text-cream/60 hover:text-electric transition-all active:scale-95 will-change-transform
                              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                            aria-label={`Challenge ${entry.username} to a duel`}
                          >
                            <Sword size={18} weight="regular" color="currentColor" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>

              {/* Your position pinned card when off-screen in the long list */}
              {user && myEntry && myRank && myRank > 10 && (
                <div
                  className="mt-6 p-4 rounded-xl border border-electric/40 bg-electric/10 shadow-lg shadow-electric/10"
                  aria-label={`Your position: rank ${myRank}, ${isElo ? `${(myEntry.elo ?? 1000).toLocaleString()} Elo` : `${formatCoins(myEntry.coins_this_week)} Fangs`}`}
                >
                  <p className="text-electric text-[11px] font-bold uppercase tracking-[0.18em] text-center mb-2" aria-hidden="true">Your Position</p>
                  <div className="flex items-center justify-between" aria-hidden="true">
                    <span className="font-bebas text-2xl text-electric">#{myRank}</span>
                    <span className="text-gold font-bebas text-xl inline-flex items-center gap-1.5">
                      {!isElo && <img src={cdnUrl("/F.png")} alt="" className="w-4 h-4 object-contain" />}
                      {displayValue(myEntry)}
                    </span>
                  </div>
                  {personAboveMe && gapToAbove != null && (
                    <p className="mt-2 text-cream/60 text-xs text-center" aria-hidden="true">
                      {isElo ? `${gapToAbove.toLocaleString()} ELO` : `${formatCoins(gapToAbove)} Fangs`} from #{myRank - 1}
                    </p>
                  )}
                </div>
              )}

              {/* Pinned "you" row when the viewer isn't anywhere in the fetched
                  board (new user with no weekly earnings, or outside the top
                  200 on ELO tabs). Gold-tinted so it reads as your spot-in-waiting. */}
              {user && !myEntry && (
                <div className="mt-6 p-4 rounded-xl border border-gold/40 bg-gold/10 shadow-lg shadow-gold/10">
                  <p className="text-gold text-[11px] font-bold uppercase tracking-[0.18em] text-center mb-3">Your Position</p>
                  <div className="flex items-center gap-4">
                    <div className="w-10 flex-shrink-0 text-center" aria-hidden="true">
                      <span className="font-bebas text-2xl leading-none text-gold">&mdash;</span>
                    </div>
                    <div className="rounded-full border-2 border-gold flex-shrink-0"
                      aria-hidden="true"
                      style={{ boxShadow: "0 0 16px rgba(255, 215, 0, 0.35)" }}>
                      <Avatar url={user.avatar} alt="" size="xs" frame={myCosmetics.frame} aura={myCosmetics.aura} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-sm truncate text-cream">
                          <AnimatedUsername username={user.username} effect={myEffect} nameColor={myCosmetics.nameColor} size="sm" />
                        </span>
                        <span className="text-[10px] font-bold tracking-[0.16em] bg-gold/20 text-gold px-2 py-0.5 rounded-full border border-gold/40 uppercase">You</span>
                      </div>
                      <p className="text-xs text-cream/60">Unranked</p>
                    </div>
                    <button
                      onClick={() => router.push(isElo ? "/compete" : "/quiz")}
                      className="flex-shrink-0 inline-flex items-center gap-1.5 px-3 py-2 min-h-[44px] rounded-lg bg-gold text-navy text-xs font-bold shadow-lg shadow-gold/20 hover:brightness-110 transition-all active:scale-95 will-change-transform
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
                    >
                      {isElo
                        ? <><Sword size={14} weight="fill" color="currentColor" aria-hidden="true" /> Play a ranked match</>
                        : <><Brain size={14} weight="fill" color="currentColor" aria-hidden="true" /> Take a quiz to enter the board</>}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
          </div>
        </div>
      </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
