"use client";

// /games/party — Lionade Party landing page.
//
// Two big CTAs (Create Room / Join Room) + a "How to play" expandable.
// On create or successful join, we router.push to /games/party/[code].

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import { apiGet, apiPost } from "@/lib/api-client";
import { normalizeRoomCode, isValidRoomCode } from "@/lib/party/room-code";
import { PaintBrush, ChatCircleText, Sparkle, Users, ChartLineUp, Eye, X as XIcon } from "@phosphor-icons/react";

export default function PartyLandingPage() {
  const router = useRouter();
  const reduced = useReducedMotion();

  const [busy, setBusy] = useState<"none" | "creating" | "joining">("none");
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [howOpen, setHowOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [roomName, setRoomName] = useState("");
  const [privacyMode, setPrivacyMode] = useState<"open" | "friends" | "closed">("open");

  async function createRoom() {
    setBusy("creating");
    setError(null);
    const trimmed = roomName.trim().slice(0, 30);
    const res = await apiPost<{ code: string }>("/api/party/rooms", {
      ...(trimmed.length > 0 ? { display_name: trimmed } : {}),
      privacy_mode: privacyMode,
    });
    setBusy("none");
    if (!res.ok || !res.data?.code) {
      console.error("[party:create-room] failed", res.error);
      setError("Couldn't create a room. Try again.");
      return;
    }
    router.push(`/games/party/${res.data.code}`);
  }

  async function joinRoom(e: React.FormEvent) {
    e.preventDefault();
    const code = normalizeRoomCode(joinCode);
    if (!isValidRoomCode(code)) {
      setError("Room code must be 4 digits.");
      return;
    }
    setBusy("joining");
    setError(null);
    const res = await apiPost<{ ok: boolean; requires_request?: boolean; expired?: boolean }>(
      `/api/party/rooms/${code}/join`,
      {},
    );
    setBusy("none");
    if (!res.ok) {
      console.error("[party:join-room] failed", res.error);
      // Lobby-expiry (410 + expired:true) carries its own server copy — render
      // it verbatim instead of the generic line. Branch on status/flag, never
      // the message string.
      const isExpired = res.status === 410 || res.data?.expired === true;
      setError(
        isExpired
          ? res.error ?? "This lobby expired. Start a new one."
          : "That room isn't open right now.",
      );
      return;
    }
    if (res.data?.requires_request) {
      setRequestCode(code);
      setRequestNote("");
      setRequestOpen(true);
      return;
    }
    router.push(`/games/party/${code}`);
  }

  // Request-to-join modal state. Sister flow to the joinRoom handler above:
  // when the server returns requires_request, we collect an optional 50-char
  // note and POST /request-join, then poll for the host's decision.
  const [requestOpen, setRequestOpen] = useState(false);
  const [requestCode, setRequestCode] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [requestStatus, setRequestStatus] = useState<"idle" | "sending" | "waiting" | "approved" | "declined">("idle");
  const [requestError, setRequestError] = useState<string | null>(null);

  async function sendJoinRequest() {
    if (!requestCode) return;
    setRequestStatus("sending");
    setRequestError(null);
    const res = await apiPost<{ ok: boolean; request_id?: string }>(
      `/api/party/rooms/${requestCode}/request-join`,
      { note: requestNote.trim().slice(0, 50) },
    );
    if (!res.ok) {
      setRequestStatus("idle");
      setRequestError(res.error ?? "Couldn't send the request. Try again.");
      return;
    }
    setRequestStatus("waiting");
  }

  // Lightweight poll for the host decision. Realtime would be ideal but the
  // landing page doesn't subscribe to the room channel; a 3s poll is fine for
  // the ~30s typical window.
  useEffect(() => {
    if (requestStatus !== "waiting" || !requestCode) return;
    let cancelled = false;
    const iv = setInterval(async () => {
      const res = await apiGet<{ status: string }>(
        `/api/party/rooms/${requestCode}/request-join`,
      );
      if (cancelled || !res.ok) return;
      const st = res.data?.status;
      if (st === "approved") {
        setRequestStatus("approved");
        setTimeout(() => router.push(`/games/party/${requestCode}`), 700);
      } else if (st === "declined") {
        setRequestStatus("declined");
      }
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(iv);
    };
  }, [requestStatus, requestCode, router]);

  return (
    <ProtectedRoute>
      <div
        data-force-dark
        className="relative min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden"
        style={{ isolation: "isolate" }}
      >
        {/* Atmospheric glows — purple primary, gold accent */}
        <div
          className="absolute top-[10%] left-[10%] w-[600px] h-[600px] rounded-full pointer-events-none opacity-[0.05]"
          style={{ background: "radial-gradient(circle, #A855F7 0%, transparent 70%)" }}
        />
        <div
          className="absolute top-[40%] right-[8%] w-[500px] h-[500px] rounded-full pointer-events-none opacity-[0.04]"
          style={{ background: "radial-gradient(circle, #00BFFF 0%, transparent 70%)" }}
        />
        <div
          className="absolute bottom-[10%] left-[40%] w-[450px] h-[450px] rounded-full pointer-events-none opacity-[0.03]"
          style={{ background: "radial-gradient(circle, #3B82F6 0%, transparent 70%)" }}
        />

        <div className="relative z-10 max-w-3xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <BackButton />

          {/* Hero */}
          <div className="text-center mb-10">
            <div
              className="inline-flex items-center gap-2 mb-4 px-3 py-1 rounded-full text-[11px] font-bebas tracking-[0.2em]"
              style={{
                background: "linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(168,85,247,0.06) 100%)",
                border: "1px solid rgba(168,85,247,0.4)",
                color: "#C4B5FD",
              }}
            >
              LIONADE PARTY · V1
            </div>
            <h1 className="font-bebas text-6xl sm:text-8xl tracking-wider leading-none mb-3 text-cream">
              PARTY
            </h1>
            <p className="text-cream/55 text-sm sm:text-base max-w-md mx-auto font-syne">
              Play together. Three games tonight, more coming. Grab a room code and bring 2 to 6 friends.
            </p>
          </div>

          {/* CTA cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            {/* Create */}
            <motion.button
              onClick={() => setCreateOpen(true)}
              disabled={busy !== "none"}
              whileHover={reduced ? undefined : { y: -3 }}
              whileTap={reduced ? undefined : { scale: 0.98 }}
              className="relative rounded-2xl p-6 text-left overflow-hidden transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              style={{
                background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                boxShadow: "0 8px 32px rgba(168,85,247,0.35)",
              }}
            >
              <p className="font-bebas text-3xl tracking-wider text-white mb-1">
                CREATE ROOM
              </p>
              <p className="text-white/80 text-sm font-syne">
                {busy === "creating" ? "Generating code..." : "Name it, set privacy, host it."}
              </p>
            </motion.button>

            {/* Join */}
            <form
              onSubmit={joinRoom}
              className="rounded-2xl p-6 flex flex-col gap-3"
              style={{
                background: "linear-gradient(135deg, rgba(16,12,26,0.8) 0%, rgba(8,6,16,0.8) 100%)",
                border: "1px solid rgba(255,215,0,0.35)",
                boxShadow: "0 8px 32px rgba(255,215,0,0.08)",
              }}
            >
              <div>
                <p className="font-bebas text-3xl tracking-wider text-[#FFD700] mb-1">
                  JOIN ROOM
                </p>
                <p className="text-cream/55 text-xs font-syne">Enter the 4-digit code.</p>
              </div>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
                placeholder="1234"
                maxLength={4}
                className="rounded-xl px-4 py-3 font-bebas text-2xl tracking-[0.3em] text-cream outline-none text-center"
                style={{
                  background: "rgba(255,255,255,0.05)",
                  border: "1px solid rgba(255,215,0,0.3)",
                }}
              />
              <button
                type="submit"
                disabled={busy !== "none" || joinCode.length !== 4}
                className="py-2.5 rounded-xl font-bebas text-base tracking-wider transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                style={{
                  background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                  color: "#04080F",
                  boxShadow: "0 4px 18px rgba(255,215,0,0.25)",
                }}
              >
                {busy === "joining" ? "JOINING..." : "JOIN"}
              </button>
            </form>
          </div>

          {error && (
            <p className="text-red-400 text-sm font-syne text-center mb-6" role="alert">
              {error}
            </p>
          )}

          {/* How to play */}
          <button
            onClick={() => setHowOpen((v) => !v)}
            className="w-full rounded-xl px-4 py-3 flex items-center justify-between font-bebas tracking-wider text-sm transition-colors"
            style={{
              background: "rgba(255,255,255,0.03)",
              border: "1px solid rgba(255,255,255,0.08)",
              color: "rgba(238,244,255,0.75)",
            }}
            aria-expanded={howOpen}
          >
            <span>HOW TO PLAY</span>
            <span className="text-cream/40 text-base">{howOpen ? "−" : "+"}</span>
          </button>

          <AnimatePresence>
            {howOpen && (
              <motion.div
                initial={reduced ? false : { opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                  <div
                    className="rounded-2xl p-5"
                    style={{
                      background: "linear-gradient(135deg, rgba(168,85,247,0.12) 0%, rgba(124,58,237,0.05) 100%)",
                      border: "1px solid rgba(168,85,247,0.3)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <PaintBrush size={24} weight="fill" className="text-purple-300" aria-hidden="true" />
                      <p className="font-bebas text-xl tracking-wider text-[#E9D5FF]">SKETCHY SUBJECTS</p>
                    </div>
                    <ul className="space-y-1.5 text-cream/75 text-sm font-syne">
                      <li>One person draws a subject-locked word.</li>
                      <li>Everyone else guesses in chat. First correct earns the most.</li>
                      <li>No fill bucket, no text. Just the canvas.</li>
                      <li>Subjects: Biology, Chemistry, Physics, Math, History, Geography, Astronomy, Pop Culture.</li>
                    </ul>
                  </div>
                  <div
                    className="rounded-2xl p-5"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(184,150,12,0.05) 100%)",
                      border: "1px solid rgba(255,215,0,0.3)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <ChatCircleText size={24} weight="fill" className="text-[#FFD700]" aria-hidden="true" />
                      <p className="font-bebas text-xl tracking-wider text-[#FFD700]">BLUFF TRIVIA</p>
                    </div>
                    <ul className="space-y-1.5 text-cream/75 text-sm font-syne">
                      <li>Everyone writes a fake answer to a trivia question.</li>
                      <li>Fakes are shuffled with the truth. Vote which is real.</li>
                      <li>Pick the truth, score big. Trick someone with your fake, score bigger.</li>
                      <li>2 to 6 players. 5 rounds default, configurable.</li>
                    </ul>
                  </div>
                  <div
                    className="rounded-2xl p-5"
                    style={{
                      background: "linear-gradient(135deg, rgba(0,191,255,0.12) 0%, rgba(0,123,191,0.05) 100%)",
                      border: "1px solid rgba(0,191,255,0.3)",
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Eye size={24} weight="fill" className="text-[#7DD3FC]" aria-hidden="true" />
                      <p className="font-bebas text-xl tracking-wider text-[#7DD3FC]">POKER FACE</p>
                    </div>
                    <ul className="space-y-1.5 text-cream/75 text-sm font-syne">
                      <li>Hold a secret fact. Present it as truth or a bluff.</li>
                      <li>The room calls believe or doubt. Read the face and the voice.</li>
                      <li>Best in person or on a call. A text-only mode is built in.</li>
                      <li>2 to 6 players. 2 rotations default, configurable.</li>
                    </ul>
                  </div>
                </div>
                <div className="mt-3 rounded-xl px-4 py-3 flex flex-wrap items-center gap-4 text-cream/60 text-xs font-syne"
                  style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)" }}>
                  <span className="flex items-center gap-1.5">
                    <Users size={16} weight="regular" aria-hidden="true" /> 2 to 6 players
                  </span>
                  <span className="flex items-center gap-1.5">
                    <Sparkle size={16} weight="regular" aria-hidden="true" /> No Fang stakes in V1
                  </span>
                  <span className="flex items-center gap-1.5">
                    <ChartLineUp size={16} weight="regular" aria-hidden="true" /> Score-based winner
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Create Room modal — name + privacy */}
        <AnimatePresence>
          {createOpen && (
            <motion.div
              className="fixed inset-0 z-50 grid place-items-center px-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ background: "rgba(2,3,8,0.7)", backdropFilter: "blur(8px)" }}
              onClick={() => setCreateOpen(false)}
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={reduced ? false : { y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { y: 16, opacity: 0 }}
                className="w-full max-w-md rounded-2xl p-6 relative"
                style={{
                  background: "linear-gradient(135deg, rgba(16,12,26,0.96) 0%, rgba(8,6,16,0.96) 100%)",
                  border: "1px solid rgba(168,85,247,0.4)",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
                }}
              >
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => setCreateOpen(false)}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full grid place-items-center text-cream/55 hover:text-cream/90 transition"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <XIcon size={14} weight="bold" aria-hidden="true" />
                </button>
                <p className="font-bebas text-3xl tracking-wider text-cream mb-1">NEW ROOM</p>
                <p className="text-cream/55 text-xs font-syne mb-5">
                  Optional name. Set who can drop in.
                </p>

                <label className="block text-cream/70 text-[11px] font-bold uppercase tracking-wider mb-2">
                  Room name <span className="text-cream/30 font-normal normal-case">(optional)</span>
                </label>
                <input
                  type="text"
                  value={roomName}
                  onChange={(e) => setRoomName(e.target.value.slice(0, 30))}
                  placeholder="Friday night party"
                  maxLength={30}
                  className="w-full rounded-xl px-3 py-2.5 text-sm text-cream outline-none mb-5"
                  style={{
                    background: "rgba(255,255,255,0.04)",
                    border: "1px solid rgba(255,255,255,0.1)",
                  }}
                />

                <label className="block text-cream/70 text-[11px] font-bold uppercase tracking-wider mb-2">
                  Who can join
                </label>
                <div className="grid grid-cols-3 gap-2 mb-6">
                  {(["open", "friends", "closed"] as const).map((m) => {
                    const label = m === "open" ? "Open" : m === "friends" ? "Friends" : "Invite";
                    const sub = m === "open" ? "Anyone with code" : m === "friends" ? "Auto-let-in friends" : "Approval only";
                    const on = privacyMode === m;
                    return (
                      <button
                        key={m}
                        type="button"
                        onClick={() => setPrivacyMode(m)}
                        className="rounded-xl px-3 py-2.5 text-left transition-all"
                        style={{
                          background: on
                            ? "linear-gradient(135deg, rgba(168,85,247,0.25) 0%, rgba(99,102,241,0.18) 100%)"
                            : "rgba(255,255,255,0.03)",
                          border: on ? "1px solid rgba(168,85,247,0.55)" : "1px solid rgba(255,255,255,0.08)",
                        }}
                      >
                        <p className="text-cream text-xs font-bold tracking-wide">{label}</p>
                        <p className="text-cream/40 text-[10px] mt-0.5 leading-tight">{sub}</p>
                      </button>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => { setCreateOpen(false); createRoom(); }}
                  disabled={busy !== "none"}
                  className="w-full py-3 rounded-xl font-bebas text-lg tracking-wider transition-all active:scale-95 disabled:opacity-40"
                  style={{
                    background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
                    color: "#fff",
                    boxShadow: "0 8px 24px rgba(168,85,247,0.35)",
                  }}
                >
                  {busy === "creating" ? "CREATING..." : "CREATE ROOM"}
                </button>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Request-to-join modal — surfaced when /join returns requires_request */}
        <AnimatePresence>
          {requestOpen && (
            <motion.div
              className="fixed inset-0 z-50 grid place-items-center px-4"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              style={{ background: "rgba(2,3,8,0.7)", backdropFilter: "blur(8px)" }}
              onClick={() => {
                setRequestOpen(false);
                setRequestStatus("idle");
              }}
            >
              <motion.div
                onClick={(e) => e.stopPropagation()}
                initial={reduced ? false : { y: 16, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={reduced ? { opacity: 0 } : { y: 16, opacity: 0 }}
                className="w-full max-w-md rounded-2xl p-6 relative"
                style={{
                  background: "linear-gradient(135deg, rgba(16,12,26,0.96) 0%, rgba(8,6,16,0.96) 100%)",
                  border: "1px solid rgba(255,215,0,0.35)",
                  boxShadow: "0 16px 48px rgba(0,0,0,0.6)",
                }}
              >
                <button
                  type="button"
                  aria-label="Close"
                  onClick={() => { setRequestOpen(false); setRequestStatus("idle"); }}
                  className="absolute top-3 right-3 w-8 h-8 rounded-full grid place-items-center text-cream/55 hover:text-cream/90 transition"
                  style={{ background: "rgba(255,255,255,0.04)" }}
                >
                  <XIcon size={14} weight="bold" aria-hidden="true" />
                </button>
                <p className="font-bebas text-3xl tracking-wider text-cream mb-1">REQUEST TO JOIN</p>
                <p className="text-cream/55 text-xs font-syne mb-5">
                  Room {requestCode} needs the host's OK. Add a note if you want.
                </p>

                {requestStatus === "idle" && (
                  <>
                    <label className="block text-cream/70 text-[11px] font-bold uppercase tracking-wider mb-2">
                      Note <span className="text-cream/30 font-normal normal-case">(optional, 50 chars)</span>
                    </label>
                    <input
                      type="text"
                      value={requestNote}
                      onChange={(e) => setRequestNote(e.target.value.slice(0, 50))}
                      placeholder="hey it's me from class"
                      maxLength={50}
                      className="w-full rounded-xl px-3 py-2.5 text-sm text-cream outline-none mb-5"
                      style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    {requestError && (
                      <p className="text-red-400 text-xs mb-3" role="alert">{requestError}</p>
                    )}
                    <button
                      type="button"
                      onClick={sendJoinRequest}
                      className="w-full py-3 rounded-xl font-bebas text-lg tracking-wider transition-all active:scale-95"
                      style={{ background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)", color: "#04080F" }}
                    >
                      SEND REQUEST
                    </button>
                  </>
                )}
                {requestStatus === "sending" && (
                  <p className="text-cream/65 text-sm py-6 text-center">Sending...</p>
                )}
                {requestStatus === "waiting" && (
                  <div className="py-6 text-center">
                    <p className="text-cream text-sm font-semibold mb-1">Sent.</p>
                    <p className="text-cream/55 text-xs">Waiting for the host. This auto-updates.</p>
                  </div>
                )}
                {requestStatus === "approved" && (
                  <p className="text-green-300 text-sm py-6 text-center font-semibold">
                    You're in. Hopping you over...
                  </p>
                )}
                {requestStatus === "declined" && (
                  <div className="py-4 text-center">
                    <p className="text-cream text-sm font-semibold mb-1">Host said no thanks.</p>
                    <p className="text-cream/55 text-xs">Try a different room.</p>
                    <button
                      type="button"
                      onClick={() => { setRequestOpen(false); setRequestStatus("idle"); }}
                      className="mt-4 px-4 py-2 rounded-lg text-xs font-bold text-cream/80"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      Close
                    </button>
                  </div>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ProtectedRoute>
  );
}
