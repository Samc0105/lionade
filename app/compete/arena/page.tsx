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
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { apiPost, apiGet, apiDelete } from "@/lib/api-client";
import { cdnUrl } from "@/lib/cdn";
import type { CompetitiveMode, CompetitiveFormat } from "@/lib/competitive/types";

interface ModeCard {
  mode: CompetitiveMode;
  name: string;
  verb: string;
  blurb: string;
  accent: string;
  icon: string;
}

const MODES: ModeCard[] = [
  { mode: "sabotage", name: "Sabotage Trivia", verb: "Fight", blurb: "Real-time trivia duel. Answer fast to charge attacks, then blur, scramble, and freeze your rival.", accent: "#EF4444", icon: "⚔️" },
  { mode: "zoom", name: "Zoom Reveal", verb: "Nerve", blurb: "An image un-blurs over time. Guess early to score big, but a wrong guess locks the round.", accent: "#00BFFF", icon: "🔍" },
  { mode: "spectrum", name: "Spectrum Slider", verb: "Feel", blurb: "Slide to estimate a value. Closest to the truth scores the most, with partial credit for near misses.", accent: "#A855F7", icon: "🎚️" },
  { mode: "pin", name: "Map Pin Drop", verb: "Spatial", blurb: "Drop a pin on the world map. The closer to the real spot, the more points you bank.", accent: "#50C878", icon: "📍" },
  { mode: "pokerface", name: "Poker Face", verb: "Read", blurb: "Hold a secret fact. Present truth or a bluff, set your Challenge Stake, and read your rival's call.", accent: "#FFD700", icon: "🃏" },
];

type SearchState =
  | { phase: "idle" }
  | { phase: "searching"; mode: CompetitiveMode; since: number }
  | { phase: "none"; mode: CompetitiveMode };

const SEARCH_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2500;

export default function CompetitiveArenaPage() {
  const router = useRouter();
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

        <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <BackButton />

          {/* Header */}
          <div className="text-center mb-8">
            <h1 className="font-bebas text-5xl sm:text-7xl chrome-text tracking-wider leading-none">
              COMPETITIVE ARENA
            </h1>
            <p className="text-cream/60 text-sm sm:text-base mt-3 max-w-xl mx-auto">
              Five competitive modes. Earn Elo and Fangs on the ranked ladders. Pick a format, pick a mode.
            </p>
          </div>

          {/* Format toggle */}
          <div className="flex justify-center mb-10">
            <div className="inline-flex rounded-full p-1 border border-cream/10 bg-cream/[0.03]">
              {(["1v1", "2v2"] as CompetitiveFormat[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  disabled={search.phase === "searching"}
                  className={`px-6 py-2 rounded-full font-bebas tracking-wider text-lg transition-all
                    ${format === f ? "bg-gold text-[#1a1400] shadow-[0_2px_12px_rgba(255,215,0,0.3)]" : "text-cream/60 hover:text-cream/90"}`}
                >
                  {f === "1v1" ? "1 V 1" : "2 V 2 SQUAD"}
                </button>
              ))}
            </div>
          </div>

          {format === "2v2" && (
            <p className="text-center text-cream/45 text-xs mb-8 max-w-md mx-auto">
              Squad mode pairs you with a partner. Solo-queue and we auto-pair you, or bring a friend (duo codes coming to the lobby).
            </p>
          )}

          {/* Mode grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {MODES.map((m) => {
              const busy = search.phase === "searching" && search.mode === m.mode;
              const dead = search.phase === "none" && search.mode === m.mode;
              return (
                <div
                  key={m.mode}
                  className="relative overflow-hidden rounded-2xl p-6 flex flex-col transition-all duration-300 hover:-translate-y-1"
                  style={{
                    background: "linear-gradient(135deg, #0c1020 0%, #080c18 50%, #060c18 100%)",
                    border: `1px solid ${m.accent}30`,
                    boxShadow: `0 0 30px ${m.accent}08`,
                  }}
                >
                  <div className="absolute inset-0 pointer-events-none"
                    style={{ background: `radial-gradient(ellipse at 30% 20%, ${m.accent}10 0%, transparent 60%)` }} />
                  <div className="relative">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-3xl">{m.icon}</span>
                      <span className="text-[10px] font-bold uppercase tracking-[0.2em] px-2 py-0.5 rounded-md"
                        style={{ color: m.accent, background: `${m.accent}15` }}>
                        {m.verb}
                      </span>
                    </div>
                    <p className="font-bebas text-2xl tracking-wider mb-2" style={{ color: m.accent }}>
                      {m.name.toUpperCase()}
                    </p>
                    <p className="text-cream/55 text-sm leading-relaxed mb-5 min-h-[60px]">{m.blurb}</p>

                    {m.mode === "pokerface" && (
                      <p className="text-cream/40 text-[11px] mb-3 flex items-center gap-1">
                        <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3.5 h-3.5 object-contain" />
                        Challenge Stakes: 10 to 50 Fangs
                      </p>
                    )}

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
