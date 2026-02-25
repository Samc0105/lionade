"use client";

import Link from "next/link";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";

/* ── Tier definitions (bottom → top) ── */
const TIERS = [
  { name: "BRONZE", color: "#CD7F32", range: "0–99 wins", tagline: "Freshman", icon: "🥉" },
  { name: "SILVER", color: "#C0C0C0", range: "100–249 wins", tagline: "Scholar", icon: "🥈" },
  { name: "GOLD", color: "#FFD700", range: "250–499 wins", tagline: "Honor Roll", icon: "🥇" },
  { name: "PLATINUM", color: "#00CED1", range: "500–999 wins", tagline: "Dean's List", icon: "💎" },
  { name: "DIAMOND", color: "#B9F2FF", range: "1,000–1,999 wins", tagline: "Valedictorian", icon: "💠" },
  { name: "ONYX", color: "#1A1A2E", textColor: "#C0C0D0", glowColor: "#C0C0D0", range: "2,000–3,499 wins", tagline: "Prodigy", icon: "🖤" },
  { name: "RUBY", color: "#E0115F", range: "3,500–4,999 wins", tagline: "Olympiad", icon: "❤️‍🔥" },
  { name: "EMERALD", color: "#50C878", range: "5,000–7,499 wins", tagline: "Mastermind", icon: "👑" },
  { name: "LEGEND", color: "legend", range: "7,500+ wins", tagline: "Immortal", icon: "⚡" },
];

const TIER_WIDTHS = ["32%", "40%", "48%", "56%", "64%", "72%", "80%", "90%", "100%"];

/* ── Hex stat config ── */
const HEX_STATS = [
  { label: "Your Rank", value: "Unranked", color: "#FFD700", achieved: false },
  { label: "Wins", value: "0", color: "#22C55E", achieved: false },
  { label: "Win Streak", value: "0", color: "#F97316", achieved: false },
  { label: "Goal", value: "Top 10%", color: "#4A90D9", achieved: false },
];

const CURRENT_TIER_INDEX = 0;
const DISPLAY_NAME = "Player";

export default function CompetePage() {
  const tiersTopDown = [...TIERS].reverse();
  const widthsTopDown = [...TIER_WIDTHS];

  return (
    <ProtectedRoute>
      <div className="relative min-h-screen bg-navy pt-16 pb-20 md:pb-8 overflow-hidden">
        {/* ═══ Animated Background ═══ */}
        <div className="arena-bg" />
        {/* Extra ambient glow orbs */}
        <div className="absolute top-[15%] left-[20%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #EF4444 0%, transparent 70%)" }} />
        <div className="absolute bottom-[20%] right-[15%] w-[400px] h-[400px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #FFD700 0%, transparent 70%)" }} />
        <div className="absolute top-[60%] left-[50%] w-[600px] h-[600px] -translate-x-1/2 rounded-full pointer-events-none opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }} />

        <div className="relative z-10 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackButton />

          {/* ═══ 1. PRIZE POOL BANNER ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0s" }}>
            <div className="relative overflow-hidden rounded-2xl clip-banner"
              style={{
                background: "linear-gradient(135deg, #1a1400 0%, #0f0a00 30%, #080600 60%, #04080F 100%)",
                border: "1px solid rgba(255,215,0,0.2)",
                boxShadow: "0 0 40px rgba(255,215,0,0.08), inset 0 1px 0 rgba(255,215,0,0.1)",
              }}>
              {/* Gold particles */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                {[
                  { left: "10%", bottom: "20%", delay: "0s", dur: "3.5s" },
                  { left: "25%", bottom: "10%", delay: "0.8s", dur: "4s" },
                  { left: "45%", bottom: "15%", delay: "1.5s", dur: "3.2s" },
                  { left: "60%", bottom: "25%", delay: "0.3s", dur: "4.5s" },
                  { left: "75%", bottom: "12%", delay: "2s", dur: "3.8s" },
                  { left: "88%", bottom: "18%", delay: "1.2s", dur: "4.2s" },
                  { left: "35%", bottom: "30%", delay: "2.5s", dur: "3s" },
                  { left: "55%", bottom: "5%", delay: "0.6s", dur: "4.8s" },
                ].map((p, i) => (
                  <div key={i} className="gold-particle"
                    style={{ left: p.left, bottom: p.bottom, animationDelay: p.delay, animationDuration: p.dur }} />
                ))}
              </div>

              <div className="relative px-6 py-10 sm:py-14 text-center">
                <div className="gold-shimmer-wrap">
                  <p className="gold-text glow-gold font-bebas text-6xl sm:text-8xl tracking-wider leading-none">
                    🪙 50,000
                  </p>
                </div>
                <p className="font-bebas text-2xl sm:text-4xl text-cream tracking-[0.2em] mt-2">
                  MONTHLY COIN POOL
                </p>
                <p className="text-cream/50 text-sm mt-3 max-w-md mx-auto">
                  Top 20 verified players split the pot every month.
                </p>

                {/* Prize breakdown */}
                <div className="flex flex-wrap justify-center gap-x-3 gap-y-1.5 mt-5 text-cream/50 text-xs font-semibold uppercase tracking-wider">
                  <span className="text-gold/80">🥇 1st — 25%</span>
                  <span className="text-cream/15">|</span>
                  <span className="text-cream/60">🥈 2nd — 15%</span>
                  <span className="text-cream/15">|</span>
                  <span className="text-cream/50">🥉 3rd — 10%</span>
                  <span className="text-cream/15">|</span>
                  <span>4th-10th — 5% ea</span>
                  <span className="text-cream/15">|</span>
                  <span>11th-20th — share rest</span>
                </div>

                {/* Verified badge */}
                <div className="mt-5 inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-green-500/30 bg-green-500/10 text-green-400 text-[10px] font-bold uppercase tracking-widest">
                  <span>✅</span> Verified players eligible for bonus rewards
                </div>

                <p className="text-cream/25 text-xs mt-4">
                  Coin rewards active at launch. Cash payouts begin V2 — December 2026.
                </p>
              </div>
            </div>
          </div>

          {/* ═══ 2. HEXAGONAL STATS BAR ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.05s" }}>
            {/* Desktop: horizontal row with energy lines */}
            <div className="hidden sm:flex justify-center items-center gap-0">
              {HEX_STATS.map((stat, i) => (
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
                      <p className={`text-[8px] font-bold uppercase tracking-widest mt-1 ${stat.achieved ? "text-cream/40" : "text-gray-700"}`}>
                        {stat.label}
                      </p>
                    </div>
                    {i === 0 && (
                      <div className="mt-2 w-20">
                        <div className="text-[9px] text-cream/30 text-center mb-1">Play 5 matches</div>
                        <div className="h-1.5 rounded-full bg-cream/[0.07] overflow-hidden">
                          <div className="h-full w-0 bg-gradient-to-r from-gold/60 to-gold rounded-full" />
                        </div>
                        <div className="text-[9px] text-cream/20 text-center mt-0.5">0 / 5</div>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Mobile: 2x2 grid */}
            <div className="grid grid-cols-2 gap-4 sm:hidden">
              {HEX_STATS.map((stat, i) => (
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
                    <p className={`text-[8px] font-bold uppercase tracking-widest mt-0.5 ${stat.achieved ? "text-cream/40" : "text-gray-700"}`}>
                      {stat.label}
                    </p>
                  </div>
                  {i === 0 && (
                    <div className="mt-1.5 w-16">
                      <div className="text-[8px] text-cream/30 text-center mb-0.5">Play 5 matches</div>
                      <div className="h-1 rounded-full bg-cream/10 overflow-hidden">
                        <div className="h-full w-0 bg-gold rounded-full" />
                      </div>
                      <div className="text-[8px] text-cream/20 text-center mt-0.5">0/5</div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* ═══ 3. ARENA HEADLINE ═══ */}
          <div className="text-center mb-10 animate-slide-up" style={{ animationDelay: "0.1s" }}>
            <h1 className="font-bebas text-6xl sm:text-8xl chrome-text tracking-wider leading-none">
              ⚔️ ARENA
            </h1>
            <p className="text-cream/40 text-sm sm:text-base mt-2 max-w-lg mx-auto">
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
                  ⚔️ MOST POPULAR
                </div>

                <div className="relative p-7 sm:p-10">
                  <p className="text-5xl mb-4">⚔️</p>
                  <p className="font-bebas text-4xl sm:text-5xl tracking-wider text-[#EF4444] mb-3"
                    style={{ textShadow: "0 0 20px rgba(239,68,68,0.3)" }}>
                    1v1 DUEL
                  </p>
                  <p className="text-cream/60 text-sm sm:text-base leading-relaxed max-w-xl mb-2">
                    Challenge anyone to a head-to-head battle. Same 10 questions. 15 seconds each.
                    Speed bonus for fast answers. Winner takes the wagered coins.
                  </p>
                  <p className="text-cream/30 text-xs mb-6">
                    🪙 Wager: 10–100 coins
                  </p>
                  <div className="flex flex-wrap gap-3 mb-6">
                    <Link href="/duel" className="btn-gold text-sm px-6 py-3 rounded-xl">
                      🎯 Find Opponent
                    </Link>
                    <Link href="/duel" className="btn-outline text-sm px-6 py-3 rounded-xl">
                      👥 Challenge Friend
                    </Link>
                  </div>
                  <p className="text-cream/20 text-xs">
                    Wins count toward your monthly ranking and Elo rating
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ 5. BLITZ + LEADERBOARD — Side by Side ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.2s" }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              {/* Blitz */}
              <div className="glow-yellow rounded-2xl tilt-card">
                <div className="relative overflow-hidden h-full rounded-2xl clip-angled-br"
                  style={{
                    background: "linear-gradient(135deg, #1a1400 0%, #0f0a00 30%, #080600 50%, #060c18 100%)",
                    border: "1px solid rgba(234,179,8,0.25)",
                  }}>
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: "radial-gradient(ellipse at 30% 30%, rgba(234,179,8,0.06) 0%, transparent 60%)" }} />
                  <div className="ribbon-diagonal">SOON</div>
                  <div className="relative p-7">
                    <p className="text-4xl mb-3">⚡</p>
                    <p className="font-bebas text-2xl sm:text-3xl tracking-wider text-[#EAB308] mb-2"
                      style={{ textShadow: "0 0 15px rgba(234,179,8,0.2)" }}>
                      BLITZ MODE
                    </p>
                    <p className="text-cream/50 text-sm leading-relaxed mb-4">
                      Speed round. 60 seconds. Unlimited questions. 2x coins on every correct answer.
                    </p>
                    <p className="text-cream/30 text-xs font-semibold uppercase tracking-wider">
                      Coming V1 — Summer 2026
                    </p>
                  </div>
                </div>
              </div>

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
                    <p className="text-4xl mb-3">👑</p>
                    <p className="font-bebas text-2xl sm:text-3xl tracking-wider text-[#A855F7] mb-4"
                      style={{ textShadow: "0 0 15px rgba(168,85,247,0.2)" }}>
                      LEADERBOARD
                    </p>
                    <div className="space-y-2 mb-4">
                      {[
                        { rank: 1, medal: "🥇", name: "LionKing", elo: "1,847" },
                        { rank: 2, medal: "🥈", name: "QuizNinja", elo: "1,756" },
                        { rank: 3, medal: "🥉", name: "BrainStorm", elo: "1,702" },
                        { rank: 4, medal: "", name: "GrindMaster", elo: "1,654" },
                        { rank: 5, medal: "", name: "StudyBeast", elo: "1,621" },
                      ].map((player) => (
                        <div key={player.rank}
                          className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
                          style={{
                            background: player.rank <= 3
                              ? "linear-gradient(135deg, rgba(168,85,247,0.08) 0%, rgba(168,85,247,0.02) 100%)"
                              : "rgba(255,255,255,0.02)",
                            border: "1px solid rgba(168,85,247,0.1)",
                          }}>
                          <span className="font-bebas text-sm text-cream/40 w-5">#{player.rank}</span>
                          <span className="text-cream/60 text-xs flex-1 font-medium">
                            {player.medal && <span className="mr-1">{player.medal}</span>}
                            {player.name}
                          </span>
                          <span className="font-bebas text-xs text-cream/30">{player.elo} Elo</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-cream/10 pt-3 mb-4">
                      <p className="text-cream/30 text-xs">
                        Your Rank: <span className="text-cream/50 font-semibold">Unranked</span>
                      </p>
                    </div>
                    <Link href="/leaderboard"
                      className="text-[#A855F7] text-sm font-semibold hover:text-[#C084FC] transition-colors inline-flex items-center gap-1">
                      View Full Leaderboard <span className="text-base">&rarr;</span>
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
                    🏆 WEEKLY TOURNAMENT
                  </p>
                  <p className="text-cream/50 text-sm sm:text-base leading-relaxed mb-6 max-w-xl">
                    Squad up with friends. Compete in a week-long bracket. Top 3 earn exclusive badges and coin prizes.
                  </p>

                  {/* Bracket SVG */}
                  <div className="flex justify-center mb-6">
                    <svg width="300" height="110" viewBox="0 0 300 110" fill="none" className="opacity-60">
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

                  <p className="text-cream/30 text-xs font-semibold uppercase tracking-wider text-center">
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
                { step: 1, icon: "⚔️", title: "COMPETE", desc: "Win duels and climb the leaderboard. Your Elo rating determines your rank." },
                { step: 2, icon: "✅", title: "VERIFY", desc: "Complete identity verification. One account per person." },
                { step: 3, icon: "💵", title: "GET PAID", desc: "Top 20 verified players receive their cut monthly." },
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
                      {item.icon} {item.title}
                    </p>
                    <p className="text-cream/40 text-sm leading-relaxed">{item.desc}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-cream/25 text-xs text-center mt-5">
              Cash rewards go live with V2 — December 2026.
            </p>
          </div>

          {/* ═══ 8. RANKING TIERS — PYRAMID ═══ */}
          <div className="animate-slide-up mb-10" style={{ animationDelay: "0.35s" }}>
            <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-6">
              RANKING TIERS
            </h2>
            <div className="max-w-xl mx-auto space-y-2.5">
              {tiersTopDown.map((tier, displayIdx) => {
                const origIdx = TIERS.length - 1 - displayIdx;
                const isLegend = tier.name === "LEGEND";
                const isOnyx = tier.name === "ONYX";
                const isCurrent = origIdx === CURRENT_TIER_INDEX;
                const isLocked = origIdx > CURRENT_TIER_INDEX;
                const isAchieved = origIdx < CURRENT_TIER_INDEX;

                const tierColor = isLegend ? "#FFD700" : (isOnyx ? (tier.glowColor || "#C0C0D0") : tier.color);
                const textColor = isOnyx ? (tier.textColor || "#C0C0D0") : tier.color;
                const staggerDelay = 0.35 + (TIERS.length - 1 - displayIdx) * 0.04;

                return (
                  <div key={tier.name} className="flex justify-center animate-slide-up group"
                    style={{ animationDelay: `${staggerDelay}s` }}>
                    <div className="relative flex items-center" style={{ width: widthsTopDown[displayIdx] }}>
                      {isCurrent && (
                        <div className="absolute -left-8 top-1/2 -translate-y-1/2 text-cream/60 text-sm font-bold animate-pulse">
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
                        <span className="text-lg sm:text-xl flex-shrink-0">
                          {isLocked ? "🔒" : tier.icon}
                        </span>

                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`font-bebas text-sm sm:text-base tracking-wider ${isLocked ? "text-gray-600" : isLegend ? "legend-text" : ""}`}
                              style={!isLocked && !isLegend ? { color: textColor } : undefined}>
                              {tier.name}
                            </span>
                            {isCurrent && (
                              <span className="text-[8px] font-bold uppercase tracking-widest text-cream/50 bg-cream/[0.07] px-2 py-0.5 rounded-md">
                                YOU
                              </span>
                            )}
                          </div>
                          <p className={`text-[9px] sm:text-[10px] ${isLocked ? "text-gray-700" : "text-cream/25"} leading-tight`}>
                            {tier.tagline}
                          </p>
                        </div>

                        <span className={`font-bebas text-[10px] sm:text-xs tracking-wider flex-shrink-0 ${isLocked ? "text-gray-700" : "text-cream/30"}`}>
                          {tier.range}
                        </span>

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
              <p className="font-bebas text-xl tracking-wider text-cream/50 mb-4">
                YOUR NAME IN THE ARENA
              </p>
              <p className="font-syne text-2xl font-bold mb-2"
                style={{ color: TIERS[CURRENT_TIER_INDEX].color, textShadow: `0 0 20px ${TIERS[CURRENT_TIER_INDEX].color}40` }}>
                {DISPLAY_NAME}
              </p>
              {CURRENT_TIER_INDEX < TIERS.length - 1 && (
                <div className="mt-3">
                  <p className="text-cream/25 text-[10px] uppercase tracking-widest mb-1.5">Next rank:</p>
                  <p className={`font-syne text-xl font-bold opacity-50 ${TIERS[CURRENT_TIER_INDEX + 1].name === "LEGEND" ? "legend-text" : ""}`}
                    style={TIERS[CURRENT_TIER_INDEX + 1].name !== "LEGEND" ? { color: TIERS[CURRENT_TIER_INDEX + 1].color } : undefined}>
                    {DISPLAY_NAME}
                  </p>
                  <p className="text-cream/20 text-[10px] mt-1">
                    {TIERS[CURRENT_TIER_INDEX + 1].range} to unlock{" "}
                    <span style={{ color: TIERS[CURRENT_TIER_INDEX + 1].name === "LEGEND" ? "#FFD700" : TIERS[CURRENT_TIER_INDEX + 1].color }}>
                      {TIERS[CURRENT_TIER_INDEX + 1].name}
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
              <div className="text-3xl flex-shrink-0">🛡️</div>
              <div>
                <p className="font-bebas text-xl tracking-wider text-electric mb-1.5"
                  style={{ textShadow: "0 0 10px rgba(74,144,217,0.2)" }}>
                  FAIR PLAY PROTECTED
                </p>
                <p className="text-cream/40 text-sm leading-relaxed">
                  Lionade uses tab detection, timing analysis, and behavioral pattern monitoring.
                  Cheaters are permanently banned from cash rewards.
                </p>
              </div>
            </div>
          </div>

        </div>
      </div>
    </ProtectedRoute>
  );
}
