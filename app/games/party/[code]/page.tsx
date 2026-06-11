"use client";

// /games/party/[code] — Lionade Party room shell.
//
// Bootstraps:
//   1. Auto-join the room (idempotent — server returns already_member=true if so).
//   2. Subscribe to the party-room-${code} channel for room-state updates.
//   3. Poll the room snapshot every ~3s as a safety net for missed events.
//   4. Render lobby / SketchView / BluffView based on room.status + current_game.

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { apiGet, apiPost } from "@/lib/api-client";
import { supabase } from "@/lib/supabase";
import { roomChannel, roomPlayersChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import { normalizeRoomCode } from "@/lib/party/room-code";
import { useAuth } from "@/lib/auth";
import { useHeartbeat } from "@/lib/use-heartbeat";
import { useActiveSession } from "@/lib/active-session";
import { useToast } from "@/components/Toast";
import RoomLobby from "@/components/party/RoomLobby";
import dynamic from "next/dynamic";
import type { CurrentGame, PartyPlayer, PartyRoom } from "@/lib/party/types";

// Game views are heavy (SketchView ~2.2k LOC, PokerFaceView ~1.3k, BluffView
// ~0.9k). At most one mounts at a time based on room.current_game, so we
// lazy-load each. ssr:false because the room is client-state-driven.
const SketchView = dynamic(() => import("@/components/party/SketchView"), { ssr: false });
const BluffView = dynamic(() => import("@/components/party/BluffView"), { ssr: false });
const PokerFaceView = dynamic(() => import("@/components/party/PokerFaceView"), { ssr: false });
const TriviaView = dynamic(() => import("@/components/party/TriviaView"), { ssr: false });
import type { ActiveRoundLite } from "@/lib/party/room-state";

interface Snapshot {
  room: PartyRoom;
  players: PartyPlayer[];
  meUserId: string;
  isHost: boolean;
  activeRound?: ActiveRoundLite | null;
}

export default function PartyRoomPage() {
  const params = useParams<{ code: string }>();
  const router = useRouter();
  const { user } = useAuth();
  // Codes are 4-digit numeric (as of 2026-05-27). normalizeRoomCode strips
  // anything that isn't a digit, so a URL like /games/party/12-34 still resolves.
  const code = normalizeRoomCode(params?.code ?? "");

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [leaving, setLeaving] = useState(false);

  // Tier 1 lifecycle hooks (Phase 1 — 2026-06-04).
  // Heartbeat keeps the server's AFK reaper happy while the user is on this
  // page; the reaper window is 60s so a 10s cadence has 6x safety margin.
  useHeartbeat(code ? "party_room" : null, code || null);

  // Reconnect-on-mount: if the user's active_session pointer disagrees with
  // the URL they hit (e.g. they bookmarked an old room, or were tabbed
  // through stale history), nudge them to the canonical room. Soft-redirect
  // so they're not silently re-routed mid-flow — the toast gives them an
  // out if they explicitly wanted to leave.
  const { session: activeSession } = useActiveSession();
  const { toast } = useToast();
  const reconcileFiredRef = useRef(false);
  useEffect(() => {
    if (!activeSession || !code || reconcileFiredRef.current) return;
    if (activeSession.type === "party_room" && activeSession.id !== code) {
      reconcileFiredRef.current = true;
      toast(`You're already in room ${activeSession.id}`, {
        type: "info",
        duration: 6000,
        action: {
          label: "Resume",
          onClick: () => router.replace(`/games/party/${activeSession.id}`),
        },
      });
    }
  }, [activeSession, code, router, toast]);

  const refresh = useCallback(async () => {
    const res = await apiGet<Snapshot>(`/api/party/rooms/${code}`);
    if (!res.ok || !res.data) {
      if (res.status !== 404) console.error("[party:load-room] failed", res.error);
      setError(res.status === 404 ? "That room isn't open." : "Couldn't load room. Try again.");
      return null;
    }
    setSnap(res.data);
    return res.data;
  }, [code]);

  // ── Bootstrap: join + first snapshot ──
  // Idempotency guard (invite-403 postmortem 2026-06-10): this effect can fire
  // twice for the same user+code (React StrictMode double-mount in dev, or a
  // fast remount), which used to POST /join twice concurrently — both reads
  // saw no existing row and both inserted. The ref caches the in-flight join
  // promise keyed by user+code so the second run AWAITS the first join
  // instead of firing its own; the key resets on failure so a retry/remount
  // can join again.
  const joinRef = useRef<{ key: string; promise: Promise<{ ok: boolean; error?: string | null }> } | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !code) return;
    const joinKey = `${user.id}:${code}`;
    (async () => {
      if (!joinRef.current || joinRef.current.key !== joinKey) {
        joinRef.current = {
          key: joinKey,
          promise: apiPost(`/api/party/rooms/${code}/join`, {}),
        };
      }
      const joinRes = await joinRef.current.promise;
      if (!joinRes.ok && joinRef.current?.key === joinKey) {
        joinRef.current = null; // allow a fresh attempt on retry/remount
      }
      if (cancelled) return;
      if (!joinRes.ok) {
        console.error("[party:join-room] failed", joinRes.error);
        setError("Couldn't join the room. Try again.");
        setLoading(false);
        return;
      }
      await refresh();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, code, refresh]);

  // ── Tab-close cleanup ──
  // The leave endpoint already auto-promotes the next-oldest player to host
  // when the leaver was the host (see api/party/rooms/[code]/leave/route.ts).
  // But that only fires if `leave` is actually called — without this handler
  // a host who closes their tab leaves an orphaned host_user_id behind.
  //
  // We can't use navigator.sendBeacon here because requireAuth() needs the
  // Bearer header and sendBeacon can't set headers. fetch + keepalive: true
  // is the supported alternative — it survives unload and accepts headers.
  const accessTokenRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then((res: { data: { session: { access_token?: string } | null } }) => {
      if (!cancelled) accessTokenRef.current = res.data.session?.access_token ?? null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: { access_token?: string } | null) => {
        accessTokenRef.current = session?.access_token ?? null;
      },
    );
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!code) return;
    const fireLeaveOnUnload = () => {
      const token = accessTokenRef.current;
      if (!token) return;
      try {
        void fetch(`/api/party/rooms/${code}/leave`, {
          method: "POST",
          keepalive: true,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: "{}",
        });
      } catch {
        // Best-effort — if it fails, the room poll will eventually clean up
        // when other players notice the disconnected host.
      }
    };
    window.addEventListener("pagehide", fireLeaveOnUnload);
    return () => {
      window.removeEventListener("pagehide", fireLeaveOnUnload);
    };
  }, [code]);

  // ── Realtime subscribe: room-state changes ──
  // Kept in a ref so broadcast helpers below (game start/end, leave) send on
  // the ALREADY-SUBSCRIBED channel (fast ws push) instead of minting a fresh
  // unsubscribed channel per send — the old pattern fell back to the slower
  // HTTP broadcast path AND leaked one channel instance per send.
  //
  // OWNERSHIP (connectivity audit 2026-06-11): this page is the SOLE owner of
  // the party-room-{code} channel. supabase-js dedupes channels by topic
  // (client.channel() returns the existing instance) and — crucially —
  // RealtimeClient._remove() detaches by TOPIC, so any other component that
  // called removeChannel on "its own" same-topic channel was actually
  // unsubscribing THIS page's channel. That is exactly what RoomLobby's old
  // cleanup did on game start: the room channel went deaf for the rest of the
  // game and GAME_ENDED / PLAYER_JOINED only landed via the 3s poll. RoomLobby
  // now receives this channel as a prop (state below) and never removes it.
  const roomChRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const [roomCh, setRoomCh] = useState<ReturnType<typeof supabase.channel> | null>(null);
  const roomId = snap?.room?.id;
  useEffect(() => {
    if (!code) return;
    const ch = supabase.channel(roomChannel(code));
    ch.on("broadcast", { event: PARTY_EVENTS.PLAYER_JOINED }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.PLAYER_LEFT }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.GAME_STARTED }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.GAME_ENDED }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.ROOM_UPDATED }, () => void refresh());
    // Fast-path ready flips: patch the player list in place from the broadcast
    // payload (no snapshot GET round-trip). The postgres_changes feed below +
    // the 3s poll reconcile if a broadcast was stale or dropped.
    ch.on("broadcast", { event: PARTY_EVENTS.READY_CHANGED }, (msg: { payload?: unknown }) => {
      const p = (msg.payload ?? {}) as { user_id?: string; is_ready?: boolean };
      if (!p.user_id || typeof p.is_ready !== "boolean") return;
      setSnap((prev) =>
        prev
          ? {
              ...prev,
              players: prev.players.map((pl) =>
                pl.user_id === p.user_id ? { ...pl, is_ready: p.is_ready! } : pl,
              ),
            }
          : prev,
      );
    });
    // Postgres changes are also wired — Supabase Realtime fires for table rows
    // in the publication. We listen for room status changes specifically.
    ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "party_rooms", filter: `code=eq.${code}` },
      () => void refresh(),
    );
    // Phase 2: wrap with exponential-backoff resubscribe so a transient WS
    // drop doesn't silently leave the room-state channel dead. silentOnGiveUp
    // because game-channel subscribers (SketchView/BluffView/PokerFaceView)
    // already toast on their own failure.
    const handle = subscribeResilient(ch, {
      label: `room-state:${code}`,
      silentOnGiveUp: true,
    });
    roomChRef.current = ch;
    setRoomCh(ch);
    return () => {
      roomChRef.current = null;
      setRoomCh(null);
      handle.cancel();
      supabase.removeChannel(ch);
    };
  }, [code, refresh]);

  // ── Realtime subscribe: player-row changes (own topic, see helper docs) ──
  // Filtered SERVER-side by room_id once the snapshot has resolved it (an
  // unfiltered listener meant every ready toggle in EVERY live room triggered
  // a snapshot GET from every open room page). Lives on its own topic because
  // postgres_changes filters are fixed at join time and re-creating the main
  // room topic to add the late-resolving filter raced supabase-js's async
  // unsubscribe (see roomPlayersChannel in lib/party/realtime-channels.ts).
  // Before roomId resolves, the 3s poll covers us.
  useEffect(() => {
    if (!code || !roomId) return;
    const ch = supabase.channel(roomPlayersChannel(code));
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "party_room_players", filter: `room_id=eq.${roomId}` },
      () => void refresh(),
    );
    const handle = subscribeResilient(ch, {
      label: `room-players:${code}`,
      silentOnGiveUp: true,
    });
    return () => {
      handle.cancel();
      supabase.removeChannel(ch);
    };
  }, [code, roomId, refresh]);

  // ── Safety-net polling: every 3s ──
  // Note (connectivity audit 2026-06-11): the interval intentionally runs
  // un-gated in hidden tabs — browsers throttle background timers themselves
  // (Chrome aligns to >=1s immediately and ~1/min after 5min), so this never
  // stacks requests in practice. The visibilitychange refresh below covers
  // the wake-up: a tab that was throttled for minutes reconciles instantly
  // on return instead of waiting up to one full poll cycle.
  useEffect(() => {
    if (!snap) return;
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [snap, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refresh]);

  // ── Broadcast helpers ──
  // All sends go through the subscribed room channel (roomChRef). The
  // fallback covers the pre-subscribe window: supabase.channel() dedupes by
  // topic, so this either returns the live channel (ws push) or mints one
  // unjoined instance whose send() rides the HTTP broadcast endpoint. We
  // deliberately do NOT removeChannel here — RealtimeClient._remove()
  // detaches by TOPIC, so removing a "throwaway" while the subscribed
  // channel exists would leave the live channel deaf. The unjoined instance
  // is capped at one per topic by the dedupe and is reused by the next
  // subscribe.
  const sendRoomEvent = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = roomChRef.current ?? supabase.channel(roomChannel(code));
      try {
        await ch.send({ type: "broadcast", event, payload });
      } catch {
        // Best-effort — the 3s poll reconciles within one cycle.
      }
    },
    [code],
  );

  const broadcastGameStarted = useCallback(
    async (game: Exclude<CurrentGame, null>) => {
      await sendRoomEvent(PARTY_EVENTS.GAME_STARTED, { game });
    },
    [sendRoomEvent],
  );

  const onReturnToLobby = useCallback(async () => {
    if (!snap?.isHost) {
      // Non-host fallback: just refresh to pull current state.
      void refresh();
      return;
    }
    await apiPost(`/api/party/rooms/${code}/end-game`, {});
    await sendRoomEvent(PARTY_EVENTS.GAME_ENDED, {});
    void refresh();
  }, [snap?.isHost, code, refresh, sendRoomEvent]);

  const leaveRoom = useCallback(async () => {
    setLeaving(true);
    // The leave route broadcasts PLAYER_LEFT server-side (covers this path,
    // the pagehide keepalive path, and any future reaper) — no client send
    // needed; a second broadcast here would just double the room's refresh.
    await apiPost(`/api/party/rooms/${code}/leave`, {});
    router.push("/games/party");
  }, [code, router]);

  // ── Render ──
  if (loading) {
    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen pt-16 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full border-2 border-purple-500/40 border-t-purple-400 animate-spin" />
            <p className="text-cream/55 text-sm font-syne">Joining room {code}...</p>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  if (error || !snap) {
    return (
      <ProtectedRoute>
        <div data-force-dark className="min-h-screen pt-16 px-4">
          <div className="max-w-md mx-auto py-16 text-center">
            <BackButton />
            <h1 className="font-bebas text-3xl text-cream mb-3 mt-4">Room unavailable</h1>
            <p className="text-cream/55 text-sm font-syne mb-6">
              {error ?? "We couldn't find that room."}
            </p>
            <button
              onClick={() => router.push("/games/party")}
              className="px-5 py-2.5 rounded-xl font-bebas tracking-wider text-sm transition-all active:scale-95"
              style={{
                background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                color: "#fff",
                boxShadow: "0 4px 16px rgba(168,85,247,0.3)",
              }}
            >
              BACK TO PARTY
            </button>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  const inGame = snap.room.status === "playing" && !!snap.room.current_game;

  return (
    <ProtectedRoute>
      <div
        data-force-dark
        className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden"
        style={{ isolation: "isolate" }}
      >
        <div
          className="absolute top-[10%] left-[10%] w-[600px] h-[600px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[10%] right-[5%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #00BFFF 0%, transparent 70%)" }}
        />

        {/* Sketch gameplay gets a wider container so the canvas column can
            actually use the viewport (canvas-dominant playtest fix). Lobby +
            other games keep the narrower reading width. */}
        <div
          className={`relative z-10 mx-auto px-4 sm:px-6 py-6 sm:py-8 ${
            inGame && snap.room.current_game === "sketch" ? "max-w-7xl" : "max-w-4xl"
          }`}
        >
          <div className="flex items-center justify-between mb-3">
            <BackButton />
            <button
              onClick={leaveRoom}
              disabled={leaving}
              className="text-cream/40 hover:text-cream/80 text-xs font-syne transition-colors disabled:opacity-40"
            >
              {leaving ? "leaving..." : "leave room"}
            </button>
          </div>

          {!inGame && (
            <RoomLobby
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              roomCh={roomCh}
              onGameStarted={async (g) => {
                await broadcastGameStarted(g);
                void refresh();
              }}
            />
          )}

          {inGame && snap.room.current_game === "sketch" && (
            <SketchView
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              activeRound={snap.activeRound ?? null}
              onReturnToLobby={onReturnToLobby}
            />
          )}

          {inGame && snap.room.current_game === "bluff" && (
            <BluffView
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              activeRound={snap.activeRound ?? null}
              onReturnToLobby={onReturnToLobby}
            />
          )}

          {inGame && snap.room.current_game === "pokerface" && (
            <PokerFaceView
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              activeRound={snap.activeRound ?? null}
              onReturnToLobby={onReturnToLobby}
            />
          )}

          {inGame && snap.room.current_game === "trivia" && (
            <TriviaView
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              activeRound={snap.activeRound ?? null}
              onReturnToLobby={onReturnToLobby}
            />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
