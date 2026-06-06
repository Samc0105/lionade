"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getLeaderboard, getLadderLeaderboard, type EloLadder } from "@/lib/db";
import { formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";
import { avatarFor } from "@/lib/avatar";
import { Crown, Medal, Sword, TrendUp, Trophy, Brain, Fire, Crosshair, UsersThree, ArrowUp } from "@phosphor-icons/react";
import AnimatedUsername from "@/components/AnimatedUsername";
import { resolveRowUsernameEffect, useEquippedUsernameEffect } from "@/lib/use-username-effect";

type Filter = "duel" | "competitive" | "squad" | "weekly";

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
}

export default function LeaderboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const myEffect = useEquippedUsernameEffect();
  const [filter, setFilter] = useState<Filter>("duel");
  const [entries, setEntries] = useState<LbEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const isElo = filter !== "weekly";

  useEffect(() => {
    setLoading(true);
    if (filter !== "weekly") {
      getLadderLeaderboard(LADDER_FOR[filter], 200).then(data => {
        setEntries(data.map(d => ({
          rank: d.rank,
          user_id: d.user_id,
          username: d.username,
          avatar_url: d.avatar_url,
          level: d.level,
          streak: d.streak,
          coins_this_week: 0,
          elo: d.elo,
        })));
        setLoading(false);
      }).catch(() => setLoading(false));
    } else {
      getLeaderboard(200).then(data => {
        setEntries(data);
        setLoading(false);
      }).catch(() => setLoading(false));
    }
  }, [filter]);

  const topThree = entries.slice(0, 3);

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

  const myEntry = entries.find(e => e.user_id === user?.id);
  const myRank = myEntry ? entries.indexOf(myEntry) + 1 : null;
  const personAboveMe = myRank && myRank > 1 ? entries[myRank - 2] : null;
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
      <div className="min-h-screen pt-20">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <BackButton />

          {/* Header */}
          <div className="text-center mb-10 animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-electric/10 border border-electric/30 rounded-full px-3 py-1 text-electric text-[11px] font-semibold uppercase tracking-[0.18em] mb-4">
              <span className="relative inline-flex w-2 h-2">
                <span className="absolute inline-flex w-full h-full rounded-full bg-electric opacity-60 animate-ping" />
                <span className="relative inline-flex w-2 h-2 rounded-full bg-electric" />
              </span>
              Live Ladder
            </span>
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider mb-3">LEADERBOARD</h1>
            <span className="inline-flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-full px-4 py-1.5 text-gold text-sm font-semibold mb-3">
              <Crown size={16} weight="fill" color="currentColor" aria-hidden="true" />
              {filterLabel}
            </span>
            <p className="text-cream/50 text-base">
              {isElo ? "Ranked by Elo across the season." : "Top earners reset every Sunday midnight."}
            </p>
          </div>

          {/* Filters */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 bg-navy-50 border border-electric/20 rounded-xl p-1.5 mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            {[
              { key: "duel" as const, label: "Quiz Duel", Icon: Sword },
              { key: "competitive" as const, label: "Competitive", Icon: Crosshair },
              { key: "squad" as const, label: "Squad", Icon: UsersThree },
              { key: "weekly" as const, label: "Weekly Fangs", Icon: TrendUp },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                className={`py-2.5 px-2 rounded-lg text-sm font-semibold transition-all duration-200 inline-flex items-center justify-center gap-1.5
                  ${filter === tab.key ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream hover:bg-white/5"}`}>
                <tab.Icon size={16} weight={filter === tab.key ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Overtake hero callout — visible above podium when user is logged in
              and ranked. Creates a direct competitive prompt. */}
          {!loading && user && myEntry && myRank && personAboveMe && (
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
                        size="sm"
                      />
                    </span>{" "}
                    to take <span className="font-bebas text-xl text-gold align-middle">#{myRank - 1}</span>
                    {gapToAbove != null && gapToAbove > 0 && (
                      <span className="text-cream/50 text-xs sm:text-sm">
                        {" "}{isElo ? `· ${gapToAbove.toLocaleString()} ELO away` : `· ${formatCoins(gapToAbove)} away`}
                      </span>
                    )}
                  </p>
                </div>
                {filter === "duel" && (
                  <button
                    onClick={() => router.push(`/compete/arena/duel?challenge=${encodeURIComponent(personAboveMe.username)}`)}
                    className="hidden sm:inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-electric text-white text-sm font-semibold shadow-lg shadow-electric/30 hover:brightness-110 transition-all active:scale-95 will-change-transform"
                  >
                    <Sword size={14} weight="fill" color="currentColor" aria-hidden="true" />
                    Challenge
                  </button>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="card text-center py-16">
              <div className="flex justify-center mb-4">
                <Trophy size={52} weight="fill" color="#FFD700" aria-hidden="true" />
              </div>
              <p className="font-bebas text-3xl text-cream tracking-wider mb-2">Be the first on the board</p>
              <p className="text-cream/40 text-sm mb-6">Take a quiz, earn Fangs, and claim the #1 spot.</p>
              <a href="/quiz"><button className="btn-gold px-8 py-3 inline-flex items-center gap-2">
                <Brain size={16} weight="fill" color="currentColor" aria-hidden="true" />
                Take a Quiz
              </button></a>
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
                  <div className="relative flex flex-col items-center pt-8">
                    <div className="rounded-2xl border border-gray-400/30 bg-gradient-to-b from-gray-400/10 to-transparent w-full pt-3 pb-4 px-2 flex flex-col items-center">
                      <div className="mb-2"><Medal size={28} weight="fill" color="#9CA3AF" aria-hidden="true" /></div>
                      <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-gray-400 mb-2 will-change-transform"
                        aria-label={topThree[1]?.username ? `${topThree[1]?.username}'s avatar` : undefined}
                        style={{ boxShadow: "0 0 18px #9CA3AF55" }}>
                        <img src={avatarFor(topThree[1]?.username, topThree[1]?.avatar_url)} alt={topThree[1]?.username ?? ""} className="w-14 h-14 rounded-full object-cover" />
                      </div>
                      <p className="text-cream text-xs font-bold text-center truncate w-full">
                        <AnimatedUsername
                          username={topThree[1]?.username}
                          effect={topThree[1]?.user_id === user?.id ? myEffect : resolveRowUsernameEffect(topThree[1]?.equipped_username_effect)}
                          size="sm"
                        />
                      </p>
                      <p className="text-gray-300 font-bebas text-lg flex items-center justify-center gap-1">
                        {isElo ? `${(topThree[1]?.elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" /> {formatCoins(topThree[1]?.coins_this_week ?? 0)}</>}
                      </p>
                      <span className="mt-1 text-[10px] bg-white/5 border border-gray-400/30 text-gray-300 px-2 py-0.5 rounded-full font-semibold tracking-wide">SILVER · #2</span>
                    </div>
                  </div>

                  {/* 1st */}
                  <div className="relative flex flex-col items-center">
                    <div className="rounded-2xl border border-gold/40 bg-gradient-to-b from-gold/15 to-transparent w-full pt-3 pb-4 px-2 flex flex-col items-center shadow-xl shadow-gold/10">
                      <div className="relative">
                        <div className="absolute -top-6 left-1/2 -translate-x-1/2 animate-float will-change-transform">
                          <Crown size={40} weight="fill" color="#FFD700" aria-hidden="true" />
                        </div>
                        <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-gold mb-2 shadow-xl shadow-gold/30"
                          aria-label={topThree[0]?.username ? `${topThree[0]?.username}'s avatar` : undefined}>
                          <img src={avatarFor(topThree[0]?.username, topThree[0]?.avatar_url)} alt={topThree[0]?.username ?? ""} className="w-20 h-20 rounded-full object-cover" />
                        </div>
                      </div>
                      <p className="text-gold text-sm font-bold text-center">
                        <AnimatedUsername
                          username={topThree[0]?.username}
                          effect={topThree[0]?.user_id === user?.id ? myEffect : resolveRowUsernameEffect(topThree[0]?.equipped_username_effect)}
                          size="sm"
                        />
                      </p>
                      <p className="text-gold font-bebas text-xl glow-gold flex items-center justify-center gap-1">
                        {isElo ? `${(topThree[0]?.elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(topThree[0]?.coins_this_week ?? 0)}</>}
                      </p>
                      <span className="mt-1 text-[10px] bg-gold/15 border border-gold/40 text-gold px-2 py-0.5 rounded-full font-bold tracking-wide">GOLD · #1 GOAT</span>
                    </div>
                  </div>

                  {/* 3rd */}
                  <div className="relative flex flex-col items-center pt-12">
                    <div className="rounded-2xl border border-amber-600/30 bg-gradient-to-b from-amber-600/10 to-transparent w-full pt-3 pb-4 px-2 flex flex-col items-center">
                      <div className="mb-2"><Medal size={26} weight="fill" color="#B45309" aria-hidden="true" /></div>
                      <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-amber-600 mb-2 will-change-transform"
                        aria-label={topThree[2]?.username ? `${topThree[2]?.username}'s avatar` : undefined}
                        style={{ boxShadow: "0 0 14px #B4530944" }}>
                        <img src={avatarFor(topThree[2]?.username, topThree[2]?.avatar_url)} alt={topThree[2]?.username ?? ""} className="w-12 h-12 rounded-full object-cover" />
                      </div>
                      <p className="text-cream text-xs font-bold text-center truncate w-full">
                        <AnimatedUsername
                          username={topThree[2]?.username}
                          effect={topThree[2]?.user_id === user?.id ? myEffect : resolveRowUsernameEffect(topThree[2]?.equipped_username_effect)}
                          size="sm"
                        />
                      </p>
                      <p className="text-amber-500 font-bebas text-lg flex items-center justify-center gap-1">
                        {isElo ? `${(topThree[2]?.elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" /> {formatCoins(topThree[2]?.coins_this_week ?? 0)}</>}
                      </p>
                      <span className="mt-1 text-[10px] bg-amber-600/15 border border-amber-600/30 text-amber-500 px-2 py-0.5 rounded-full font-semibold tracking-wide">BRONZE · #3</span>
                    </div>
                  </div>
                </div>
              )}

              {/* Full list */}
              <div className="space-y-2 animate-slide-up" style={{ animationDelay: "0.3s" }}>
                {entries.map((entry, i) => {
                  const isMe = entry.user_id === user?.id;
                  const isTop = entry.rank <= 3;
                  return (
                    <div key={entry.user_id}
                      className={`fluid-card-hover flex items-center gap-4 p-4 rounded-xl border will-change-transform
                        ${isMe ? "border-electric/60 bg-electric/10 shadow-lg shadow-electric/15" : isTop ? "border-gold/30 bg-gold/5" : !isElo ? "border-electric/10 bg-navy-50 hover:border-electric/30" : ""}`}
                      style={{
                        animationDelay: `${i * 50}ms`,
                        ...(!isMe && !isTop && isElo ? (() => {
                          const tier = getEloTier(entry.elo ?? 1000);
                          return {
                            background: `linear-gradient(135deg, ${tier.color}14, ${tier.color}06)`,
                            borderColor: `${tier.color}33`,
                          };
                        })() : {}),
                      }}>
                      <div className="w-10 flex-shrink-0 text-center flex items-center justify-center">
                        {isTop ? renderRankIcon(entry.rank, 24)
                          : <span className={`font-bebas text-2xl leading-none ${isMe ? "text-electric" : "text-cream/50"}`}>{entry.rank}</span>}
                      </div>
                      <div className={`w-10 h-10 rounded-full overflow-hidden border-2 flex-shrink-0
                        ${isMe ? "border-electric" : isTop ? "" : "border-electric/20"}`}
                        aria-label={`${entry.username}'s avatar`}
                        style={{
                          borderColor: isTop && !isMe ? rankBorderColor[entry.rank] : undefined,
                          boxShadow: isMe ? "0 0 16px rgba(0, 212, 255, 0.45)" : undefined,
                        }}>
                        <img src={avatarFor(entry.username, entry.avatar_url)} alt={entry.username} className="w-10 h-10 rounded-full object-cover" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-sm truncate ${isMe ? "text-electric" : "text-cream"}`}>
                            <AnimatedUsername
                              username={entry.username}
                              effect={isMe ? myEffect : resolveRowUsernameEffect(entry.equipped_username_effect)}
                              size="sm"
                            />
                          </span>
                          {isMe && <span className="text-[10px] font-bold tracking-[0.16em] bg-electric/20 text-electric px-2 py-0.5 rounded-full border border-electric/40 uppercase">You</span>}
                        </div>
                        <p className="text-xs text-cream/40 inline-flex items-center gap-1">
                          Lvl {entry.level} <span aria-hidden="true">·</span>
                          <Fire size={14} weight="fill" color="#F97316" aria-hidden="true" />
                          {entry.streak}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          {!isElo && <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />}
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
                            className="w-8 h-8 rounded-lg flex items-center justify-center
                              bg-white/5 hover:bg-electric/15 border border-white/10 hover:border-electric/40
                              text-cream/40 hover:text-electric transition-all active:scale-95 will-change-transform"
                            title={`Challenge ${entry.username}`}
                            aria-label={`Challenge ${entry.username} to a duel`}
                          >
                            <Sword size={16} weight="regular" color="currentColor" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Your position pinned card when off-screen in the long list */}
              {user && myEntry && myRank && myRank > 10 && (
                <div className="mt-6 p-4 rounded-xl border border-electric/40 bg-electric/10 shadow-lg shadow-electric/10">
                  <p className="text-electric text-[11px] font-bold uppercase tracking-[0.18em] text-center mb-2">Your Position</p>
                  <div className="flex items-center justify-between">
                    <span className="font-bebas text-2xl text-electric">#{myRank}</span>
                    <span className="text-gold font-bebas text-xl inline-flex items-center gap-1.5">
                      {!isElo && <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />}
                      {displayValue(myEntry)}
                    </span>
                  </div>
                  {personAboveMe && gapToAbove != null && (
                    <p className="mt-2 text-cream/60 text-xs text-center">
                      {isElo ? `${gapToAbove.toLocaleString()} ELO` : `${formatCoins(gapToAbove)} Fangs`} from #{myRank - 1}
                    </p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
