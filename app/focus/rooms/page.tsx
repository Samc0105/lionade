"use client";

// Focus Rooms hub — create a room, join by code, resume your active room.
//
// Bounded body-doubling: every room runs exactly ONE timed session
// (25/45/60 min) and then it's over. No infinite rooms; idle lobbies expire
// after 5 hours. Joining costs nothing and there are no stakes — finishing
// pays the same Fangs as a solo Focus Lock-In, plus a small group bonus
// when two or more members finish together.
//
// Fail-soft: while the HELD migration is unapplied the API answers
// unavailable and this page renders a quiet "not live yet" state.

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useReducedMotion } from "framer-motion";
import {
  UsersThree,
  Lightning,
  Timer,
  ArrowRight,
  Coin,
  Globe,
  Users,
  Lock,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError } from "@/lib/toast";
import {
  FOCUS_ROOM_DURATIONS,
  FANGS_BY_DURATION,
  GROUP_BONUS_FANGS,
  MAX_FOCUS_SESSIONS_PER_DAY,
  type FocusRoomDuration,
  type FocusRoomPrivacy,
} from "@/lib/focus-rooms/constants";

const ACCENT = "#38BDF8"; // focus sky - distinct from the library's teal

interface ActiveRoomLite {
  code: string;
  status: string;
  duration_minutes: number;
}

const PRIVACY_OPTIONS: { value: FocusRoomPrivacy; label: string; blurb: string; Icon: typeof Globe }[] = [
  { value: "open", label: "Open", blurb: "Anyone with the code", Icon: Globe },
  { value: "friends", label: "Friends", blurb: "Friends of members only", Icon: Users },
  { value: "closed", label: "Closed", blurb: "Nobody new after you share it", Icon: Lock },
];

export default function FocusRoomsPage() {
  const { user } = useAuth();
  const router = useRouter();
  const reduceMotion = useReducedMotion();

  const [duration, setDuration] = useState<FocusRoomDuration>(25);
  const [privacy, setPrivacy] = useState<FocusRoomPrivacy>("friends");
  const [creating, setCreating] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);

  const { data: activeData } = useSWR(
    user?.id ? `focus-rooms/active/${user.id}` : null,
    async () => {
      const r = await apiGet<{ activeRoom: ActiveRoomLite | null; unavailable?: boolean }>(
        "/api/focus-rooms",
      );
      return r.ok && r.data ? r.data : { activeRoom: null };
    },
    { keepPreviousData: true },
  );
  const unavailable = !!activeData?.unavailable;
  const activeRoom = activeData?.activeRoom ?? null;

  const handleCreate = async () => {
    if (creating || unavailable) return;
    setCreating(true);
    try {
      const r = await apiPost<{ ok: boolean; code: string }>("/api/focus-rooms", {
        durationMinutes: duration,
        privacyMode: privacy,
      });
      if (r.ok && r.data?.code) {
        router.push(`/focus/rooms/${r.data.code}`);
      } else {
        toastError(r.error ?? "Couldn't create the room.");
        setCreating(false);
      }
    } catch {
      toastError("Couldn't create the room.");
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = joinCode.replace(/[^0-9]/g, "");
    if (code.length !== 4 || joining || unavailable) return;
    setJoining(true);
    try {
      const r = await apiPost<{ ok: boolean }>(`/api/focus-rooms/${code}/join`, {});
      if (r.ok && r.data?.ok) {
        router.push(`/focus/rooms/${code}`);
      } else {
        toastError(r.error ?? "Couldn't join that room.");
        setJoining(false);
      }
    } catch {
      toastError("Couldn't join that room.");
      setJoining(false);
    }
  };

  const delay = (d: string) => (reduceMotion ? undefined : { animationDelay: d });

  return (
    <ProtectedRoute>
      <FeatureGate feature="focus_rooms">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-2xl mx-auto px-4 sm:px-6 py-8">
            <BackButton />

            <header className="mb-7 mt-4 animate-slide-up">
              <div className="flex items-center gap-2 mb-2">
                <UsersThree size={16} weight="duotone" color={ACCENT} aria-hidden="true" />
                <span className="font-mono text-[10px] uppercase tracking-[0.3em]" style={{ color: ACCENT }}>
                  Focus Rooms
                </span>
              </div>
              <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.08em] leading-none">
                Lock in together
              </h1>
              <p className="text-cream/65 text-sm mt-2 leading-relaxed">
                One shared timer, everyone heads down. Finish and you earn the same Fangs as a solo
                Lock-In, plus +{GROUP_BONUS_FANGS} when two or more of you make it to zero.
                Every room runs one session, then it ends. No infinite rooms.
              </p>
            </header>

            {unavailable && (
              <div
                className="rounded-[10px] border border-white/[0.08] bg-white/[0.02] p-5 mb-6 animate-slide-up"
                role="status"
              >
                <p className="font-syne font-semibold text-sm text-cream mb-1">Not live yet</p>
                <p className="text-cream/60 text-xs leading-relaxed">
                  Focus Rooms isn&apos;t switched on for this account yet. Check back soon. Solo
                  Focus Lock-In still works from the launcher.
                </p>
              </div>
            )}

            {activeRoom && !unavailable && (
              <Link
                href={`/focus/rooms/${activeRoom.code}`}
                className="fluid-card-hover press-feedback group block rounded-[10px] p-5 mb-6 animate-slide-up"
                style={{
                  background: `linear-gradient(110deg, ${ACCENT}14 0%, rgba(12,16,32,0.95) 100%)`,
                  border: `1px solid ${ACCENT}40`,
                }}
              >
                <div className="flex items-center gap-4">
                  <div
                    className="flex-shrink-0 w-11 h-11 rounded-xl flex items-center justify-center"
                    style={{ background: `${ACCENT}14`, border: `1px solid ${ACCENT}40` }}
                  >
                    <Lightning size={20} weight="duotone" color={ACCENT} aria-hidden="true" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-bebas text-xl text-cream tracking-wider leading-none">
                      {activeRoom.status === "running" ? "SESSION IN PROGRESS" : "YOUR ROOM IS OPEN"}
                    </p>
                    <p className="text-cream/65 text-xs mt-1.5 font-mono">
                      room {activeRoom.code} · {activeRoom.duration_minutes} min
                    </p>
                  </div>
                  <ArrowRight
                    size={18}
                    weight="bold"
                    color={ACCENT}
                    aria-hidden="true"
                    className="flex-shrink-0 group-hover:translate-x-1 transition-transform"
                  />
                </div>
              </Link>
            )}

            {/* ── Create ── */}
            <section className="card p-5 mb-4 animate-slide-up" style={delay("0.05s")}>
              <h2 className="font-bebas text-sm text-cream tracking-[0.2em] mb-3">START A ROOM</h2>

              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/50 mb-2">
                session length
              </p>
              <div className="grid grid-cols-3 gap-2 mb-4">
                {FOCUS_ROOM_DURATIONS.map((d) => {
                  const selected = duration === d;
                  return (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setDuration(d)}
                      aria-pressed={selected}
                      className="rounded-[8px] px-3 py-3 border transition-colors text-center"
                      style={{
                        background: selected ? `${ACCENT}14` : "rgba(255,255,255,0.02)",
                        borderColor: selected ? `${ACCENT}66` : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <span className="font-bebas text-xl text-cream block leading-none">{d} min</span>
                      <span className="inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.2em] text-gold mt-1.5">
                        <Coin size={9} weight="duotone" aria-hidden="true" /> +{FANGS_BY_DURATION[d]}F
                      </span>
                    </button>
                  );
                })}
              </div>

              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/50 mb-2">
                who can join
              </p>
              <div className="grid grid-cols-3 gap-2 mb-5">
                {PRIVACY_OPTIONS.map(({ value, label, blurb, Icon }) => {
                  const selected = privacy === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPrivacy(value)}
                      aria-pressed={selected}
                      className="rounded-[8px] px-2.5 py-2.5 border transition-colors text-left"
                      style={{
                        background: selected ? `${ACCENT}10` : "rgba(255,255,255,0.02)",
                        borderColor: selected ? `${ACCENT}55` : "rgba(255,255,255,0.06)",
                      }}
                    >
                      <span className="flex items-center gap-1.5">
                        <Icon size={12} weight="duotone" color={selected ? ACCENT : "#EEF4FF99"} aria-hidden="true" />
                        <span className="font-syne font-semibold text-xs text-cream">{label}</span>
                      </span>
                      <span className="block text-cream/50 text-[10px] mt-1 leading-snug">{blurb}</span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleCreate}
                disabled={creating || unavailable}
                className="btn-primary w-full py-3 rounded-full font-mono text-[11px] uppercase tracking-[0.25em] disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {creating ? "Creating..." : "Create room"}
              </button>
            </section>

            {/* ── Join ── */}
            <section className="card p-5 animate-slide-up" style={delay("0.1s")}>
              <h2 className="font-bebas text-sm text-cream tracking-[0.2em] mb-3">JOIN WITH A CODE</h2>
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  maxLength={4}
                  value={joinCode}
                  onChange={(e) => setJoinCode(e.target.value.replace(/[^0-9]/g, ""))}
                  onKeyDown={(e) => { if (e.key === "Enter") void handleJoin(); }}
                  placeholder="0000"
                  aria-label="4 digit room code"
                  className="flex-1 rounded-[8px] bg-white/[0.03] border border-white/[0.08] px-4 py-3
                    font-bebas text-2xl tracking-[0.5em] text-cream text-center placeholder:text-cream/25
                    focus:outline-none focus:border-teal-400/60"
                />
                <button
                  type="button"
                  onClick={handleJoin}
                  disabled={joinCode.length !== 4 || joining || unavailable}
                  className="rounded-full border px-6 font-mono text-[11px] uppercase tracking-[0.25em]
                    transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  style={{ borderColor: `${ACCENT}66`, color: ACCENT }}
                >
                  {joining ? "Joining..." : "Join"}
                </button>
              </div>
              <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/40 mt-3 flex items-center gap-1.5">
                <Timer size={10} weight="duotone" aria-hidden="true" />
                Joining is free. No stakes. Cap: {MAX_FOCUS_SESSIONS_PER_DAY} focus payouts per day.
              </p>
            </section>
          </div>
        </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
