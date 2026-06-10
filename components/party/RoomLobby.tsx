"use client";

// Lobby view for Lionade Party rooms.
// Player list + ready toggle + game-select cards + Start button (host only).

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import { supabase } from "@/lib/supabase";
import RoomCodeShare from "./RoomCodeShare";
import { SUBJECT_LABELS, SUBJECTS as ALL_SUBJECTS } from "@/lib/party/word-lists-stub";
import { nudgeChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import type { PartyPlayer, PartyRoom } from "@/lib/party/types";
import AnimatedUsername from "@/components/AnimatedUsername";
import { resolveRowUsernameEffect } from "@/lib/use-username-effect";

const MAX_PLAYERS = 6;

type PartyGame = "sketch" | "bluff" | "pokerface";

// ── Hurry-up nudge phrases (Gen-Z, light-hearted, family-safe, no em-dashes) ──
// Tapped from the rotating "NUDGE THE HOST" button by non-hosts; everyone in
// the room sees the toast. Keep it short, fun, never mean.
const NUDGE_PHRASES = [
  "hurry up bro",
  "tick tock",
  "we're growing old",
  "any day now",
  "let's gooo",
  "did your wifi die?",
  "you good?",
  "respectfully, start the game",
  "the suspense is killing me",
  "i could've cooked dinner by now",
  "starting today?",
  "the game is waiting on you",
  "we believe in you king",
  "buffering?",
  "press the button",
  "i made coffee in the meantime",
  "are you afk?",
  "my battery is at 5%",
  "the people are restless",
  "this isn't a stream, you can start",
];

// One nudger has the button for NUDGE_WINDOW_MS, then it rotates. All clients
// compute the same active nudger from wall-clock + the active-player list so
// nobody needs a server arbiter for a piece of fun chrome.
const NUDGE_WINDOW_MS = 45_000;
const TOAST_LIFE_MS = 3_500;

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
    players: "2 to 6 players",
    minPlayers: 2,
    bestPlayed: "Remote OK",
  },
  pokerface: {
    title: "Poker Face",
    short: "POKER FACE",
    tagline: "Hold a secret fact. Present truth or a bluff. The room calls it.",
    accent: "#00BFFF",
    players: "2 to 6 players",
    minPlayers: 2,
    bestPlayed: "Best in person",
  },
};

export default function RoomLobby({ room, players, isHost, meUserId, onGameStarted }: Props) {
  const reduced = useReducedMotion();
  // Auto-suggest a fresh game when the group is returning from a finished
  // round. If room.last_game is set, default to anything BUT that — keeps
  // the post-game lobby feeling like a forward step instead of a rerun.
  // (Host can still pick the same game; this just changes the default.)
  const [selectedGame, setSelectedGame] = useState<PartyGame>(() => {
    const last = room.last_game;
    if (last === "sketch") return "bluff";
    if (last === "bluff") return "pokerface";
    if (last === "pokerface") return "sketch";
    return "sketch";
  });
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poker Face host settings (only sent when starting pokerface).
  const [pfMode, setPfMode] = useState<"inperson" | "remote">("inperson");
  const [pfRotations, setPfRotations] = useState<number>(2);
  const [showRules, setShowRules] = useState(false);

  // ── "Hurry up bro" nudge mechanic ──
  // Rotating button among NON-HOST players: one at a time, holds it for ~45s
  // before the next seat gets a turn. Active nudger is derived from wall clock
  // + the non-host list so every client picks the same person without a server.
  const nonHostPlayers = players.filter((p) => p.user_id !== room.host_user_id);
  // Tick state forces a re-render once per second so the active-nudger derive
  // re-evaluates as the wall-clock window rolls over.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const iv = setInterval(() => setNowTick((n) => n + 1), 1000);
    return () => clearInterval(iv);
  }, []);
  const nudgeWindowIdx = Math.floor(Date.now() / NUDGE_WINDOW_MS);
  const activeNudger = nonHostPlayers.length > 0
    ? nonHostPlayers[nudgeWindowIdx % nonHostPlayers.length]
    : null;
  const amActiveNudger = !!activeNudger && activeNudger.user_id === meUserId;
  // Local "I already nudged this window" gate so the button shows a cooldown
  // state after they tap. Resets when the window rolls over (the ref captures
  // the window it was set for).
  const lastNudgeWindowRef = useRef<number | null>(null);
  const alreadyNudgedThisWindow = lastNudgeWindowRef.current === nudgeWindowIdx;

  // Dismiss-room (host-only). One-tap close that ends the room for everyone
  // and lands them back on /games/party with a ROOM_DISMISSED broadcast.
  const [dismissing, setDismissing] = useState(false);
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  function confirmDismiss() {
    setShowDismissConfirm(true);
  }
  async function doDismiss() {
    if (dismissing) return;
    setDismissing(true);
    const res = await apiPost(`/api/party/rooms/${room.code}/dismiss`, {});
    setDismissing(false);
    setShowDismissConfirm(false);
    if (!res.ok) {
      toastError("Couldn't close the room. Try again.");
      return;
    }
    toastSuccess("Room closed.");
    if (typeof window !== "undefined") window.location.href = "/games/party";
  }
  // ── V2 — pending join requests (host-only banner) ──
  type JoinReq = {
    request_id: string;
    requester_user_id: string;
    requester_name: string;
    requester_avatar: string | null;
    note?: string | null;
  };
  const [pendingJoins, setPendingJoins] = useState<JoinReq[]>([]);
  const [deciding, setDeciding] = useState<Record<string, boolean>>({});

  // ── V2 — lobby chat (between rounds) ──
  type ChatMsg = { id: string; user_id: string; user_name: string | null; body: string; created_at: string };
  const [chatMessages, setChatMessages] = useState<ChatMsg[]>([]);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatDraft, setChatDraft] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatHydrated, setChatHydrated] = useState(false);

  // ── V2 — spectator toggle ──
  const meRow = players.find((p) => p.user_id === meUserId);
  const isSpectator = !!meRow?.is_spectator;
  const [specPending, setSpecPending] = useState(false);
  async function toggleSpectator() {
    if (specPending) return;
    setSpecPending(true);
    const res = await apiPost<{ ok: boolean; is_spectator: boolean }>(
      `/api/party/rooms/${room.code}/spectate`,
      { on: !isSpectator },
    );
    setSpecPending(false);
    if (!res.ok) {
      toastError("Couldn't update spectator mode.");
      return;
    }
    toastSuccess(res.data?.is_spectator ? "Watching only." : "Playing again.");
  }

  // Listen for room-wide broadcasts: dismiss, lobby chat, join requests/decisions.
  useEffect(() => {
    const ch = supabase.channel(`party-room-${room.code}`);
    ch.on("broadcast", { event: PARTY_EVENTS.ROOM_DISMISSED }, () => {
      if (typeof window !== "undefined") {
        toastError("The host closed this room.");
        window.location.href = "/games/party";
      }
    });
    ch.on("broadcast", { event: PARTY_EVENTS.LOBBY_CHAT }, (msg: { payload?: unknown }) => {
      const p = (msg.payload ?? {}) as Partial<ChatMsg> & { message_id?: string };
      if (!p.message_id || !p.body) return;
      const m: ChatMsg = {
        id: p.message_id,
        user_id: p.user_id ?? "",
        user_name: p.user_name ?? null,
        body: p.body,
        created_at: p.created_at ?? new Date().toISOString(),
      };
      setChatMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-50)));
    });
    if (isHost) {
      ch.on("broadcast", { event: PARTY_EVENTS.JOIN_REQUEST }, (msg: { payload?: unknown }) => {
        const p = (msg.payload ?? {}) as Partial<JoinReq>;
        if (!p.request_id || !p.requester_user_id) return;
        const req: JoinReq = {
          request_id: p.request_id,
          requester_user_id: p.requester_user_id,
          requester_name: p.requester_name ?? "Player",
          requester_avatar: p.requester_avatar ?? null,
          note: p.note ?? null,
        };
        setPendingJoins((prev) =>
          prev.some((r) => r.request_id === req.request_id) ? prev : [...prev, req].slice(-3),
        );
      });
    }
    ch.on("broadcast", { event: PARTY_EVENTS.JOIN_DECISION }, (msg: { payload?: unknown }) => {
      const p = (msg.payload ?? {}) as { request_id?: string };
      if (!p.request_id) return;
      setPendingJoins((prev) => prev.filter((r) => r.request_id !== p.request_id));
    });
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [room.code, isHost]);

  // Hydrate the host banner from server on mount: rebroadcast misses if the
  // host opened the lobby AFTER the requester submitted. Fetched once.
  useEffect(() => {
    if (!isHost) return;
    let cancelled = false;
    async function hydrate() {
      const res = await apiGet<{ pending: JoinReq[] }>(
        `/api/party/rooms/${room.code}/join-requests`,
      );
      if (cancelled || !res.ok || !res.data) return;
      setPendingJoins(res.data.pending ?? []);
    }
    hydrate();
    return () => {
      cancelled = true;
    };
  }, [isHost, room.code]);

  // Hydrate the chat panel once on open (or on mount if we want last-20 always).
  useEffect(() => {
    if (chatHydrated) return;
    let cancelled = false;
    async function load() {
      const res = await apiGet<{ messages: ChatMsg[] }>(
        `/api/party/rooms/${room.code}/lobby-chat`,
      );
      if (cancelled) return;
      setChatHydrated(true);
      if (res.ok && res.data?.messages) setChatMessages(res.data.messages);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [room.code, chatHydrated]);

  async function decideJoinRequest(req: JoinReq, decision: "approve" | "decline") {
    setDeciding((d) => ({ ...d, [req.request_id]: true }));
    const res = await apiPost(
      `/api/party/rooms/${room.code}/join-requests/${req.request_id}/decide`,
      { decision },
    );
    setDeciding((d) => {
      const next = { ...d };
      delete next[req.request_id];
      return next;
    });
    if (!res.ok) {
      toastError("Couldn't decide. Try again.");
      return;
    }
    setPendingJoins((prev) => prev.filter((r) => r.request_id !== req.request_id));
  }

  async function sendChat() {
    const text = chatDraft.trim().slice(0, 200);
    if (text.length === 0 || chatSending) return;
    setChatSending(true);
    const res = await apiPost<{ ok: boolean; message: ChatMsg }>(
      `/api/party/rooms/${room.code}/lobby-chat`,
      { body: text },
    );
    setChatSending(false);
    if (!res.ok) {
      toastError("Couldn't send.");
      return;
    }
    setChatDraft("");
    if (res.data?.message) {
      const m = res.data.message;
      setChatMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m].slice(-50)));
    }
  }

  // Toast stack — visible to EVERYONE in the room when a nudge fires (it's
  // funnier when the whole room sees Brother spam the host). Self-pruning.
  type Toast = { id: string; phrase: string; sender: string };
  const [nudgeToasts, setNudgeToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const ch = supabase.channel(nudgeChannel(room.code));
    ch.on("broadcast", { event: PARTY_EVENTS.HOST_NUDGE }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { phrase?: string; sender?: string };
      if (!payload.phrase) return;
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const toast: Toast = { id, phrase: payload.phrase, sender: payload.sender ?? "Someone" };
      setNudgeToasts((prev) => [...prev, toast].slice(-4));
      setTimeout(() => {
        setNudgeToasts((prev) => prev.filter((t) => t.id !== id));
      }, TOAST_LIFE_MS);
    });
    ch.subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [room.code]);

  async function sendNudge() {
    if (!amActiveNudger || alreadyNudgedThisWindow) return;
    lastNudgeWindowRef.current = nudgeWindowIdx;
    const phrase = NUDGE_PHRASES[Math.floor(Math.random() * NUDGE_PHRASES.length)];
    const me = players.find((p) => p.user_id === meUserId);
    const ch = supabase.channel(nudgeChannel(room.code));
    await ch.send({
      type: "broadcast",
      event: PARTY_EVENTS.HOST_NUDGE,
      payload: { phrase, sender: me?.username ?? "Someone" },
    });
    // Locally echo (supabase broadcast doesn't echo to sender).
    const id = `local-${Date.now()}`;
    setNudgeToasts((prev) => [...prev, { id, phrase, sender: "You" }].slice(-4));
    setTimeout(() => {
      setNudgeToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_LIFE_MS);
  }

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
      console.error("[party:topics] failed", res.error);
      setError("Couldn't update topics. Try again.");
    }
  }

  async function toggleReady() {
    const target = !meReady;
    setOptimisticReady(target);  // instant visual
    setError(null);
    const res = await apiPost(`/api/party/rooms/${room.code}/ready`, { ready: target });
    if (!res.ok) {
      setOptimisticReady(null);  // revert to server truth
      console.error("[party:ready] failed", res.error);
      setError("Couldn't update your ready state. Try again.");
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
      console.error("[party:start-game] failed", res.error);
      setError("Couldn't start the game. Try again.");
      return;
    }
    onGameStarted(selectedGame);
  }

  return (
    <div className="space-y-7 max-w-3xl mx-auto">
      {/* Host-only pending join requests stack (top-right). Up to 3 visible. */}
      {isHost && pendingJoins.length > 0 && (
        <div
          aria-live="polite"
          className="fixed top-24 right-4 z-40 flex flex-col items-end gap-2 max-w-[320px] pointer-events-none"
        >
          <AnimatePresence initial={false}>
            {pendingJoins.map((req) => (
              <motion.div
                key={req.request_id}
                initial={reduced ? false : { opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, x: 24 }}
                transition={{ type: "spring", stiffness: 360, damping: 24 }}
                className="rounded-2xl p-3 pointer-events-auto shadow-2xl w-full"
                style={{
                  background: "linear-gradient(135deg, rgba(16,12,26,0.96) 0%, rgba(8,6,16,0.96) 100%)",
                  border: "1px solid rgba(255,215,0,0.45)",
                  boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
                }}
              >
                <div className="flex items-start gap-2.5">
                  <img
                    src={req.requester_avatar ?? `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(req.requester_name)}`}
                    alt=""
                    className="w-9 h-9 rounded-full bg-white/10 object-cover flex-shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-cream text-sm font-bold truncate">{req.requester_name}</p>
                    <p className="text-cream/55 text-[11px]">wants to join</p>
                    {req.note && (
                      <p className="text-cream/75 text-xs mt-1 italic line-clamp-2">
                        &ldquo;{req.note}&rdquo;
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 mt-2.5">
                  <button
                    onClick={() => decideJoinRequest(req, "approve")}
                    disabled={!!deciding[req.request_id]}
                    className="flex-1 px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide transition-all active:scale-95 disabled:opacity-50"
                    style={{
                      background: "linear-gradient(135deg, #22C55E 0%, #15803D 100%)",
                      color: "#04080F",
                    }}
                  >
                    {deciding[req.request_id] ? "..." : "Let in"}
                  </button>
                  <button
                    onClick={() => decideJoinRequest(req, "decline")}
                    disabled={!!deciding[req.request_id]}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold tracking-wide text-cream/70 transition-all active:scale-95 disabled:opacity-50"
                    style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    Pass
                  </button>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}

      {/* Lobby chat — collapsible bottom panel (mobile-friendly), always
          accessible to room members between rounds. */}
      <div
        className="fixed bottom-4 right-4 z-40 w-[320px] max-w-[88vw] pointer-events-auto"
      >
        {!chatOpen ? (
          <button
            type="button"
            onClick={() => setChatOpen(true)}
            className="ml-auto flex items-center gap-2 px-3 py-2 rounded-full text-xs font-bold tracking-wide text-cream/85 shadow-lg"
            style={{
              background: "linear-gradient(135deg, rgba(16,12,26,0.92) 0%, rgba(8,6,16,0.92) 100%)",
              border: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: chatMessages.length > 0 ? "#34D399" : "rgba(255,255,255,0.3)" }}
            />
            Lobby chat {chatMessages.length > 0 ? `· ${chatMessages.length}` : ""}
          </button>
        ) : (
          <div
            className="rounded-2xl flex flex-col"
            style={{
              background: "linear-gradient(135deg, rgba(16,12,26,0.96) 0%, rgba(8,6,16,0.96) 100%)",
              border: "1px solid rgba(255,255,255,0.1)",
              boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
              maxHeight: "60vh",
            }}
          >
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.06]">
              <p className="text-cream/75 text-[11px] font-bold uppercase tracking-wider">Lobby chat</p>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Close chat"
                className="text-cream/45 hover:text-cream/80 text-xs"
              >
                Hide
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-3 py-2 space-y-1.5 min-h-[120px]">
              {chatMessages.length === 0 ? (
                <p className="text-cream/35 text-xs italic">Say something while you wait.</p>
              ) : (
                chatMessages.map((m) => (
                  <div key={m.id} className="text-xs">
                    <span className="text-cream/55 font-semibold">{m.user_name ?? "Player"}: </span>
                    <span className="text-cream/85">{m.body}</span>
                  </div>
                ))
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendChat();
              }}
              className="flex items-center gap-2 px-2 py-2 border-t border-white/[0.06]"
            >
              <input
                type="text"
                value={chatDraft}
                onChange={(e) => setChatDraft(e.target.value.slice(0, 200))}
                placeholder="say hi"
                maxLength={200}
                className="flex-1 rounded-lg px-2.5 py-1.5 text-xs text-cream outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
              />
              <button
                type="submit"
                disabled={chatDraft.trim().length === 0 || chatSending}
                className="px-3 py-1.5 rounded-lg text-xs font-bold disabled:opacity-40"
                style={{
                  background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                  color: "#fff",
                }}
              >
                {chatSending ? "..." : "Send"}
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Nudge toast stack — fixed top center, visible to EVERYONE in the room
          when any non-host taps the rotating "nudge" button. */}
      <div
        aria-live="polite"
        className="fixed top-20 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none"
      >
        <AnimatePresence initial={false}>
          {nudgeToasts.map((t) => (
            <motion.div
              key={t.id}
              initial={reduced ? false : { opacity: 0, y: -16, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={reduced ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.95 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="rounded-full px-4 py-2 max-w-[80vw] shadow-lg"
              style={{
                background: "linear-gradient(135deg, rgba(236,72,153,0.95) 0%, rgba(168,85,247,0.95) 100%)",
                border: "1px solid rgba(255,255,255,0.2)",
                boxShadow: "0 10px 28px rgba(168,85,247,0.4)",
              }}
            >
              <p className="font-bebas text-white text-sm tracking-wide whitespace-nowrap overflow-hidden text-ellipsis">
                <span className="opacity-80">{t.sender}:</span> &ldquo;{t.phrase}&rdquo;
              </p>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Code share */}
      <div className="flex flex-col items-center gap-2">
        <RoomCodeShare code={room.code} />
        {!isHost && (
          <p className="font-syne text-xs text-cream/45 mt-1 inline-flex items-center gap-1.5">
            Host is setting things up
            <span aria-hidden="true" className="inline-flex items-center gap-0.5">
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  className={`w-1 h-1 rounded-full bg-cream/55 ${reduced ? "opacity-70" : "pa-ink-dot"}`}
                  style={reduced ? undefined : { animationDelay: `${i * 200}ms` }}
                />
              ))}
            </span>
          </p>
        )}
      </div>

      {/* Friend invite (Bucket C 2026-06-05): renders when the user has 1+
          accepted friends. Code-share above is preserved as the universal
          fallback. Section auto-hides on cold-start users (no friends).
          Players are passed so an invited friend's row flips to "In room"
          the moment they actually join. */}
      <FriendInviteSection code={room.code} players={players} />

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
                  <AnimatedUsername
                    username={p.username ?? "Player"}
                    effect={resolveRowUsernameEffect(p.equipped_username_effect)}
                    size="sm"
                  />
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

        {/* Spectator toggle (small, secondary). Hidden for hosts since they
            need to drive the game. */}
        {!isHost && (
          <button
            type="button"
            onClick={toggleSpectator}
            disabled={specPending}
            className="mt-2 w-full py-2 rounded-lg text-xs text-cream/50 hover:text-cream/85 transition-colors disabled:opacity-40"
            style={{ background: "rgba(255,255,255,0.02)", border: "1px dashed rgba(255,255,255,0.08)" }}
          >
            {isSpectator ? "Watching only · tap to play" : "Watch only (spectator)"}
          </button>
        )}
      </div>

      {/* ── Rotating "hurry up" nudge button ──
          Only shown to the non-host whose 45s window is active right now.
          One person at a time so the host doesn't get spam-floored. */}
      {amActiveNudger && (
        <motion.button
          onClick={sendNudge}
          disabled={alreadyNudgedThisWindow}
          whileTap={reduced ? undefined : { scale: 0.96 }}
          initial={reduced ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full py-3.5 rounded-xl font-bebas text-base tracking-wider transition-all disabled:cursor-not-allowed disabled:opacity-60"
          style={{
            background: alreadyNudgedThisWindow
              ? "linear-gradient(135deg, rgba(236,72,153,0.18) 0%, rgba(168,85,247,0.08) 100%)"
              : "linear-gradient(135deg, #EC4899 0%, #A855F7 100%)",
            border: alreadyNudgedThisWindow ? "1px solid rgba(236,72,153,0.4)" : "1px solid rgba(255,255,255,0.18)",
            color: alreadyNudgedThisWindow ? "#FBCFE8" : "#fff",
            boxShadow: alreadyNudgedThisWindow ? "none" : "0 4px 20px rgba(236,72,153,0.35)",
          }}
        >
          {alreadyNudgedThisWindow ? "NUDGE SENT · NEXT TURN IN A SEC" : "👉 NUDGE THE HOST"}
        </motion.button>
      )}

      {/* Post-game recap — surfaces when the group is returning from a finished
          game (room.last_game set + at least one player has a non-zero score).
          Compact card with top-3 from the just-finished game so the lobby
          beat feels like "intermission with results," not "fresh start."
          Hides on rematch (scores reset to 0) and on first lobby entry. */}
      {room.last_game && optimisticPlayers.some((p) => (p.score ?? 0) > 0) && (() => {
        const lastMeta = GAME_META[room.last_game];
        const recapTop = [...optimisticPlayers]
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 3)
          .filter((p) => (p.score ?? 0) > 0);
        return (
          <div
            className="rounded-2xl p-4"
            style={{
              background: `linear-gradient(135deg, ${lastMeta.accent}14 0%, rgba(16,12,26,0.6) 100%)`,
              border: `1px solid ${lastMeta.accent}40`,
              backdropFilter: "blur(10px)",
            }}
          >
            <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
              <p className="font-bebas text-[11px] tracking-[0.25em] text-cream/55">
                LAST GAME · <span style={{ color: lastMeta.accent }}>{lastMeta.short}</span>
              </p>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/35">
                pick the next one below
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {recapTop.map((p, i) => {
                const isMe = p.user_id === meUserId;
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉";
                return (
                  <span
                    key={p.user_id}
                    className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1"
                    style={{
                      background: isMe ? `${lastMeta.accent}22` : "rgba(255,255,255,0.04)",
                      border: isMe ? `1px solid ${lastMeta.accent}59` : "1px solid rgba(255,255,255,0.1)",
                    }}
                  >
                    <span className="text-sm" aria-hidden="true">{medal}</span>
                    <span className="font-syne text-xs text-cream/85 truncate max-w-[120px]">
                      {p.username ?? "Player"}
                      {isMe && <span className="text-cream/45 ml-1">you</span>}
                    </span>
                    <span className="font-bebas text-sm tabular-nums" style={{ color: lastMeta.accent }}>
                      {p.score ?? 0}
                    </span>
                  </span>
                );
              })}
            </div>
            <PostGameFriendPrompt players={optimisticPlayers} meUserId={meUserId} />
          </div>
        );
      })()}

      {/* Game select */}
      <div>
        <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
          <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">PICK A GAME</p>
          {room.last_game && (
            <span
              className="inline-flex items-center gap-1.5 font-bebas text-[10px] tracking-[0.2em] px-2.5 py-1 rounded-full"
              style={{
                background: `${GAME_META[room.last_game].accent}14`,
                border: `1px solid ${GAME_META[room.last_game].accent}40`,
                color: GAME_META[room.last_game].accent,
              }}
              title={`Your group last played ${GAME_META[room.last_game].title}`}
            >
              <span className="opacity-70 normal-case tracking-normal text-cream/55">last played</span>
              {GAME_META[room.last_game].short}
            </span>
          )}
        </div>
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
                  { v: "inperson" as const, label: "SAME ROOM OR CALL", sub: "Claims spoken out loud. Read the face and the voice." },
                  { v: "remote" as const, label: "TEXT ONLY", sub: "Claims typed on screen. No call needed." },
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
                ? "Same room or on a video call. Share the code, say your claim out loud, and read the room."
                : "No call? Claims are typed on screen. Read the words and the timing, and trust your gut."}
            </p>

            {/* How to play — collapsible so newcomers can learn the game */}
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.08)" }}>
              <button
                onClick={() => setShowRules((s) => !s)}
                className="w-full px-4 py-2.5 flex items-center justify-between text-left transition-colors"
                style={{ background: "rgba(255,255,255,0.03)" }}
              >
                <span className="font-bebas text-sm text-cream/70 tracking-[0.2em]">HOW TO PLAY</span>
                <span className="font-bebas text-cream/40 text-lg leading-none">{showRules ? "−" : "+"}</span>
              </button>
              {showRules && (
                <ol className="px-4 py-3 space-y-1.5 text-cream/65 text-xs font-syne list-decimal list-inside">
                  <li>Each round one player gets a secret fact. Everyone else sees only the topic word.</li>
                  <li>That player presents it as the truth, or makes up a lie, and says it out loud (or types it in Text Only mode).</li>
                  <li>One player gets to grill them with a single question first. Watch how they answer.</li>
                  <li>Everyone else calls Believe or Doubt.</li>
                  <li>Catch a lie or trust a truth and you score. Fool the room and the presenter scores. Get fully caught lying and you lose points.</li>
                  <li>Most fools wins Bluff Master. Most correct reads wins Human Lie Detector.</li>
                </ol>
              )}
            </div>
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
          {!showDismissConfirm ? (
            <button
              onClick={confirmDismiss}
              disabled={dismissing}
              className="w-full py-2 rounded-lg font-syne text-xs text-cream/40 hover:text-red-300/80 transition-colors disabled:opacity-40"
            >
              Close room
            </button>
          ) : (
            <div className="flex items-center gap-2 pt-1">
              <p className="text-cream/60 text-xs flex-1">
                Close the room for everyone?
              </p>
              <button
                onClick={() => setShowDismissConfirm(false)}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-cream/65"
                style={{ background: "rgba(255,255,255,0.04)" }}
              >
                Cancel
              </button>
              <button
                onClick={doDismiss}
                disabled={dismissing}
                className="px-3 py-1.5 rounded-lg text-xs font-bold text-red-200"
                style={{ background: "rgba(239,68,68,0.18)", border: "1px solid rgba(239,68,68,0.4)" }}
              >
                {dismissing ? "Closing..." : "Yes, close"}
              </button>
            </div>
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


// ── Friend Invite section (Bucket C 2026-06-05) ──
// Renders inside the lobby when the user has 1+ accepted friends. Each friend
// row exposes a one-tap "Invite" button that hits POST /api/party/rooms/[code]
// /invite-friend; backend drops a `party_invite` notification on the friend
// with a deep-link to the room. RoomCodeShare is preserved (this section is
// additive, not a replacement).
//
// Surfacing friends as the FIRST class of invite (with code-share as fallback)
// matches the audit ask: the friend graph is the primary social primitive,
// the room code is the universal-fallback. We render up to 8 friends sorted
// by online-status then last-seen so the most likely-to-accept friends bubble
// to the top.
interface InviteFriendsProps {
  code: string;
  /** Live players list — an invited friend's row drops its pending state the
   *  moment their user_id shows up here (they actually joined). */
  players: PartyPlayer[];
}
interface FriendLite {
  id: string;
  username: string;
  avatar_url: string | null;
  is_online: boolean;
}
function FriendInviteSection({ code, players }: InviteFriendsProps) {
  const { data, error, isLoading } = useSWR<{
    friends: FriendLite[];
  }>("/api/social/friends", async () => {
    const res = await apiGet<{ friends: FriendLite[] }>("/api/social/friends");
    if (!res.ok || !res.data) return { friends: [] };
    return { friends: res.data.friends ?? [] };
  }, {
    dedupingInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });

  const friends = data?.friends ?? [];

  // Per-friend invite state: "idle" | "sending" | "invited" | "in-room".
  // "invited" PERSISTS for the lobby session (no 4s reset) — the button stays
  // dim with an "Invited" check + subtle pulse until the friend actually
  // joins, at which point the row flips to "In room" via the live players
  // list and the pending state drops naturally. Component state only; no DB.
  const [statusById, setStatusById] = useState<Record<string, "idle" | "sending" | "invited" | "in-room">>({});

  // user_ids currently in the room (live — refreshed by PLAYER_JOINED
  // broadcasts + the page's 3s safety-net poll).
  const inRoomIds = useMemo(() => new Set(players.map((p) => p.user_id)), [players]);

  const sortedFriends = useMemo(() => {
    // Online friends first, then offline (alphabetical within each group).
    const copy = [...friends];
    copy.sort((a, b) => {
      if (a.is_online !== b.is_online) return a.is_online ? -1 : 1;
      return (a.username ?? "").localeCompare(b.username ?? "");
    });
    return copy.slice(0, 8);
  }, [friends]);

  const inviteFriend = async (friendId: string) => {
    if (statusById[friendId] === "sending" || statusById[friendId] === "invited") return;
    setStatusById(s => ({ ...s, [friendId]: "sending" }));
    const res = await apiPost<{ ok: true; invitedUsername: string | null }>(
      `/api/party/rooms/${code}/invite-friend`,
      { friendId },
    );
    if (!res.ok) {
      const errMsg = res.error ?? "Couldn\'t send invite.";
      // Receiver already in this room → "in-room" badge (not an error to surface)
      if (errMsg.toLowerCase().includes("already in this room")) {
        setStatusById(s => ({ ...s, [friendId]: "in-room" }));
        return;
      }
      toastError(errMsg);
      setStatusById(s => ({ ...s, [friendId]: "idle" }));
      return;
    }
    toastSuccess(`Invite sent to ${res.data?.invitedUsername ?? "your friend"}`);
    setStatusById(s => ({ ...s, [friendId]: "invited" }));
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl p-5"
        style={{
          background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
          border: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        <p className="font-bebas text-sm text-cream/60 tracking-[0.25em] mb-3">INVITE FRIENDS</p>
        <div className="grid grid-cols-2 gap-2">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className="h-11 rounded-lg bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  if (error || friends.length === 0) {
    // Don\'t render the section at all if the user has no friends — the
    // room-code share above is already the universal invite path. Keeps the
    // lobby calm for solo / cold-start users.
    return null;
  }

  return (
    <div className="rounded-2xl p-5"
      style={{
        background: "linear-gradient(135deg, rgba(16,12,26,0.7) 0%, rgba(8,6,16,0.7) 100%)",
        border: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <p className="font-bebas text-sm text-cream/60 tracking-[0.25em]">INVITE FRIENDS</p>
        <p className="text-cream/35 text-[10px] font-syne italic">
          They\'ll get a notification with a one-tap join.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {sortedFriends.map(f => {
          // Live players list wins: once the friend is actually in the room,
          // the row shows "In room" regardless of any pending invite state.
          const status: "idle" | "sending" | "invited" | "in-room" = inRoomIds.has(f.id)
            ? "in-room"
            : statusById[f.id] ?? "idle";
          const labelText = status === "sending" ? "..."
            : status === "invited" ? "Invited"
            : status === "in-room" ? "In room"
            : "Invite";
          return (
            <div
              key={f.id}
              className="rounded-lg px-3 py-2 flex items-center gap-2.5"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.07)",
              }}
            >
              <div className="relative shrink-0">
                <img
                  src={f.avatar_url ?? `https://api.dicebear.com/9.x/identicon/svg?seed=${encodeURIComponent(f.username)}`}
                  alt=""
                  className="w-8 h-8 rounded-full bg-white/10 object-cover"
                />
                {f.is_online && (
                  <span
                    aria-hidden="true"
                    className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2"
                    style={{ background: "#22C55E", borderColor: "#0a0610" }}
                  />
                )}
              </div>
              <span className="flex-1 font-syne text-sm text-cream/85 truncate">{f.username}</span>
              <button
                onClick={() => inviteFriend(f.id)}
                disabled={status === "sending" || status === "invited" || status === "in-room"}
                className={`shrink-0 px-2.5 py-1 rounded-md font-bebas text-[11px] tracking-wider transition-all ${
                  status === "invited"
                    // Pending: dim + check + subtle pulse (motion-safe only)
                    // until the friend's user_id appears in the players list.
                    ? "text-cream/45 bg-white/[0.04] border border-white/10 opacity-70 motion-safe:animate-pulse"
                    : status === "in-room"
                    ? "text-green-300 bg-green-500/15 border border-green-500/30"
                    : status === "sending"
                    ? "text-cream/50 bg-white/[0.04] border border-white/10"
                    : "text-electric bg-electric/10 border border-electric/30 hover:bg-electric/20"
                }`}
                aria-label={status === "idle" ? `Invite ${f.username}` : labelText}
              >
                {status === "invited" && <span aria-hidden="true">✓ </span>}
                {labelText}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Post-Game Friend Prompt ──
// V2 — when a game ends and players land back in the lobby, for each non-friend
// who was in the room render a small "Add as friend?" tile. Lightweight, one
// request per add, easy to dismiss. Skipped entirely if everyone is already
// a friend or if the user has no email/account context.
function PostGameFriendPrompt({ players, meUserId }: { players: PartyPlayer[]; meUserId: string }) {
  type Status = "idle" | "sending" | "sent" | "already" | "dismissed" | "error";
  const [byId, setById] = useState<Record<string, Status>>({});
  const [friendIdSet, setFriendIdSet] = useState<Set<string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadFriends() {
      const res = await apiGet<{ friends: { id: string }[] }>(`/api/social/friends`);
      if (cancelled || !res.ok || !res.data) {
        setFriendIdSet(new Set());
        return;
      }
      setFriendIdSet(new Set(res.data.friends.map((f) => f.id)));
    }
    loadFriends();
    return () => {
      cancelled = true;
    };
  }, []);

  const candidates = players.filter(
    (p) => p.user_id !== meUserId && (!friendIdSet || !friendIdSet.has(p.user_id)),
  );

  if (friendIdSet === null) return null;
  if (candidates.length === 0) return null;

  async function addFriend(otherId: string, otherUsername: string | null) {
    setById((s) => ({ ...s, [otherId]: "sending" }));
    if (!otherUsername) {
      setById((s) => ({ ...s, [otherId]: "error" }));
      return;
    }
    const res = await apiPost<{ ok: boolean }>(`/api/social/friends`, { friendUsername: otherUsername });
    if (!res.ok) {
      const errMsg = (res.error ?? "").toLowerCase();
      if (errMsg.includes("already") || errMsg.includes("pending")) {
        setById((s) => ({ ...s, [otherId]: "already" }));
        return;
      }
      setById((s) => ({ ...s, [otherId]: "error" }));
      return;
    }
    setById((s) => ({ ...s, [otherId]: "sent" }));
  }

  return (
    <div className="mt-3 pt-3 border-t border-white/[0.06]">
      <p className="text-cream/55 text-[10px] font-bold uppercase tracking-widest mb-2">
        Played with new faces? Add them.
      </p>
      <div className="flex flex-wrap gap-1.5">
        {candidates.map((p) => {
          const s = byId[p.user_id] ?? "idle";
          if (s === "dismissed") return null;
          const label =
            s === "sending" ? "..."
            : s === "sent" ? "Sent"
            : s === "already" ? "Already"
            : s === "error" ? "Try again"
            : `+ Add ${p.username ?? "Player"}`;
          const disabled = s === "sending" || s === "sent" || s === "already";
          return (
            <button
              key={p.user_id}
              type="button"
              onClick={() => addFriend(p.user_id, p.username)}
              disabled={disabled}
              className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all"
              style={{
                background:
                  s === "sent" ? "rgba(34,197,94,0.18)"
                  : s === "already" ? "rgba(255,255,255,0.04)"
                  : "rgba(168,85,247,0.18)",
                border:
                  s === "sent" ? "1px solid rgba(34,197,94,0.45)"
                  : s === "already" ? "1px solid rgba(255,255,255,0.08)"
                  : "1px solid rgba(168,85,247,0.42)",
                color:
                  s === "sent" ? "#86EFAC"
                  : s === "already" ? "rgba(238,244,255,0.5)"
                  : "#E9D5FF",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
