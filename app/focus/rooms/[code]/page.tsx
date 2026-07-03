"use client";

// Focus Room — lobby, shared countdown, done summary.
//
// The countdown is derived from the SERVER'S ends_at plus a measured clock
// skew (serverNow rides on every snapshot), so every member sees the same
// clock and a drifted local clock can't shorten or stretch the session
// (FocusLockIn's wall-clock pattern, anchored server-side).
//
// Live updates: broadcast channel (join/leave/start/complete events) +
// postgres_changes on focus_rooms/focus_room_members + a 3s poll reconciler
// (party pattern; the poll is the source of truth, realtime is the fast path).

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useReducedMotion } from "framer-motion";
import {
  UsersThree,
  Lightning,
  Crown,
  CheckCircle,
  Coin,
  Trophy,
  Copy,
  SignOut,
  Globe,
  Users,
  Lock,
  HourglassMedium,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import ConfirmModal from "@/components/ConfirmModal";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastInfo } from "@/lib/toast";
import { mutateUserStats } from "@/lib/hooks";
import {
  focusRoomChannel,
  focusRoomChangesChannel,
  FOCUS_ROOM_EVENTS,
} from "@/lib/focus-rooms/channels";
import {
  FANGS_BY_DURATION,
  GROUP_BONUS_FANGS,
  type FocusRoomDuration,
} from "@/lib/focus-rooms/constants";
import type { FocusRoomMember, FocusRoomRow } from "@/lib/focus-rooms/room-state";

const ACCENT = "#38BDF8"; // focus sky - distinct from the library's teal

interface Snapshot {
  room: FocusRoomRow;
  members: FocusRoomMember[];
  serverNow: string;
  isMember: boolean;
  isHost: boolean;
}

interface ClaimResult {
  coinsEarned: number;
  bonusFangs: number;
  bonusPending: boolean;
  /** The daily cap ate the BASE payout. */
  capped: boolean;
  /** The daily cap ate the GROUP BONUS (base may still have paid). */
  bonusCapped: boolean;
}

type PageError = "not_found" | "expired" | "unavailable";

const PRIVACY_ICON = { open: Globe, friends: Users, closed: Lock } as const;
const PRIVACY_LABEL = {
  open: "open to anyone",
  friends: "friends only",
  closed: "closed",
} as const;

export default function FocusRoomPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").replace(/[^0-9]/g, "");
  const router = useRouter();
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [pageError, setPageError] = useState<PageError | null>(null);
  const [claim, setClaim] = useState<ClaimResult | null>(null);
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const skewRef = useRef(0); // serverNow - clientNow, ms
  const claimFiredRef = useRef(false);
  const claimRetriesRef = useRef(0);
  // 3+ consecutive refresh failures -> honest inline error instead of an
  // eternal skeleton (the 3s poll keeps retrying underneath either way).
  const refreshFailsRef = useRef(0);
  const [refreshBroken, setRefreshBroken] = useState(false);

  // ── Snapshot fetch (also the 3s poll body) ──
  const refresh = useCallback(async () => {
    if (!code) return;
    const r = await apiGet<Snapshot & { expired?: boolean }>(`/api/focus-rooms/${code}`);
    if (r.ok && r.data?.room) {
      skewRef.current = new Date(r.data.serverNow).getTime() - Date.now();
      setSnap(r.data);
      setPageError(null);
      refreshFailsRef.current = 0;
      setRefreshBroken(false);
    } else if (r.status === 410) {
      setPageError("expired");
    } else if (r.status === 404) {
      setPageError("not_found");
    } else if (r.status === 503) {
      setPageError("unavailable");
    } else {
      // Transient failure (network / 5xx). Tolerate a couple, then be honest.
      refreshFailsRef.current += 1;
      if (refreshFailsRef.current >= 3) setRefreshBroken(true);
    }
  }, [code]);

  useEffect(() => { void refresh(); }, [refresh]);

  // 3s poll reconciler (party pattern).
  useEffect(() => {
    if (pageError) return;
    const iv = setInterval(() => void refresh(), 3000);
    return () => clearInterval(iv);
  }, [refresh, pageError]);

  // Broadcast fast path — subscribe once per code.
  useEffect(() => {
    if (!code) return;
    const ch = supabase.channel(focusRoomChannel(code));
    for (const evt of Object.values(FOCUS_ROOM_EVENTS)) {
      ch.on("broadcast", { event: evt }, () => void refresh());
    }
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [code, refresh]);

  // postgres_changes on both tables — late-joining channel once room.id is
  // known (filters are fixed at join time; see lib/focus-rooms/channels.ts).
  const roomId = snap?.room.id ?? null;
  useEffect(() => {
    if (!code || !roomId) return;
    const ch = supabase.channel(focusRoomChangesChannel(code));
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "focus_rooms", filter: `id=eq.${roomId}` },
      () => void refresh(),
    );
    ch.on(
      "postgres_changes",
      { event: "*", schema: "public", table: "focus_room_members", filter: `room_id=eq.${roomId}` },
      () => void refresh(),
    );
    ch.subscribe();
    return () => { void supabase.removeChannel(ch); };
  }, [code, roomId, refresh]);

  // ── Shared clock ──
  const [nowTick, setNowTick] = useState(Date.now());
  useEffect(() => {
    const iv = setInterval(() => setNowTick(Date.now()), 250);
    return () => clearInterval(iv);
  }, []);

  const room = snap?.room ?? null;
  const members = snap?.members ?? [];
  const activeMembers = members.filter((m) => m.left_at === null);
  const me = user?.id ? members.find((m) => m.user_id === user.id) : undefined;
  const isHost = !!snap?.isHost;
  const endsAtMs = room?.ends_at ? new Date(room.ends_at).getTime() : null;
  const serverNowMs = nowTick + skewRef.current;
  const remainingMs = endsAtMs !== null ? Math.max(0, endsAtMs - serverNowMs) : null;

  // ── Claim (auto-fires at zero; re-fires once on a done room to pick up a
  // pending group bonus after the HELD ledger migration lands) ──
  const fireClaim = useCallback(async () => {
    try {
      const r = await apiPost<ClaimResult & { ok: boolean; retryInMs?: number }>(
        `/api/focus-rooms/${code}/complete`,
        {},
      );
      if (r.ok && r.data?.ok) {
        setClaim({
          coinsEarned: r.data.coinsEarned ?? 0,
          bonusFangs: r.data.bonusFangs ?? 0,
          bonusPending: !!r.data.bonusPending,
          capped: !!r.data.capped,
          bonusCapped: !!r.data.bonusCapped,
        });
        if (user?.id) mutateUserStats(user.id);
        void refresh();
      } else if (r.status === 409 && claimRetriesRef.current < 3) {
        // Server says not over yet (clock skew) — retry shortly.
        claimRetriesRef.current += 1;
        setTimeout(() => void fireClaim(), 4000);
      } else if (!r.ok && r.status !== 409) {
        toastError(r.error ?? "Couldn't record the session. It will retry.");
        claimFiredRef.current = false; // allow the poll-driven effect to retry
      }
    } catch {
      claimFiredRef.current = false;
    }
  }, [code, refresh, user?.id]);

  useEffect(() => {
    if (!room || !me || me.left_at !== null || claimFiredRef.current) return;
    const sessionOver =
      room.status === "done" ||
      (room.status === "running" && remainingMs !== null && remainingMs <= 0);
    if (!sessionOver) return;
    claimFiredRef.current = true;
    void fireClaim();
  }, [room, me, remainingMs, fireClaim]);

  // ── Actions ──
  const handleStart = async () => {
    const r = await apiPost<{ ok: boolean }>(`/api/focus-rooms/${code}/start`, {});
    if (!r.ok) toastError(r.error ?? "Couldn't start the session.");
    void refresh();
  };

  const handleLeave = async () => {
    await apiPost(`/api/focus-rooms/${code}/leave`, {}).catch(() => null);
    router.push("/focus/rooms");
  };

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(code);
      toastInfo("Room code copied.");
    } catch {
      /* clipboard unavailable; the code is on screen anyway */
    }
  };

  // ── Error states ──
  if (pageError) {
    const copyByError: Record<PageError, { title: string; body: string }> = {
      not_found: { title: "Room not found", body: "That code doesn't match an open room." },
      expired: { title: "This room expired", body: "Focus rooms are bounded. Sessions end, and idle lobbies close after a few hours." },
      unavailable: { title: "Not live yet", body: "Focus Rooms isn't switched on yet. Check back soon." },
    };
    const c = copyByError[pageError];
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 grid place-items-center px-4">
          <div className="card p-7 max-w-sm text-center">
            <HourglassMedium size={32} weight="duotone" color={ACCENT} aria-hidden="true" className="mx-auto mb-3" />
            <h1 className="font-bebas text-2xl text-cream tracking-wider mb-2">{c.title}</h1>
            <p className="text-cream/60 text-sm mb-5 leading-relaxed">{c.body}</p>
            <Link
              href="/focus/rooms"
              className="btn-primary inline-block px-6 py-2.5 rounded-full font-mono text-[11px] uppercase tracking-[0.25em]"
            >
              Back to Focus Rooms
            </Link>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  return (
    <ProtectedRoute>
      <FeatureGate feature="focus_rooms">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
            <BackButton />

            {/* Honest connection banner — replaces the eternal skeleton after
                3+ consecutive refresh failures; stale-snapshot views keep
                rendering with this warning on top. */}
            {refreshBroken && (
              <div
                className="mt-4 card p-4 flex items-start gap-3"
                style={{ borderColor: "rgba(245,158,11,0.4)" }}
                role="alert"
              >
                <div className="flex-1 text-left">
                  <p className="font-syne font-semibold text-sm text-cream mb-1">
                    We can't reach this room right now
                  </p>
                  <p className="text-cream/60 text-[12px] leading-relaxed">
                    The last few updates failed. Your spot and any Fangs you
                    earn are safe on the server. We keep retrying automatically,
                    or try again now.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    refreshFailsRef.current = 0;
                    setRefreshBroken(false);
                    void refresh();
                  }}
                  className="shrink-0 rounded-full border border-white/[0.15] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/70 hover:text-cream hover:border-white/[0.35] transition-colors"
                >
                  Retry
                </button>
              </div>
            )}

            {!room ? (
              !refreshBroken && (
                <div className="mt-8 space-y-3" aria-hidden="true">
                  <div className="card h-24 animate-pulse" />
                  <div className="card h-48 animate-pulse" />
                </div>
              )
            ) : room.status === "lobby" ? (
              <LobbyView
                room={room}
                members={activeMembers}
                isHost={isHost}
                isMember={!!me && me.left_at === null}
                onStart={handleStart}
                onLeave={() => void handleLeave()}
                onJoin={async () => {
                  const r = await apiPost<{ ok: boolean }>(`/api/focus-rooms/${code}/join`, {});
                  if (!r.ok || !r.data?.ok) toastError(r.error ?? "Couldn't join this room.");
                  void refresh();
                }}
                onCopyCode={() => void copyCode()}
              />
            ) : room.status === "running" && remainingMs !== null && remainingMs > 0 ? (
              <RunningView
                room={room}
                members={activeMembers}
                remainingMs={remainingMs}
                reduceMotion={!!reduceMotion}
                onLeaveClick={() => setShowLeaveConfirm(true)}
              />
            ) : (
              <DoneView
                room={room}
                members={members}
                meId={user?.id ?? null}
                claim={claim}
              />
            )}
          </div>
        </div>

        <ConfirmModal
          open={showLeaveConfirm}
          onClose={() => setShowLeaveConfirm(false)}
          onConfirm={() => { setShowLeaveConfirm(false); void handleLeave(); }}
          title="Leave the session?"
          message="Leaving mid-session forfeits this room's Fangs. Your streak is safe either way."
          confirmLabel="Leave quietly"
          destructive
        />
      </FeatureGate>
    </ProtectedRoute>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Member chip — avatar (or initial) + name.
// ─────────────────────────────────────────────────────────────────────────────
function MemberChip({
  member, isHost, showCompleted,
}: {
  member: FocusRoomMember;
  isHost: boolean;
  showCompleted?: boolean;
}) {
  const name = member.username ?? "someone";
  return (
    <li
      className="flex items-center gap-2.5 rounded-full pl-1.5 pr-3.5 py-1.5 border border-white/[0.07] bg-white/[0.02]"
      aria-label={`${name}${isHost ? ", host" : ""}${showCompleted && member.completed ? ", completed" : ""}`}
    >
      <span
        className="grid place-items-center w-7 h-7 rounded-full overflow-hidden shrink-0"
        style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}40` }}
        aria-hidden="true"
      >
        {member.avatar_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={member.avatar_url} alt="" className="w-full h-full object-cover" />
        ) : (
          <span className="font-syne font-bold text-[11px]" style={{ color: ACCENT }}>
            {name.slice(0, 1).toUpperCase()}
          </span>
        )}
      </span>
      <span className="font-syne font-semibold text-xs text-cream truncate max-w-[120px]">{name}</span>
      {isHost && <Crown size={11} weight="duotone" color="#FFD700" aria-hidden="true" />}
      {showCompleted && member.completed && (
        <CheckCircle size={13} weight="duotone" color="#22C55E" aria-hidden="true" />
      )}
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Lobby
// ─────────────────────────────────────────────────────────────────────────────
function LobbyView({
  room, members, isHost, isMember, onStart, onLeave, onJoin, onCopyCode,
}: {
  room: FocusRoomRow;
  members: FocusRoomMember[];
  isHost: boolean;
  isMember: boolean;
  onStart: () => void;
  onLeave: () => void;
  onJoin: () => void;
  onCopyCode: () => void;
}) {
  const PrivacyIcon = PRIVACY_ICON[room.privacy_mode] ?? Users;
  const reward = FANGS_BY_DURATION[room.duration_minutes as FocusRoomDuration] ?? 0;
  return (
    <div className="mt-4 animate-slide-up">
      <div className="flex items-center gap-2 mb-2">
        <UsersThree size={15} weight="duotone" color={ACCENT} aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: ACCENT }}>
          Focus Room lobby
        </span>
      </div>

      <div className="card p-6 mb-4 text-center">
        <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-cream/50 mb-2">room code</p>
        <div className="flex items-center justify-center gap-3 mb-3">
          <span className="font-bebas text-[52px] tracking-[0.35em] text-cream leading-none">{room.code}</span>
          <button
            type="button"
            onClick={onCopyCode}
            aria-label="Copy room code"
            className="grid place-items-center w-9 h-9 rounded-full border border-white/[0.1] hover:border-white/[0.25] text-cream/50 hover:text-cream transition-colors"
          >
            <Copy size={14} weight="duotone" />
          </button>
        </div>
        <div className="flex items-center justify-center gap-4 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/60">
          <span className="inline-flex items-center gap-1.5">
            <Lightning size={11} weight="duotone" color={ACCENT} aria-hidden="true" />
            {room.duration_minutes} min
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Coin size={11} weight="duotone" color="#FFD700" aria-hidden="true" />
            +{reward}F each
          </span>
          <span className="inline-flex items-center gap-1.5">
            <PrivacyIcon size={11} weight="duotone" aria-hidden="true" />
            {PRIVACY_LABEL[room.privacy_mode] ?? room.privacy_mode}
          </span>
        </div>
      </div>

      <div className="card p-5 mb-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/50 mb-3">
          in the room · {members.length}
        </p>
        <ul className="flex flex-wrap gap-2">
          {members.map((m) => (
            <MemberChip key={m.user_id} member={m} isHost={m.user_id === room.host_user_id} />
          ))}
        </ul>
        <p className="text-cream/50 text-[11.5px] mt-4 leading-relaxed">
          Two or more finishers each earn a +{GROUP_BONUS_FANGS}F group bonus on top. One session,
          then the room closes.
        </p>
      </div>

      {isMember ? (
        <div className="flex gap-2">
          {isHost ? (
            <button
              type="button"
              onClick={onStart}
              className="btn-primary flex-1 py-3 rounded-full font-mono text-[11px] uppercase tracking-[0.25em]"
            >
              Start the session
            </button>
          ) : (
            <div className="flex-1 grid place-items-center rounded-full border border-white/[0.08] py-3">
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50">
                Waiting for the host to start
              </span>
            </div>
          )}
          <button
            type="button"
            onClick={onLeave}
            className="rounded-full border border-white/[0.12] px-5 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60 hover:text-cream hover:border-white/[0.3] transition-colors inline-flex items-center gap-1.5"
          >
            <SignOut size={11} weight="duotone" aria-hidden="true" /> Leave
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={onJoin}
          className="btn-primary w-full py-3 rounded-full font-mono text-[11px] uppercase tracking-[0.25em]"
        >
          Join this room
        </button>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Running — one big shared countdown (server ends_at, skew corrected).
// ─────────────────────────────────────────────────────────────────────────────
function RunningView({
  room, members, remainingMs, reduceMotion, onLeaveClick,
}: {
  room: FocusRoomRow;
  members: FocusRoomMember[];
  remainingMs: number;
  reduceMotion: boolean;
  onLeaveClick: () => void;
}) {
  const totalMs = room.duration_minutes * 60_000;
  const progress = Math.min(1, Math.max(0, 1 - remainingMs / totalMs));
  const m = Math.floor(remainingMs / 60_000);
  const s = Math.floor((remainingMs % 60_000) / 1000);

  return (
    <div className="mt-4 animate-slide-up text-center">
      <div className="flex items-center justify-center gap-2 mb-5">
        <Lightning size={13} weight="duotone" color={ACCENT} aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: ACCENT }}>
          Locked in together · {room.duration_minutes} min
        </span>
      </div>

      <div
        className="card p-7 mb-4"
        role="timer"
        aria-label={`${m} minutes ${s} seconds remaining`}
      >
        <div className="relative w-[220px] h-[220px] mx-auto mb-5">
          <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
            <circle cx="50" cy="50" r="46" fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="3" />
            <circle
              cx="50" cy="50" r="46" fill="none"
              stroke={ACCENT} strokeWidth="3" strokeLinecap="round"
              strokeDasharray={2 * Math.PI * 46}
              strokeDashoffset={2 * Math.PI * 46 * (1 - progress)}
              style={{ transition: reduceMotion ? "none" : "stroke-dashoffset 0.25s linear" }}
            />
          </svg>
          <div className="absolute inset-0 grid place-items-center">
            <div>
              <div className="font-bebas text-[60px] tracking-tight tabular-nums text-cream leading-none">
                {m.toString().padStart(2, "0")}:{s.toString().padStart(2, "0")}
              </div>
              <div className="font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/40 mt-1">
                shared timer
              </div>
            </div>
          </div>
        </div>
        <p className="text-[13px] text-cream/65 leading-relaxed">
          Everyone is on this clock. Phones down. The payout unlocks at zero.
        </p>
      </div>

      <div className="card p-4 mb-4">
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/50 mb-3 text-left">
          focusing now · {members.length}
        </p>
        <ul className="flex flex-wrap gap-2">
          {members.map((mem) => (
            <MemberChip key={mem.user_id} member={mem} isHost={mem.user_id === room.host_user_id} />
          ))}
        </ul>
      </div>

      <button
        type="button"
        onClick={onLeaveClick}
        className="rounded-full border border-white/[0.12] px-6 py-2.5 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 hover:text-cream hover:border-white/[0.3] transition-colors inline-flex items-center gap-1.5"
      >
        <SignOut size={11} weight="duotone" aria-hidden="true" /> Leave quietly
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Done — summary card: who finished, what everyone earned.
// ─────────────────────────────────────────────────────────────────────────────
function DoneView({
  room, members, meId, claim,
}: {
  room: FocusRoomRow;
  members: FocusRoomMember[];
  meId: string | null;
  claim: ClaimResult | null;
}) {
  const base = FANGS_BY_DURATION[room.duration_minutes as FocusRoomDuration] ?? 0;
  const finishers = members.filter((m) => m.completed);
  const groupBonusOn = finishers.length >= 2;
  const me = meId ? members.find((m) => m.user_id === meId) : undefined;

  return (
    <div className="mt-4 animate-slide-up">
      <div className="card p-7 text-center mb-4" style={{ borderColor: `${ACCENT}40` }}>
        <Trophy size={38} weight="duotone" color="#FFD700" aria-hidden="true" className="mx-auto mb-3" />
        <h1 className="font-bebas text-[34px] tracking-wider text-cream leading-none mb-1">
          SESSION COMPLETE
        </h1>
        <p className="text-cream/60 text-[13px] mb-4">
          {room.duration_minutes} minutes, {finishers.length} finisher{finishers.length === 1 ? "" : "s"}.
        </p>

        {me?.completed && (
          <div className="inline-flex items-center gap-2 rounded-full bg-gold/[0.12] border border-gold/40 px-4 py-1.5 mb-2">
            <Coin size={14} weight="duotone" className="text-gold" aria-hidden="true" />
            <span className="font-bebas text-[26px] tabular-nums text-gold tracking-wider leading-none">
              +{(claim?.coinsEarned ?? 0) + (claim?.bonusFangs ?? 0) || (claim?.capped ? 0 : base + (me.bonus_granted ? GROUP_BONUS_FANGS : 0))}
            </span>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold/80">Fangs</span>
          </div>
        )}
        {claim?.capped && (
          <p className="text-cream/50 text-[12px] mb-1">
            Daily focus cap hit. The payout was skipped, but the focus still counts.
          </p>
        )}
        {!claim?.capped && claim?.bonusCapped && (
          <p className="text-cream/50 text-[12px] mb-1">
            Your base Fangs landed, but the daily focus cap ate the group bonus.
          </p>
        )}
        {claim?.bonusPending && (
          <p className="text-[12px] mb-1" style={{ color: ACCENT }}>
            Group bonus pending. It will be added to your wallet soon.
          </p>
        )}
        {me && !me.completed && (
          <p className="text-cream/50 text-[12px] mb-1">
            {me.left_at ? "You left before the end, so there was nothing to claim." : "This session wrapped without your claim."}
          </p>
        )}
      </div>

      <div className="card p-5 mb-5">
        <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/50 mb-3">
          the room
        </p>
        <ul className="space-y-2">
          {members.map((m) => (
            <li key={m.user_id} className="flex items-center gap-3 py-1">
              <span
                className="grid place-items-center w-7 h-7 rounded-full overflow-hidden shrink-0"
                style={{ background: `${ACCENT}18`, border: `1px solid ${ACCENT}40` }}
                aria-hidden="true"
              >
                {m.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.avatar_url} alt="" className="w-full h-full object-cover" />
                ) : (
                  <span className="font-syne font-bold text-[11px]" style={{ color: ACCENT }}>
                    {(m.username ?? "?").slice(0, 1).toUpperCase()}
                  </span>
                )}
              </span>
              <span className="font-syne font-semibold text-sm text-cream flex-1 truncate">
                {m.username ?? "someone"}{m.user_id === room.host_user_id ? " (host)" : ""}
              </span>
              {m.completed ? (
                <span className="font-mono text-[10px] tabular-nums text-gold">
                  +{base}F{groupBonusOn && m.bonus_granted ? ` +${GROUP_BONUS_FANGS}F` : ""}
                </span>
              ) : (
                <span className="font-mono text-[10px] uppercase tracking-[0.15em] text-cream/40">
                  {m.left_at ? "left early" : "missed"}
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex gap-2">
        <Link
          href="/focus/rooms"
          className="btn-primary flex-1 py-3 rounded-full font-mono text-[11px] uppercase tracking-[0.25em] text-center"
        >
          Start another room
        </Link>
        <Link
          href="/learn"
          className="rounded-full border border-white/[0.12] px-6 py-3 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/60 hover:text-cream hover:border-white/[0.3] transition-colors grid place-items-center"
        >
          Back to Learn
        </Link>
      </div>
    </div>
  );
}
