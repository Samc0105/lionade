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
import { Sword, MagnifyingGlass, Sliders, MapPin, type Icon } from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { apiPost, apiGet, apiDelete } from "@/lib/api-client";
import type { CompetitiveMode, CompetitiveFormat } from "@/lib/competitive/types";
import { generateRoomCode, isValidRoomCode, normalizeRoomCode } from "@/lib/party/room-code";

interface ModeCard {
  mode: CompetitiveMode;
  name: string;
  verb: string;
  blurb: string;
  accent: string;
  /** Phosphor icon component, tinted with the mode accent at render. */
  icon: Icon;
  /** Ideal-context badge shown on the card. All ranked modes play fine remotely. */
  bestPlayed: string;
}

// Poker Face was moved to Lionade Party (no ELO, no Fangs) on 2026-05-28, so the
// ranked arena is now 4 modes — all of which play fine over the internet.
const MODES: ModeCard[] = [
  { mode: "sabotage", name: "Sabotage Trivia", verb: "Fight", blurb: "Real-time trivia duel. Answer fast to charge attacks, then blur, scramble, and freeze your rival.", accent: "#EF4444", icon: Sword, bestPlayed: "Remote OK" },
  { mode: "zoom", name: "Zoom Reveal", verb: "Nerve", blurb: "An image un-blurs over time. Guess early to score big, but a wrong guess locks the round.", accent: "#00BFFF", icon: MagnifyingGlass, bestPlayed: "Remote OK" },
  { mode: "spectrum", name: "Spectrum Slider", verb: "Feel", blurb: "Slide to estimate a value. Closest to the truth scores the most, with partial credit for near misses.", accent: "#A855F7", icon: Sliders, bestPlayed: "Remote OK" },
  { mode: "pin", name: "Map Pin Drop", verb: "Spatial", blurb: "Drop a pin on the world map. The closer to the real spot, the more points you bank.", accent: "#50C878", icon: MapPin, bestPlayed: "Remote OK" },
];

type SearchState =
  | { phase: "idle" }
  | { phase: "searching"; mode: CompetitiveMode; since: number }
  | { phase: "none"; mode: CompetitiveMode }
  // Distinct from "none" (a real, honest no-opponents timeout): the queue-join
  // request itself failed (server/network), so retrying is the right nudge.
  | { phase: "error"; mode: CompetitiveMode };

// Which 2v2 entry path the player has chosen. Only relevant when format is 2v2.
//   - "solo": no code, auto-pair into a random duo (queue with partyCode null)
//   - "create": generate + share a code, your teammate joins it
//   - "join": enter your teammate's code
// The duo code is purely a shared matchmaking string — both friends queuing 2v2
// with the same code land on the same team. No server pre-registration.
type DuoPath = "solo" | "create" | "join";

const SEARCH_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2500;

export default function CompetitiveArenaPage() {
  const router = useRouter();
  const reduce = useReducedMotion();
  const [format, setFormat] = useState<CompetitiveFormat>("1v1");
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  // 2v2 duo state. duoPath defaults to "solo" so 2v2 is never gated on a friend.
  const [duoPath, setDuoPath] = useState<DuoPath>("solo");
  // The code created by THIS player (create path). Generated once on demand.
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  // Raw text in the join input; validated/normalized at queue time.
  const [joinInput, setJoinInput] = useState("");
  const [copied, setCopied] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // True while a search is in flight — mirrors `search.phase === "searching"`
  // but readable from cleanup closures without going stale.
  const searchingRef = useRef(false);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const goToMatch = useCallback(
    (mode: CompetitiveMode, matchId: string) => {
      stopPolling();
      searchingRef.current = false;
      setSearch({ phase: "idle" });
      router.push(`/compete/arena/${mode}/${matchId}`);
    },
    [router, stopPolling],
  );

  const cancelSearch = useCallback(async () => {
    stopPolling();
    searchingRef.current = false;
    setSearch({ phase: "idle" });
    await apiDelete("/api/competitive/queue").catch(() => {});
  }, [stopPolling]);

  // The duo matchmaking code to send with a 2v2 queue, or null for solo/1v1.
  // create → the generated code; join → the validated/normalized input; both
  // friends sending the same code land on the same team. 1v1 ignores this.
  const resolveDuoCode = useCallback((): string | null => {
    if (format !== "2v2") return null;
    if (duoPath === "create") return createdCode;
    if (duoPath === "join") {
      const code = normalizeRoomCode(joinInput);
      return isValidRoomCode(code) ? code : null;
    }
    return null; // solo
  }, [format, duoPath, createdCode, joinInput]);

  const startSearch = useCallback(
    async (mode: CompetitiveMode) => {
      // Stable timestamp captured in this closure — NOT read back from state,
      // which would be stale inside the interval callback (the old bug: the
      // interval closed over `search` from before setSearch landed, so the
      // 45s timeout never fired and the spinner ran forever).
      const startedAt = Date.now();
      // partyCode only applies to 2v2; for 1v1 this is always null and the body
      // is identical to before (no regression to the 1v1 flow).
      const partyCode = resolveDuoCode();
      searchingRef.current = true;
      setSearch({ phase: "searching", mode, since: startedAt });
      const { ok, data } = await apiPost<{ status: string; matchId?: string }>(
        "/api/competitive/queue",
        partyCode ? { format, mode, partyCode } : { format, mode },
      );
      if (ok && data?.status === "matched" && data.matchId) {
        goToMatch(mode, data.matchId);
        return;
      }
      if (!ok) {
        // The queue-join failed outright — don't sit on a "searching" spinner
        // (or later show the misleading "no opponents"); surface it as an error.
        searchingRef.current = false;
        setSearch({ phase: "error", mode });
        return;
      }
      // Poll for a match.
      pollRef.current = setInterval(async () => {
        const elapsed = Date.now() - startedAt;
        const res = await apiGet<{ status: string; matchId?: string }>("/api/competitive/queue");
        if (res.ok && res.data?.status === "matched" && res.data.matchId) {
          goToMatch(mode, res.data.matchId);
          return;
        }
        // Timeout → honest no-opponents dead-end. Dequeue so the user can't
        // be matched while staring at the "No opponents yet" card.
        if (elapsed > SEARCH_TIMEOUT_MS) {
          stopPolling();
          searchingRef.current = false;
          setSearch({ phase: "none", mode });
          await apiDelete("/api/competitive/queue").catch(() => {});
        }
      }, POLL_INTERVAL_MS);
    },
    [format, goToMatch, stopPolling, resolveDuoCode],
  );

  // Unmount cleanup: clear the poll and, if a search was still in flight,
  // remove our queue row so we don't get matched after leaving the page.
  useEffect(
    () => () => {
      stopPolling();
      if (searchingRef.current) {
        searchingRef.current = false;
        apiDelete("/api/competitive/queue").catch(() => {});
      }
    },
    [stopPolling],
  );

  // Lazily mint a duo code the first time the player picks "Create duo".
  const selectCreate = useCallback(() => {
    setDuoPath("create");
    setCreatedCode((prev) => prev ?? generateRoomCode());
    setCopied(false);
  }, []);

  const copyCode = useCallback(async () => {
    if (!createdCode) return;
    try {
      await navigator.clipboard.writeText(createdCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the code is visible on screen to read aloud */
    }
  }, [createdCode]);

  // FIND MATCH is blocked only on the 2v2 "join" path until a valid 4-digit
  // code is entered. Solo and create are always ready; 1v1 is unaffected.
  const joinCodeValid = isValidRoomCode(normalizeRoomCode(joinInput));
  const findMatchBlocked =
    format === "2v2" && duoPath === "join" && !joinCodeValid;

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
              Five ways to compete. Earn Elo and Fangs on the ranked ladders. Pick a format, pick a mode.
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
            <div className={`mx-auto max-w-md mb-10 ${reduce ? "" : "ca-card-reveal"}`}>
              <p className="text-center text-cream/45 text-xs mb-4">
                Squad mode is 2 versus 2. Solo queue and we auto-pair you, or bring a friend with a duo code.
              </p>

              {/* Path selector — three small glass segments, gold-accented when active */}
              <div className="inline-flex w-full rounded-xl p-1 border border-cream/10 bg-cream/[0.03] mb-4">
                {([
                  { key: "solo", label: "SOLO QUEUE" },
                  { key: "create", label: "CREATE DUO" },
                  { key: "join", label: "JOIN DUO" },
                ] as { key: DuoPath; label: string }[]).map((p) => {
                  const active = duoPath === p.key;
                  return (
                    <button
                      key={p.key}
                      onClick={() => (p.key === "create" ? selectCreate() : setDuoPath(p.key))}
                      disabled={search.phase === "searching"}
                      className={`relative flex-1 px-2 py-2 rounded-lg font-bebas tracking-wider text-sm transition-colors disabled:opacity-50 ${
                        active ? "text-[#1a1400]" : "text-cream/55 hover:text-cream/85"
                      }`}
                    >
                      {active && (
                        <motion.span
                          layoutId="arena-duo-pill"
                          className="absolute inset-0 rounded-lg bg-gold shadow-[0_2px_10px_rgba(255,215,0,0.25)]"
                          transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 30 }}
                        />
                      )}
                      <span className="relative z-10">{p.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Solo — auto-pair explainer */}
              {duoPath === "solo" && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur p-4 text-center">
                  <p className="text-cream/70 text-sm">We will pair you with a random teammate.</p>
                  <p className="text-cream/40 text-xs mt-1">Pick a mode below and hit FIND MATCH.</p>
                </div>
              )}

              {/* Create — show the big shareable code + copy */}
              {duoPath === "create" && createdCode && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur p-5 text-center">
                  <p className="text-cream/45 text-xs uppercase tracking-[0.2em] mb-2">Your duo code</p>
                  <div className="flex items-center justify-center gap-3">
                    <span className="font-dm-mono text-5xl tracking-[0.3em] text-gold pl-[0.3em]">
                      {createdCode}
                    </span>
                    <button
                      onClick={copyCode}
                      className="shrink-0 px-3 py-2 rounded-lg text-xs font-bebas tracking-wider border border-gold/30 bg-gold/10 text-gold hover:bg-gold/15 transition-colors active:scale-95"
                    >
                      {copied ? "COPIED" : "COPY"}
                    </button>
                  </div>
                  <p className="text-cream/50 text-sm mt-3">Share this with your teammate.</p>
                  <p className="text-cream/35 text-xs mt-1">
                    Once you both queue 2v2 with this code, you are on the same team.
                  </p>
                </div>
              )}

              {/* Join — enter a teammate's code */}
              {duoPath === "join" && (
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] backdrop-blur p-5">
                  <label className="block text-cream/45 text-xs uppercase tracking-[0.2em] mb-2 text-center">
                    Teammate's duo code
                  </label>
                  <input
                    value={joinInput}
                    onChange={(e) => setJoinInput(normalizeRoomCode(e.target.value).slice(0, 4))}
                    inputMode="numeric"
                    placeholder="1234"
                    maxLength={4}
                    className="w-full text-center font-dm-mono text-4xl tracking-[0.35em] pl-[0.35em] py-2 rounded-xl bg-navy/40 border border-white/10 text-cream placeholder:text-cream/20 focus:border-gold/40 focus:outline-none transition-colors"
                  />
                  <p className="text-center text-xs mt-2 h-4">
                    {joinInput.length === 0 ? (
                      <span className="text-cream/35">Enter the 4-digit code your teammate shared.</span>
                    ) : joinCodeValid ? (
                      <span className="text-[#50C878]">Ready. Pick a mode and find your match.</span>
                    ) : (
                      <span className="text-[#EF4444]">Codes are 4 digits.</span>
                    )}
                  </p>
                </div>
              )}
            </div>
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
              const errored = search.phase === "error" && search.mode === m.mode;
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
                      <m.icon size={36} weight="duotone" color={m.accent} aria-hidden="true" />
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

                    {!busy && !dead && !errored && (
                      <button
                        onClick={() => startSearch(m.mode)}
                        disabled={findMatchBlocked}
                        className="w-full font-bebas tracking-wider text-lg py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:active:scale-100 disabled:cursor-not-allowed"
                        style={{ background: `linear-gradient(135deg, ${m.accent}, ${m.accent}cc)`, color: "#0a0a14" }}
                        title={findMatchBlocked ? "Enter your teammate's 4-digit duo code first" : undefined}
                      >
                        FIND MATCH
                      </button>
                    )}

                    {busy && (
                      <div className="flex flex-col gap-2">
                        <div className="flex flex-col items-center justify-center gap-1 py-2.5 rounded-xl border border-cream/10 bg-cream/[0.03]">
                          <span className="flex items-center gap-2">
                            <span className="inline-block w-2 h-2 rounded-full animate-pulse" style={{ background: m.accent }} />
                            <span className="font-bebas tracking-wider text-cream/70">SEARCHING...</span>
                          </span>
                          {format === "2v2" && (
                            <span className="text-cream/40 text-[11px]">
                              {duoPath === "solo"
                                ? "Finding your teammate and opponents"
                                : "Waiting for your duo and opponents"}
                            </span>
                          )}
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

                    {errored && (
                      <div className="flex flex-col gap-2">
                        <div className="text-center py-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.05]">
                          <p className="text-cream/70 text-sm">Couldn&apos;t reach matchmaking.</p>
                          <p className="text-cream/40 text-xs mt-0.5">Check your connection and try again.</p>
                        </div>
                        <button
                          onClick={() => startSearch(m.mode)}
                          className="text-xs font-bebas tracking-wider py-1.5 rounded-lg"
                          style={{ color: m.accent }}
                        >
                          TRY AGAIN
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
