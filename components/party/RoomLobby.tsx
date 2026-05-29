"use client";

// Lobby view for Lionade Party rooms.
// Player list + ready toggle + game-select cards + Start button (host only).

import { useEffect, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { apiPost } from "@/lib/api-client";
import RoomCodeShare from "./RoomCodeShare";
import { SUBJECT_LABELS, SUBJECTS as ALL_SUBJECTS } from "@/lib/party/word-lists-stub";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";

const MAX_PLAYERS = 6;

type PartyGame = "sketch" | "bluff" | "pokerface";

interface Props {
  room: PartyRoom;
  players: PartyPlayer[];
  isHost: boolean;
  meUserId: string;
  onGameStarted: (game: PartyGame) => void;
}

const MAX_TOPIC_PICKS = 2;

// Per-game lobby metadata. `bestPlayed` is the small "ideal context" glass chip
// Sam asked for: Sketchy = Either, Bluff = Remote OK, Poker Face = Best in person
// (the face IS the tell, so it shines when the room is physically together).
const GAME_META: Record<PartyGame, {
  title: string;
  short: string;
  tagline: string;
  accent: string;
  players: string;
  minPlayers: number;
  bestPlayed: string;
}> = {
  sketch: {
    title: "Sketchy Subjects",
    short: "SKETCHY SUBJECTS",
    tagline: "Draw subject-locked words. Others guess in chat.",
    accent: "#A855F7",
    players: "2 to 6 players",
    minPlayers: 2,
    bestPlayed: "Either",
  },
  bluff: {
    title: "Bluff Trivia",
    short: "BLUFF TRIVIA",
    tagline: "Write fake trivia answers. Trick your friends.",
    accent: "#FFD700",
    players: "3 to 6 players",
    minPlayers: 3,
    bestPlayed: "Remote OK",
  },
  pokerface: {
    title: "Poker Face",
    short: "POKER FACE",
    tagline: "Hold a secret fact. Present truth or a bluff. The room calls it.",
    accent: "#00BFFF",
    players: "3 to 6 players",
    minPlayers: 3,
    bestPlayed: "Best in person",
  },
};

export default function RoomLobby({ room, players, isHost, meUserId, onGameStarted }: Props) {
  const reduced = useReducedMotion();
  const [selectedGame, setSelectedGame] = useState<PartyGame>("sketch");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poker Face host settings (only sent when starting pokerface).
  const [pfMode, setPfMode] = useState<"inperson" | "remote">("inperson");
  const [pfRotations, setPfRotations] = useState<number>(2);

  const me = players.find((p) => p.user_id === meUserId);
  const serverReady = !!me?.is_ready;

  // Optimistic ready state. The ready API + Realtime fan-out is ~500-800ms
  // round-trip which makes the button feel sluggish. We flip the visual
  // immediately on click, fire the request in the background, and revert
  // if the server rejects. When the server snapshot eventually reflects
  // the toggled value, we clear the override and fall back to server truth.
  const [optimisticReady, setOptimisticReady] = useState<boolean | null>(null);
  const meReady = optimisticReady !== null ? optimisticReady : serverReady;

  // Sync: when server catches up to our optimistic value, drop the override.
  useEffect(() => {
    if (optimisticReady !== null && serverReady === optimisticReady) {
      setOptimisticReady(null);
    }
  }, [serverReady, optimisticReady]);

  // Per-player topic picks (max 2). Same optimistic pattern as ready —
  // toggle is instant locally, server fires in background, reverts on error.
  const [optimisticTopics, setOptimisticTopics] = useState<string[] | null>(null);
  const serverTopics = me?.selected_subjects ?? [];
  const myTopics = optimisticTopics ?? serverTopics;

  useEffect(() => {
    if (
      optimisticTopics !== null &&
      optimisticTopics.length === serverTopics.length &&
      optimisticTopics.every((t) => serverTopics.includes(t))
    ) {
      setOptimisticTopics(null);
    }
  }, [serverTopics, optimisticTopics]);

  // For aggregate displays we apply both optimistic overrides locally so the
  // numbers match what the user just clicked.
  const optimisticPlayers = players.map((p) => {
    if (p.user_id !== meUserId) return p;
    return {
      ...p,
      is_ready: optimisticReady !== null ? optimisticReady : p.is_ready,
      selected_subjects: optimisticTopics ?? p.selected_subjects,
    };
  });
  const allReady = optimisticPlayers.length > 0 && optimisticPlayers.every((p) => p.is_ready);
  const readyCount = optimisticPlayers.filter((p) => p.is_ready).length;
  const minPlayers = GAME_META[selectedGame].minPlayers;
  const enoughPlayers = players.length >= minPlayers;

  // Vote counts per subject across the room (for the "voted by N" aggregate).
  const subjectVotes: Record<string, number> = {};
  for (const p of optimisticPlayers) {
    for (const s of p.selected_subjects ?? []) {
      subjectVotes[s] = (subjectVotes[s] ?? 0) + 1;
    }
  }

  async function toggleTopic(s: string) {
    const isOn = myTopics.includes(s);
    let next: string[];
    if (isOn) {
      next = myTopics.filter((t) => t !== s);
    } else {
      // Cap at MAX_TOPIC_PICKS — drop the oldest if we're already full.
      next = [...myTopics, s].slice(-MAX_TOPIC_PICKS);
    }
    setOptimisticTopics(next);
    setError(null);
    const res = await apiPost(`/api/party/rooms/${room.code}/preferences`, {
      subjects: next,
    });
    if (!res.ok) {
      setOptimisticTopics(null);
      setError(res.error ?? "Couldn't update topics.");
    }
  }

  async function toggleReady() {
    const target = !meReady;
    setOptimisticReady(target);  // instant visual
    setError(null);
    const res = await apiPost(`/api/party/rooms/${room.code}/ready`, { ready: target });
    if (!res.ok) {
      setOptimisticReady(null);  // revert to server truth
      setError(res.error ?? "Couldn't update your ready state.");
    }
    // Success path: the override stays until the next server snapshot
    // reflects the new value, then useEffect clears it.
  }

  async function startGame() {
    if (!isHost) return;
    if (!enoughPlayers) {
      const meta = GAME_META[selectedGame];
      setError(`${meta.title} needs at least ${meta.minPlayers} players.`);
      return;
    }
    if (!allReady) {
      setError("Waiting for everyone to ready up.");
      return;
    }
    setStarting(true);
    setError(null);
    const res = await apiPost(`/api/party/rooms/${room.code}/start`, {
      game: selectedGame,
      ...(selectedGame === "pokerface"
        ? { settings: { pf_mode: pfMode, pf_rotations: pfRotations } }
        : {}),
    });
    setStarting(false);
    if (!res.ok) {
      setError(res.error ?? "Couldn't start the game.");
      return;
    }
    onGameStarted(selectedGame);
  }

  return (
    <div className="space-y-7 max-w-3xl mx-auto">
      {/* Code share */}
      <div className="flex flex-col items-center gap-2">
        <RoomCodeShare code={room.code} />
      </div>

      {/* Players */}
      <div
        className="rounded-2xl p-5"
        style={{
          background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
          backdropFilter: "blur(12px)",
        }}
      >
        <div className="flex items-center justify-between mb-3">
          <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">
            PLAYERS ({players.length}/{MAX_PLAYERS})
            <span className="text-cream/30 ml-2 normal-case tracking-normal">
              · {readyCount}/{players.length} ready
            </span>
          </p>
          {isHost && (
            <span className="font-bebas text-[10px] tracking-wider px-2 py-0.5 rounded-full bg-[#FFD700]/15 text-[#FFD700] border border-[#FFD700]/40">
              YOU ARE HOST
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {optimisticPlayers.map((p) => {
            const isMe = p.user_id === meUserId;
            const isReady = p.is_ready;
            const accent = isReady ? "rgba(34,197,94,0.45)" : isMe ? "rgba(168,85,247,0.4)" : "rgba(255,255,255,0.06)";
            const bg = isReady
              ? "rgba(34,197,94,0.08)"
              : isMe
                ? "rgba(168,85,247,0.12)"
                : "rgba(255,255,255,0.03)";
            return (
              <div
                key={p.user_id}
                className="rounded-lg px-3 py-2 flex items-center gap-2 truncate"
                style={{ background: bg, border: `1px solid ${accent}` }}
              >
                <span
                  aria-hidden="true"
                  className="inline-block w-2 h-2 rounded-full shrink-0"
                  style={{
                    background: isReady ? "#22C55E" : "rgba(255,255,255,0.18)",
                    boxShadow: isReady ? "0 0 8px rgba(34,197,94,0.6)" : undefined,
                  }}
                />
                <p className="font-syne text-sm text-cream/90 truncate flex-1">
                  {p.username ?? "Player"}
                  {isMe && <span className="text-cream/40 text-xs"> (you)</span>}
                  {p.user_id === room.host_user_id && (
                    <span className="text-[#FFD700] text-xs"> ★</span>
                  )}
                </p>
                <span
                  className="font-bebas text-[10px] tracking-wider shrink-0"
                  style={{ color: isReady ? "#86EFAC" : "rgba(238,244,255,0.35)" }}
                >
                  {isReady ? "READY" : "..."}
                </span>
              </div>
            );
          })}
          {Array.from({ length: Math.max(0, 3 - players.length) }).map((_, i) => (
            <div
              key={`empty-${i}`}
              className="rounded-lg px-3 py-2 text-cream/30 text-xs font-syne italic"
              style={{
                background: "rgba(255,255,255,0.01)",
                border: "1px dashed rgba(255,255,255,0.06)",
              }}
            >
              waiting...
            </div>
          ))}
        </div>

        {/* Per-player Ready toggle. Button state is optimistic — no spinner,
            no disabled-while-loading. Server reconciliation is silent. */}
        <button
          onClick={toggleReady}
          className="mt-4 w-full py-3 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95"
          style={{
            background: meReady
              ? "linear-gradient(135deg, rgba(34,197,94,0.18) 0%, rgba(22,163,74,0.08) 100%)"
              : "linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(99,102,241,0.08) 100%)",
            border: meReady
              ? "1px solid rgba(34,197,94,0.55)"
              : "1px solid rgba(168,85,247,0.55)",
            color: meReady ? "#86EFAC" : "#E9D5FF",
            boxShadow: meReady
              ? "0 0 18px rgba(34,197,94,0.18)"
              : "0 0 18px rgba(168,85,247,0.18)",
          }}
        >
          {meReady ? "✓  READY · TAP TO UNREADY" : "TAP TO READY UP"}
        </button>
      </div>

      {/* Game select */}
      <div>
        <p className="font-bebas text-sm text-cream/60 tracking-[0.25em] mb-3">PICK A GAME</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {(["sketch", "bluff", "pokerface"] as const).map((g) => {
            const meta = GAME_META[g];
            const selected = selectedGame === g;
            const accent = meta.accent;
            return (
              <motion.button
                key={g}
                onClick={() => setSelectedGame(g)}
                disabled={!isHost}
                whileHover={reduced ? undefined : { y: -2 }}
                whileTap={reduced ? undefined : { scale: 0.98 }}
                className="text-left rounded-2xl p-5 transition-all relative overflow-hidden disabled:cursor-not-allowed"
                style={{
                  background: selected
                    ? `linear-gradient(135deg, ${accent}28 0%, ${accent}0a 100%)`
                    : "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
                  border: selected ? `1px solid ${accent}99` : "1px solid rgba(255,255,255,0.08)",
                  boxShadow: selected ? `0 0 28px ${accent}26, inset 0 1px 0 ${accent}26` : "none",
                  opacity: isHost ? 1 : 0.85,
                }}
              >
                {/* Best-played context chip — small tasteful glass pill */}
                <span
                  className="absolute top-3 right-3 text-[9px] font-bebas uppercase tracking-[0.16em] px-2 py-0.5 rounded-full
                    text-cream/70 bg-white/[0.05] border border-white/10 backdrop-blur-md"
                >
                  {meta.bestPlayed}
                </span>
                <p
                  className="font-bebas text-2xl tracking-wider mb-1 pr-20"
                  style={{ color: accent, textShadow: `0 0 18px ${accent}55` }}
                >
                  {meta.title.toUpperCase()}
                </p>
                <p className="text-cream/55 text-sm font-syne leading-relaxed">{meta.tagline}</p>
                <p className="text-cream/35 text-xs font-syne mt-3">{meta.players}</p>
              </motion.button>
            );
          })}
        </div>
        {/* Poker Face setup — how you're playing (spoken vs typed) + game length.
            Host-only controls; everyone else sees the chosen values read-only. */}
        {selectedGame === "pokerface" && (
          <div className="mt-4 space-y-4">
            <div>
              <p className="font-bebas text-sm text-cream/60 tracking-[0.25em] mb-2">
                HOW ARE YOU PLAYING?
              </p>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { v: "inperson" as const, label: "SAME ROOM", sub: "Claims spoken out loud. The face is the tell." },
                  { v: "remote" as const, label: "REMOTE", sub: "Claims typed on screen. Read the words." },
                ]).map((opt) => {
                  const on = pfMode === opt.v;
                  return (
                    <button
                      key={opt.v}
                      onClick={() => isHost && setPfMode(opt.v)}
                      disabled={!isHost}
                      className="text-left rounded-xl p-3 transition-all active:scale-[0.98] disabled:cursor-not-allowed"
                      style={{
                        background: on
                          ? "linear-gradient(135deg, rgba(0,191,255,0.2) 0%, rgba(0,191,255,0.05) 100%)"
                          : "rgba(255,255,255,0.03)",
                        border: on ? "1px solid rgba(0,191,255,0.6)" : "1px solid rgba(255,255,255,0.08)",
                        opacity: isHost || on ? 1 : 0.6,
                      }}
                    >
                      <p className="font-bebas text-sm tracking-wider" style={{ color: on ? "#7DD3FC" : "rgba(238,244,255,0.7)" }}>
                        {opt.label}
                      </p>
                      <p className="text-cream/45 text-[11px] font-syne mt-0.5 leading-snug">{opt.sub}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="font-bebas text-sm text-cream/60 tracking-[0.25em] mb-2">
                ROUNDS
                <span className="text-cream/30 ml-2 normal-case tracking-normal">
                  · everyone presents {pfRotations === 1 ? "once" : `${pfRotations} times`}
                </span>
              </p>
              <div className="flex gap-2">
                {[1, 2, 3].map((n) => {
                  const on = pfRotations === n;
                  return (
                    <button
                      key={n}
                      onClick={() => isHost && setPfRotations(n)}
                      disabled={!isHost}
                      className="flex-1 py-2.5 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95 disabled:cursor-not-allowed"
                      style={{
                        background: on
                          ? "linear-gradient(135deg, rgba(0,191,255,0.2) 0%, rgba(0,191,255,0.05) 100%)"
                          : "rgba(255,255,255,0.03)",
                        border: on ? "1px solid rgba(0,191,255,0.6)" : "1px solid rgba(255,255,255,0.08)",
                        color: on ? "#7DD3FC" : "rgba(238,244,255,0.6)",
                        opacity: isHost || on ? 1 : 0.6,
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="text-cream/45 text-xs font-syne text-center">
              {pfMode === "inperson"
                ? "Best face to face. Share the room code, gather your crew, and read the tells in the room."
                : "Playing apart? Read the words and the timing. Trust your gut."}
            </p>
          </div>
        )}
        {!isHost && (
          <p className="text-cream/40 text-xs font-syne mt-3 italic text-center">
            Only the host can pick the game.
          </p>
        )}
      </div>

      {/* Per-player topic picks (sketch only). Each player picks up to 2
          subjects they'd most like to draw/guess. The server weights the
          word picker by overlap across all players — popular subjects
          surface more often. Tap a chip to toggle; if you'd already have
          3 picked, the oldest drops. */}
      {selectedGame === "sketch" && (
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">
              YOUR TOPICS
              <span className="text-cream/30 ml-2 normal-case tracking-normal">
                · pick up to {MAX_TOPIC_PICKS} · {myTopics.length}/{MAX_TOPIC_PICKS} chosen
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {ALL_SUBJECTS.map((s) => {
              const mine = myTopics.includes(s);
              const votes = subjectVotes[s] ?? 0;
              return (
                <button
                  key={s}
                  onClick={() => toggleTopic(s)}
                  className="px-3 py-1.5 rounded-full font-syne text-xs transition-all active:scale-95 inline-flex items-center gap-1.5"
                  style={{
                    background: mine
                      ? "linear-gradient(135deg, rgba(236,72,153,0.22) 0%, rgba(168,85,247,0.10) 100%)"
                      : votes > 0
                        ? "rgba(168,85,247,0.06)"
                        : "rgba(255,255,255,0.03)",
                    border: mine
                      ? "1px solid rgba(236,72,153,0.55)"
                      : votes > 0
                        ? "1px solid rgba(168,85,247,0.25)"
                        : "1px solid rgba(255,255,255,0.08)",
                    color: mine ? "#FBCFE8" : votes > 0 ? "#E9D5FF" : "rgba(238,244,255,0.5)",
                  }}
                >
                  {SUBJECT_LABELS[s]}
                  {votes > 0 && (
                    <span
                      className="font-bebas text-[10px] tracking-wider opacity-80"
                      aria-label={`${votes} votes`}
                    >
                      ×{votes}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {myTopics.length === 0 && (
            <p className="text-cream/40 text-xs font-syne mt-3 italic">
              No picks yet. Skip to play any subject, or pick 1-2 to bias toward them.
            </p>
          )}
        </div>
      )}

      {/* Start CTA (host only). Disabled until enough players AND all are ready. */}
      {isHost && (
        <div className="space-y-1.5">
          <button
            onClick={startGame}
            disabled={starting || !enoughPlayers || !allReady}
            className="w-full py-4 rounded-xl font-bebas text-xl tracking-wider transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              background: `linear-gradient(135deg, ${GAME_META[selectedGame].accent} 0%, ${GAME_META[selectedGame].accent}99 100%)`,
              color: selectedGame === "sketch" ? "#fff" : "#04080F",
              boxShadow: `0 4px 20px ${GAME_META[selectedGame].accent}4d`,
            }}
          >
            {starting ? "STARTING..." : `START ${GAME_META[selectedGame].short}`}
          </button>
          {!enoughPlayers && (
            <p className="text-cream/40 text-xs font-syne text-center italic">
              Need {minPlayers} players minimum.
            </p>
          )}
          {enoughPlayers && !allReady && (
            <p className="text-cream/40 text-xs font-syne text-center italic">
              Waiting for {players.length - readyCount} player
              {players.length - readyCount === 1 ? "" : "s"} to ready up.
            </p>
          )}
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm font-syne text-center" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
