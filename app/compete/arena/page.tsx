"use client";

// Competitive Arena hub — the 5 new competitive modes with a 1v1 / 2v2 toggle.
//
// Each mode launches matchmaking via /api/competitive/queue. While searching we
// poll the queue GET; on "matched" we route to the mode screen. NO BOTS — if no
// opponent arrives within the timeout we surface an honest "no opponents yet"
// dead-end (carried from Arena V2).
//
// Theme: dark interstellar + glassmorphism, gold/purple/electric accents.

import { useState, useRef, useCallback, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { apiPost, apiGet, apiDelete } from "@/lib/api-client";
import type { CompetitiveMode, CompetitiveFormat } from "@/lib/competitive/types";

interface ModeCard {
  mode: CompetitiveMode;
  name: string;
  verb: string;
  blurb: string;
  accent: string;
  icon: string;
  /** Ideal-context badge shown on the card. All ranked modes play fine remotely. */
  bestPlayed: string;
}

// Poker Face was moved to Lionade Party (no ELO, no Fangs) on 2026-05-28, so the
// ranked arena is now 4 modes — all of which play fine over the internet.
const MODES: ModeCard[] = [
  { mode: "sabotage", name: "Sabotage Trivia", verb: "Fight", blurb: "Real-time trivia duel. Answer fast to charge attacks, then blur, scramble, and freeze your rival.", accent: "#EF4444", icon: "⚔️", bestPlayed: "Remote OK" },
  { mode: "zoom", name: "Zoom Reveal", verb: "Nerve", blurb: "An image un-blurs over time. Guess early to score big, but a wrong guess locks the round.", accent: "#00BFFF", icon: "🔍", bestPlayed: "Remote OK" },
  { mode: "spectrum", name: "Spectrum Slider", verb: "Feel", blurb: "Slide to estimate a value. Closest to the truth scores the most, with partial credit for near misses.", accent: "#A855F7", icon: "🎚️", bestPlayed: "Remote OK" },
  { mode: "pin", name: "Map Pin Drop", verb: "Spatial", blurb: "Drop a pin on the world map. The closer to the real spot, the more points you bank.", accent: "#50C878", icon: "📍", bestPlayed: "Remote OK" },
];

type SearchState =
  | { phase: "idle" }
  | { phase: "searching"; mode: CompetitiveMode; since: number }
  | { phase: "none"; mode: CompetitiveMode };

const SEARCH_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2500;

export default function CompetitiveArenaPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [format, setFormat] = useState<CompetitiveFormat>("1v1");
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const goToMatch = useCallback(
    (mode: CompetitiveMode, matchId: string) => {
      stopPolling();
      setSearch({ phase: "idle" });
      router.push(`/compete/arena/${mode}/${matchId}`);
    },
    [router, stopPolling],
  );

  const cancelSearch = useCallback(async () => {
    stopPolling();
    setSearch({ phase: "idle" });
    await apiDelete("/api/competitive/queue").catch(() => {});
  }, [stopPolling]);

  const startSearch = useCallback(
    async (mode: CompetitiveMode) => {
      setSearch({ phase: "searching", mode, since: Date.now() });
      const { ok, data } = await apiPost<{ status: string; matchId?: string }>(
        "/api/competitive/queue",
        { format, mode },
      );
      if (ok && data?.status === "matched" && data.matchId) {
        goToMatch(mode, data.matchId);
        return;
      }
      // Poll for a match.
      pollRef.current = setInterval(async () => {
        const elapsed = Date.now() - (search.phase === "searching" ? search.since : Date.now());
        const res = await apiGet<{ status: string; matchId?: string }>("/api/competitive/queue");
        if (res.ok && res.data?.status === "matched" && res.data.matchId) {
          goToMatch(mode, res.data.matchId);
          return;
        }
        // Timeout → honest no-opponents dead-end.
        if (elapsed > SEARCH_TIMEOUT_MS) {
          stopPolling();
          await apiDelete("/api/competitive/queue").catch(() => {});
          setSearch({ phase: "none", mode });
        }
      }, POLL_INTERVAL_MS);
    },
    [format, goToMatch, search, stopPolling],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  return (
    <ProtectedRoute>
      <div data-force-dark className="relative min-h-screen pt-16 pb-24 overflow-hidden" style={{ isolation: "isolate" }}>
        {/* Ambient orbs */}
        <div className="absolute top-[12%] left-[18%] w-[460px] h-[460px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }} />
        <div className="absolute bottom-[18%] right-[14%] w-[420px] h-[420px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #00BFFF 0%, transparent 70%)" }} />

        <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-8 lg:px-12 py-8">
          <BackButton />

          {/* Header — launcher framing */}
          <div className="text-center mb-8">
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
              COMPETITIVE ARENA
            </h1>
            <p className="text-cream/60 text-sm sm:text-base mt-3 max-w-xl mx-auto">
              Five ranked modes. Earn Elo and Fangs on the ranked ladders. Pick a format, pick a mode.
            </p>
          </div>

          {/* Format toggle — the gold pill slides between options (layoutId) */}
          <div className="flex justify-center mb-10">
            <div className="inline-flex rounded-full p-1 border border-cream/10 bg-cream/[0.03]">
              {(["1v1", "2v2"] as CompetitiveFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={search.phase === "searching"}
                  className="relative px-6 py-2 rounded-full font-bebas tracking-wider text-lg transition-colors"
                >
                  {format === f && (
                    <motion.span
                      layoutId="arena-format-pill"
                      className="absolute inset-0 rounded-full bg-gold shadow-[0_2px_12px_rgba(255,215,0,0.3)]"
                      transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
                    />
                  )}
                  <span className={`relative z-10 ${format === f ? "text-[#1a1400]" : "text-cream/60 hover:text-cream/90"}`}>
                    {f === "1v1" ? "1 V 1" : "2 V 2 SQUAD"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {format === "2v2" && (
            <p className="text-center text-cream/45 text-xs mb-8 max-w-md mx-auto">
              Squad mode pairs you with a partner. Solo-queue and we auto-pair you, or bring a friend (duo codes coming to the lobby).
            </p>
          )}

          {/* Mode grid — launcher tiles, staggered reveal + hover lift/glow */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 lg:gap-6">
            {/* Quiz Duel — the real 1v1 ELO quiz duel (Arena V1, folded in
                2026-05-28). Unlike the 4 matchmaking modes it has its own
                system (arena_elo ladder + /api/arena/*), so the tile LINKS to
                the standalone duel flow at /compete/arena/duel rather than
                calling startSearch. Always 1v1; ignores the 2v2 toggle. */}
            <Link
              href="/compete/arena/duel"
              className={`ca-mode-card group relative overflow-hidden rounded-2xl p-6 lg:p-7 flex flex-col transition-all duration-300 hover:-translate-y-1.5 ${reduce ? "" : "ca-card-reveal"}`}
              style={{
                background: "linear-gradient(135deg, #0c1020 0%, #080c18 50%, #060c18 100%)",
                border: "1px solid #FFD70030",
                boxShadow: "0 0 30px #FFD70008",
                ["--mode-accent" as string]: "#FFD700",
              }}
            >
              <div className="absolute inset-0 pointer-events-none"
                style={{ background: "radial-gradient(ellipse at 30% 20%, #FFD70010 0%, transparent 60%)" }} />
              <div className="relative">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-4xl">🗡️</span>
                  <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-md"
                    style={{ color: "#FFD700", background: "#FFD70015" }}>
                    Duel
                  </span>
                  <span className="ml-auto text-[10px] font-bebas uppercase tracking-[0.18em] px-2.5 py-1 rounded-full
                    text-cream/70 bg-white/[0.04] border border-white/10 backdrop-blur-md">
                    Remote OK
                  </span>
                </div>
                <p className="font-bebas text-2xl tracking-wider mb-2" style={{ color: "#FFD700" }}>
                  QUIZ DUEL
                </p>
                <p className="text-cream/55 text-sm leading-relaxed mb-5 min-h-[60px]">
                  Head-to-head 1v1 quiz battle. Same questions, 15 seconds each, speed bonus for fast answers. Winner takes the wagered Fangs and climbs the Quiz Duel ladder.
                </p>
                <span
                  className="block w-full text-center font-bebas tracking-wider text-lg py-2.5 rounded-xl transition-all group-active:scale-95"
                  style={{ background: "linear-gradient(135deg, #FFD700, #FFD700cc)", color: "#0a0a14" }}
                >
                  ENTER DUEL
                </span>
              </div>
            </Link>
            {MODES.map((m, i) => {
              const busy = search.phase === "searching" && search.mode === m.mode;
              const dead = search.phase === "none" && search.mode === m.mode;
              return (
                <div
                  key={m.mode}
                  className={`ca-mode-card group relative overflow-hidden rounded-2xl p-6 lg:p-7 flex flex-col transition-all duration-300 hover:-translate-y-1.5 ${reduce ? "" : "ca-card-reveal"}`}
                  style={{
                    background: "linear-gradient(135deg, #0c1020 0%, #080c18 50%, #060c18 100%)",
                    border: `1px solid ${m.accent}30`,
                    boxShadow: `0 0 30px ${m.accent}08`,
                    animationDelay: reduce ? undefined : `${i * 80}ms`,
                    ["--mode-accent" as string]: m.accent,
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at 30% 20%, ${m.accent}10 0%, transparent 60%)` }} />
                  <div className="relative">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-4xl">{m.icon}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-md"
                        style={{ color: m.accent, background: `${m.accent}15` }}>
                        {m.verb}
                      </span>
                      {/* Best-played context chip — small tasteful glass pill */}
                      <span
                        className="ml-auto text-[10px] font-bebas uppercase tracking-[0.18em] px-2.5 py-1 rounded-full
                          text-cream/70 bg-white/[0.04] border border-white/10 backdrop-blur-md"
                      >
                        {m.bestPlayed}
                      </span>
                    </div>
                    <p className="font-bebas text-2xl tracking-wider mb-2" style={{ color: m.accent }}>
                      {m.name.toUpperCase()}
                    </p>
                    <p className="text-cream/55 text-sm leading-relaxed mb-5 min-h-[60px]">{m.blurb}</p>

                    {!busy && !dead && (
                      <button
                        onClick={() => startSearch(m.mode)}
                        className="w-full font-bebas tracking-wider text-lg py-2.5 rounded-xl transition-all active:scale-95"
                        style={{ background: `linear-gradient(135deg, ${m.accent}, ${m.accent}cc)`, color: "#0a0a14" }}
                      >
                        FIND MATCH
                      </button>
                    )}

                    {busy && (
                      <div className="flex flex-col gap-2">
                        <div className="flex items-center justify-center gap-2 py-2.5 rounded-xl border border-cream/10 bg-cream/[0.03]">
                          <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: m.accent }} />
                          <span className="font-bebas tracking-wider text-cream/70">SEARCHING...</span>
                        </div>
                        <button onClick={cancelSearch} className="text-cream/40 hover:text-cream/70 text-xs">
                          Cancel
                        </button>
                      </div>
                    )}

                    {dead && (
                      <div className="flex flex-col gap-2">
                        <div className="text-center py-2.5 rounded-xl border border-cream/10 bg-cream/[0.03]">
                          <p className="text-cream/60 text-sm">No opponents yet.</p>
                          <p className="text-cream/35 text-xs mt-0.5">Try again in a bit.</p>
                        </div>
                        <button
                          onClick={() => startSearch(m.mode)}
                          className="text-xs font-bebas tracking-wider py-1.5 rounded-lg"
                          style={{ color: m.accent }}
                        >
                          RETRY
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
