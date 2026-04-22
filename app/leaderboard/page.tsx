"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getLeaderboard, getEloLeaderboard } from "@/lib/db";
import { formatCoins } from "@/lib/mockData";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";
import { Crown, Medal, Sword, TrendUp, Trophy, Brain, Fire } from "@phosphor-icons/react";

type Filter = "elo" | "weekly";

interface LbEntry {
  rank: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  level: number;
  streak: number;
  coins_this_week: number;
  arena_elo?: number;
}

export default function LeaderboardPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [filter, setFilter] = useState<Filter>("elo");
  const [entries, setEntries] = useState<LbEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    if (filter === "elo") {
      getEloLeaderboard(200).then(data => {
        setEntries(data.map(d => ({ ...d, streak: 0, coins_this_week: 0 })));
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
  const rest = entries.slice(3);

  const rankBorderColor: Record<number, string> = { 1: "#FFD700", 2: "#9CA3AF", 3: "#B45309" };

  const renderRankIcon = (rank: number, size: number) => {
    if (rank === 1) return <Crown size={size} weight="fill" color="#FFD700" aria-hidden="true" />;
    if (rank === 2) return <Medal size={size} weight="fill" color="#9CA3AF" aria-hidden="true" />;
    if (rank === 3) return <Medal size={size} weight="fill" color="#B45309" aria-hidden="true" />;
    return null;
  };

  // Display value based on current filter mode
  const displayValue = (entry: LbEntry) =>
    filter === "elo" ? `${(entry.arena_elo ?? 1000).toLocaleString()} ELO` : formatCoins(entry.coins_this_week);

  const myEntry = entries.find(e => e.user_id === user?.id);
  const myRank = myEntry ? entries.indexOf(myEntry) + 1 : null;

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-20">
        <div className="max-w-3xl mx-auto px-4 py-10">
          <BackButton />

          {/* Header */}
          <div className="text-center mb-10 animate-slide-up">
            <span className="inline-flex items-center gap-2 bg-gold/10 border border-gold/30 rounded-full px-4 py-1.5 text-gold text-sm font-semibold mb-6">
              <Crown size={16} weight="fill" color="currentColor" aria-hidden="true" />
              {filter === "elo" ? "ELO Rankings" : "Weekly Rankings"}
            </span>
            <h1 className="font-bebas text-6xl sm:text-7xl text-cream tracking-wider mb-3">LEADERBOARD</h1>
            <p className="text-cream/50 text-base">Top earners reset every Sunday midnight.</p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-2 bg-navy-50 border border-electric/20 rounded-xl p-1.5 mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            {[
              { key: "elo" as const, label: "ELO Ranking", Icon: Sword },
              { key: "weekly" as const, label: "Weekly Fangs", Icon: TrendUp },
            ].map((tab) => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                className={`flex-1 py-2.5 rounded-lg text-sm font-semibold transition-all duration-200 inline-flex items-center justify-center gap-2
                  ${filter === tab.key ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream hover:bg-white/5"}`}>
                <tab.Icon size={16} weight={filter === tab.key ? "fill" : "regular"} color="currentColor" aria-hidden="true" />
                {tab.label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-3">
              {[1,2,3,4,5].map(i => <div key={i} className="h-16 rounded-xl bg-white/5 animate-pulse" />)}
            </div>
          ) : entries.length === 0 ? (
            <div className="card text-center py-16">
              <div className="flex justify-center mb-4">
                <Trophy size={52} weight="fill" color="#FFD700" aria-hidden="true" />
              </div>
              <p className="font-bebas text-3xl text-cream tracking-wider mb-2">No rankings yet</p>
              <p className="text-cream/40 text-sm mb-6">Be the first to earn coins and claim the #1 spot!</p>
              <a href="/quiz"><button className="btn-gold px-8 py-3 inline-flex items-center gap-2">
                <Brain size={16} weight="fill" color="currentColor" aria-hidden="true" />
                Take a Quiz
              </button></a>
            </div>
          ) : (
            <>
              {/* Podium */}
              {topThree.length >= 3 && (
                <div className="grid grid-cols-3 gap-3 mb-8 animate-slide-up" style={{ animationDelay: "0.2s" }}>
                  {/* 2nd */}
                  <div className="flex flex-col items-center pt-6">
                    <div className="mb-2"><Medal size={32} weight="fill" color="#9CA3AF" aria-hidden="true" /></div>
                    <div className="w-14 h-14 rounded-full overflow-hidden border-2 border-gray-400 mb-2"
                      style={{ boxShadow: "0 0 15px #9CA3AF40" }}>
                      <img src={topThree[1]?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${topThree[1]?.username}`}
                        alt="" className="w-full h-full object-cover bg-navy-50" />
                    </div>
                    <p className="text-cream text-xs font-bold text-center truncate w-full text-center">{topThree[1]?.username}</p>
                    <p className="text-gray-300 font-bebas text-lg flex items-center justify-center gap-1">{filter === "elo" ? `${(topThree[1]?.arena_elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" /> {formatCoins(topThree[1]?.coins_this_week ?? 0)}</>}</p>
                  </div>

                  {/* 1st */}
                  <div className="flex flex-col items-center">
                    <div className="relative">
                      <div className="absolute -top-6 left-1/2 -translate-x-1/2 animate-float"><Crown size={40} weight="fill" color="#FFD700" aria-hidden="true" /></div>
                      <div className="w-20 h-20 rounded-full overflow-hidden border-4 border-gold mb-2 shadow-xl shadow-gold/30">
                        <img src={topThree[0]?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${topThree[0]?.username}`}
                          alt="" className="w-full h-full object-cover bg-navy-50" />
                      </div>
                    </div>
                    <p className="text-gold text-sm font-bold text-center">{topThree[0]?.username}</p>
                    <p className="text-gold font-bebas text-xl glow-gold flex items-center justify-center gap-1">{filter === "elo" ? `${(topThree[0]?.arena_elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" /> {formatCoins(topThree[0]?.coins_this_week ?? 0)}</>}</p>
                    <span className="text-xs bg-gold/15 border border-gold/30 text-gold px-2 py-0.5 rounded-full mt-1">#1 GOAT</span>
                  </div>

                  {/* 3rd */}
                  <div className="flex flex-col items-center pt-10">
                    <div className="mb-2"><Medal size={32} weight="fill" color="#B45309" aria-hidden="true" /></div>
                    <div className="w-12 h-12 rounded-full overflow-hidden border-2 border-amber-600 mb-2">
                      <img src={topThree[2]?.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${topThree[2]?.username}`}
                        alt="" className="w-full h-full object-cover bg-navy-50" />
                    </div>
                    <p className="text-cream text-xs font-bold text-center truncate w-full text-center">{topThree[2]?.username}</p>
                    <p className="text-amber-600 font-bebas text-lg flex items-center justify-center gap-1">{filter === "elo" ? `${(topThree[2]?.arena_elo ?? 1000).toLocaleString()} ELO` : <><img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" /> {formatCoins(topThree[2]?.coins_this_week ?? 0)}</>}</p>
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
                      className={`flex items-center gap-4 p-4 rounded-xl border transition-all duration-300 hover:-translate-y-0.5
                        ${isMe ? "border-electric/50 bg-electric/10" : isTop ? "border-gold/30 bg-gold/5" : "border-electric/10 bg-navy-50 hover:border-electric/30"}`}
                      style={{ animationDelay: `${i * 50}ms` }}>
                      <div className="w-10 flex-shrink-0 text-center flex items-center justify-center">
                        {isTop ? renderRankIcon(entry.rank, 24)
                          : <span className={`font-bebas text-2xl leading-none ${isMe ? "text-electric" : "text-cream/50"}`}>{entry.rank}</span>}
                      </div>
                      <div className={`w-10 h-10 rounded-full overflow-hidden border-2 flex-shrink-0
                        ${isMe ? "border-electric" : isTop ? "" : "border-electric/20"}`}
                        style={{ borderColor: isTop && !isMe ? rankBorderColor[entry.rank] : undefined }}>
                        <img src={entry.avatar_url ?? `https://api.dicebear.com/7.x/avataaars/svg?seed=${entry.username}&backgroundColor=4A90D9`}
                          alt={entry.username} className="w-full h-full object-cover bg-navy-50" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`font-bold text-sm truncate ${isMe ? "text-electric" : "text-cream"}`}>{entry.username}</span>
                          {isMe && <span className="text-xs bg-electric/20 text-electric px-2 py-0.5 rounded-full border border-electric/30">You</span>}
                        </div>
                        <p className="text-xs text-cream/40 inline-flex items-center gap-1">
                          Lvl {entry.level} <span aria-hidden="true">·</span>
                          <Fire size={14} weight="fill" color="#F97316" aria-hidden="true" />
                          {entry.streak}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0 flex items-center gap-2">
                        <div className="flex items-center gap-1.5">
                          {filter !== "elo" && <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />}
                          <span className={`font-bebas text-xl ${entry.rank === 1 ? "text-gold glow-gold" : "text-cream"}`}>
                            {displayValue(entry)}
                          </span>
                        </div>
                        {/* Challenge button — not on own row */}
                        {!isMe && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/arena?challenge=${encodeURIComponent(entry.username)}`);
                            }}
                            className="w-8 h-8 rounded-lg flex items-center justify-center
                              bg-white/5 hover:bg-electric/15 border border-white/10 hover:border-electric/40
                              text-cream/40 hover:text-electric transition-all active:scale-95"
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

              {/* Your position if not in top list */}
              {user && myEntry && myRank && myRank > 10 && (
                <div className="mt-6 p-4 rounded-xl border border-electric/40 bg-electric/10">
                  <p className="text-electric text-sm font-semibold text-center mb-2">Your Position</p>
                  <div className="flex items-center justify-between">
                    <span className="font-bebas text-2xl text-electric">#{myRank}</span>
                    <span className="text-gold font-semibold">{displayValue(myEntry)}</span>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
