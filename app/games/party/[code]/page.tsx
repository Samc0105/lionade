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
import { roomChannel, PARTY_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";
import { normalizeRoomCode } from "@/lib/party/room-code";
import { useAuth } from "@/lib/auth";
import { useHeartbeat } from "@/lib/use-heartbeat";
import { useActiveSession } from "@/lib/active-session";
import { useToast } from "@/components/Toast";
import RoomLobby from "@/components/party/RoomLobby";
import SketchView from "@/components/party/SketchView";
import BluffView from "@/components/party/BluffView";
import PokerFaceView from "@/components/party/PokerFaceView";
import type { CurrentGame, PartyPlayer, PartyRoom } from "@/lib/party/types";

interface Snapshot {
  room: PartyRoom;
  players: PartyPlayer[];
  meUserId: string;
  isHost: boolean;
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
      setError(res.status === 404 ? "That room isn't open." : (res.error ?? "Couldn't load room."));
      return null;
    }
    setSnap(res.data);
    return res.data;
  }, [code]);

  // ── Bootstrap: join + first snapshot ──
  useEffect(() => {
    let cancelled = false;
    if (!user?.id || !code) return;
    (async () => {
      const joinRes = await apiPost(`/api/party/rooms/${code}/join`, {});
      if (cancelled) return;
      if (!joinRes.ok) {
        setError(joinRes.error ?? "Couldn't join the room.");
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
  useEffect(() => {
    if (!code) return;
    const ch = supabase.channel(roomChannel(code));
    ch.on("broadcast", { event: PARTY_EVENTS.PLAYER_JOINED }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.PLAYER_LEFT }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.GAME_STARTED }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.GAME_ENDED }, () => void refresh());
    ch.on("broadcast", { event: PARTY_EVENTS.ROOM_UPDATED }, () => void refresh());
    // Postgres changes are also wired — Supabase Realtime fires for table rows
    // in the publication. We listen for room status changes specifically.
    ch.on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "party_rooms", filter: `code=eq.${code}` },
      () => void refresh(),
    );
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "party_room_players" },
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
    return () => {
      handle.cancel();
      supabase.removeChannel(ch);
    };
  }, [code, refresh]);

  // ── Safety-net polling: every 3s ──
  useEffect(() => {
    if (!snap) return;
    const iv = setInterval(refresh, 3000);
    return () => clearInterval(iv);
  }, [snap, refresh]);

  // ── Broadcast helpers ──
  const broadcastGameStarted = useCallback(
    async (game: Exclude<CurrentGame, null>) => {
      const ch = supabase.channel(roomChannel(code));
      await ch.send({ type: "broadcast", event: PARTY_EVENTS.GAME_STARTED, payload: { game } });
    },
    [code],
  );

  const onReturnToLobby = useCallback(async () => {
    if (!snap?.isHost) {
      // Non-host fallback: just refresh to pull current state.
      void refresh();
      return;
    }
    await apiPost(`/api/party/rooms/${code}/end-game`, {});
    const ch = supabase.channel(roomChannel(code));
    await ch.send({ type: "broadcast", event: PARTY_EVENTS.GAME_ENDED, payload: {} });
    void refresh();
  }, [snap?.isHost, code, refresh]);

  const leaveRoom = useCallback(async () => {
    setLeaving(true);
    await apiPost(`/api/party/rooms/${code}/leave`, {});
    const ch = supabase.channel(roomChannel(code));
    await ch.send({ type: "broadcast", event: PARTY_EVENTS.PLAYER_LEFT, payload: {} });
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

        <div className="relative z-10 max-w-4xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
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
              onReturnToLobby={onReturnToLobby}
            />
          )}

          {inGame && snap.room.current_game === "bluff" && (
            <BluffView
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              onReturnToLobby={onReturnToLobby}
            />
          )}

          {inGame && snap.room.current_game === "pokerface" && (
            <PokerFaceView
              room={snap.room}
              players={snap.players}
              isHost={snap.isHost}
              meUserId={snap.meUserId}
              onReturnToLobby={onReturnToLobby}
            />
          )}
        </div>
      </div>
    </ProtectedRoute>
  );
}
