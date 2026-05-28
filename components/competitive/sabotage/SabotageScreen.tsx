"use client";

// Sabotage Trivia — flagship real-time PvP screen.
//
// Both players answer the SAME shuffled question bank against a per-round timer.
// A correct + fast answer charges the attack meter; spending charge fires an
// attack at the opponent, delivered peer-to-peer via Supabase broadcast on the
// match channel. The victim's client applies the effect (blur/scramble/drain/
// decoy/freeze/fog). At the end, each side's correct-answer score is submitted
// to the shared /complete endpoint.
//
// Real-time delivery is BROADCAST (not postgres_changes) per the realtime doc.

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useMatchChannel } from "@/lib/competitive/use-match-channel";
import { useSettle } from "../useSettle";
import ResultCard from "../ResultCard";
import {
  ATTACK_META,
  ATTACK_COSTS,
  METER_MAX,
  ATTACK_COOLDOWN_MS,
  chargeForAnswer,
  canFire,
  applyFire,
  applyCharge,
  type MeterState,
} from "@/lib/competitive/sabotage-economy";
import { SABOTAGE_EVENTS, type SabotageAttackKind } from "@/lib/competitive/channels";
import { apiPost } from "@/lib/api-client";
import type { LoadedMatch } from "@/app/compete/arena/[mode]/[matchId]/page";

const ROUND_MS = 12_000;

// correct_index is stripped from the in-flight payload by the sanitized match
// route. The server grades each answer and returns correct_index in the /answer
// reveal, which we use only AFTER the player has answered (for the highlight).
interface Round {
  id: string;
  round_num: number;
  question: string;
  options: string[];
  category: string | null;
}

interface ActiveEffect {
  kind: SabotageAttackKind;
  until: number;
}

export default function SabotageScreen({ loaded, selfId }: { loaded: LoadedMatch; selfId: string }) {
  const matchId = loaded.match.id;
  const rounds = loaded.rounds as unknown as Round[];
  const { on, send } = useMatchChannel(matchId, selfId);
  const { settle, result } = useSettle(matchId);

  const enemyTeam = useMemo(
    () => (loaded.match.team_a.includes(selfId) ? loaded.match.team_b : loaded.match.team_a),
    [loaded.match, selfId],
  );

  const [roundIdx, setRoundIdx] = useState(0);
  const [score, setScore] = useState(0);
  const [oppScore, setOppScore] = useState(0);
  const [meter, setMeter] = useState<MeterState>({ charge: 0, lastFiredAt: 0 });
  const [roundStart, setRoundStart] = useState(() => Date.now());
  const [answered, setAnswered] = useState<number | null>(null);
  const [correctIdx, setCorrectIdx] = useState<number | null>(null); // revealed post-answer
  const [now, setNow] = useState(Date.now());
  const [effects, setEffects] = useState<ActiveEffect[]>([]);
  const [scrambleSeed, setScrambleSeed] = useState(0);
  const [finished, setFinished] = useState(false);
  const oppFinishedRef = useRef(false);
  const myScoreRef = useRef(0);

  const round = rounds[roundIdx];

  // ── tick ──
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(t);
  }, []);

  // expire effects
  useEffect(() => {
    if (effects.length === 0) return;
    setEffects((prev) => prev.filter((e) => e.until > now));
  }, [now, effects.length]);

  const elapsed = now - roundStart;
  const drained = effects.filter((e) => e.kind === "drain" && e.until > now).length * 5000;
  const timeLeft = Math.max(0, ROUND_MS - elapsed - drained);

  const hasEffect = (k: SabotageAttackKind) => effects.some((e) => e.kind === k && e.until > now);

  // ── incoming attacks ──
  useEffect(() => {
    const offAttack = on(SABOTAGE_EVENTS.ATTACK, (p) => {
      const target = String(p.target_id ?? "");
      if (target !== selfId) return;
      const kind = p.kind as SabotageAttackKind;
      const durations: Record<SabotageAttackKind, number> = {
        blur: 3000, scramble: 4000, drain: 0, decoy: 4000, freeze: 2000, fog: 2500,
      };
      if (kind === "scramble") setScrambleSeed((s) => s + 1);
      setEffects((prev) => [...prev, { kind, until: Date.now() + (durations[kind] || 3000) }]);
    });
    const offAns = on(SABOTAGE_EVENTS.ANSWERED, (p) => {
      const from = String(p._from ?? "");
      if (enemyTeam.includes(from) && p.correct) setOppScore((s) => s + 1);
    });
    const offFin = on(SABOTAGE_EVENTS.FINISHED, (p) => {
      const from = String(p._from ?? "");
      if (enemyTeam.includes(from)) oppFinishedRef.current = true;
    });
    return () => { offAttack(); offAns(); offFin(); };
  }, [on, selfId, enemyTeam]);

  const fireAttack = useCallback(
    (kind: SabotageAttackKind) => {
      const check = canFire(meter, kind, Date.now());
      if (!check.ok) return;
      const target = enemyTeam[Math.floor(Math.random() * enemyTeam.length)];
      setMeter((m) => applyFire(m, kind, Date.now()));
      send({ type: SABOTAGE_EVENTS.ATTACK, kind, attacker_id: selfId, target_id: target });
      apiPost("/api/competitive/sabotage/attack", { matchId, targetId: target, kind }).catch(() => {});
    },
    [meter, enemyTeam, send, selfId, matchId],
  );

  const advance = useCallback(() => {
    setAnswered(null);
    setCorrectIdx(null);
    setEffects([]);
    if (roundIdx + 1 >= rounds.length) {
      setFinished(true);
      send({ type: SABOTAGE_EVENTS.FINISHED });
      return;
    }
    setRoundIdx((i) => i + 1);
    setRoundStart(Date.now());
  }, [roundIdx, rounds.length, send]);

  const answer = useCallback(
    async (idx: number) => {
      if (answered !== null || hasEffect("freeze") || finished) return;
      setAnswered(idx); // lock the grid immediately; the server grades the pick
      const { ok, data } = await apiPost<{ isCorrect: boolean; reveal: { correct_index: number } }>(
        `/api/competitive/match/${matchId}/answer`,
        { roundNum: round.round_num, index: idx },
      );
      const correct = ok && !!data?.isCorrect;
      if (ok && data) setCorrectIdx(data.reveal.correct_index);
      if (correct) {
        setScore((s) => { myScoreRef.current = s + 1; return s + 1; });
        const charge = chargeForAnswer({ correct, responseMs: elapsed, timeLimitMs: ROUND_MS });
        setMeter((m) => applyCharge(m, charge));
      }
      send({ type: SABOTAGE_EVENTS.ANSWERED, correct });
      setTimeout(advance, 1100);
    },
    [answered, round, elapsed, send, advance, finished, matchId],
  );

  // auto-advance on timeout
  useEffect(() => {
    if (answered !== null || finished) return;
    if (timeLeft <= 0) {
      send({ type: SABOTAGE_EVENTS.ANSWERED, correct: false });
      advance();
    }
  }, [timeLeft, answered, finished, advance, send]);

  // settle when finished — the outcome is recomputed server-side from
  // competitive_responses (the /answer route scored every pick); no score map.
  useEffect(() => {
    if (!finished) return;
    settle();
  }, [finished, settle]);

  if (result) {
    return <ResultCard result={result} selfId={selfId} teamA={loaded.match.team_a} />;
  }
  if (finished) {
    return (
      <div className="flex-1 flex items-center justify-center text-center px-6">
        <p className="font-bebas text-3xl text-cream/70 tracking-wider">SETTLING DUEL...</p>
      </div>
    );
  }
  if (!round) return <p className="text-cream/60 text-center flex-1 flex items-center justify-center">No questions loaded.</p>;

  // display options (apply scramble + fog)
  let displayOptions = round.options.map((text, i) => ({ text, origIdx: i }));
  if (hasEffect("scramble")) {
    const seeded = [...displayOptions];
    for (let i = seeded.length - 1; i > 0; i--) {
      const j = (i * 7 + scrambleSeed * 13) % (i + 1);
      [seeded[i], seeded[j]] = [seeded[j], seeded[i]];
    }
    displayOptions = seeded;
  }
  const fogHidden = hasEffect("fog") ? [1, 3] : [];
  // Decoy points a misleading "suggested" badge at one option. It must NOT depend
  // on the secret correct_index (which the client no longer holds pre-answer); a
  // deterministic per-round index is just as deceptive to the victim.
  const decoyIdx = hasEffect("decoy") ? (round.round_num * 3 + 1) % round.options.length : -1;

  return (
    <div className="relative flex-1 min-h-0 flex flex-col w-full px-3 sm:px-6">
      {/* HUD pinned to the top edge */}
      <div className="flex-none w-full max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <div className="text-cream/70">
            <span className="font-bebas text-3xl sm:text-4xl text-[#EF4444]">{score}</span>
            <span className="text-cream/40 text-sm"> you</span>
          </div>
          <div className="font-bebas tracking-wider text-cream/50 text-sm">
            ROUND {roundIdx + 1} / {rounds.length}
          </div>
          <div className="text-cream/70 text-right">
            <span className="font-bebas text-3xl sm:text-4xl text-cream/60">{oppScore}</span>
            <span className="text-cream/40 text-sm"> rival</span>
          </div>
        </div>

        {/* timer */}
        <div className="h-2 rounded-full bg-cream/[0.07] overflow-hidden">
          <div className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${(timeLeft / ROUND_MS) * 100}%`, background: timeLeft < 3000 ? "#EF4444" : "#FFD700" }} />
        </div>
      </div>

      {/* Center mass: question + options dominate the screen */}
      <div className="flex-1 min-h-0 flex flex-col justify-center w-full max-w-5xl mx-auto py-4">
        {/* question */}
        <div className={`relative rounded-2xl p-6 sm:p-8 mb-4 sm:mb-6 transition-all ${hasEffect("blur") ? "blur-md" : ""}`}
          style={{ background: "linear-gradient(135deg, #150505 0%, #0d0303 50%, #060c18 100%)", border: "1px solid rgba(239,68,68,0.25)" }}>
          {round.category && <p className="text-[#EF4444]/70 text-[10px] uppercase tracking-widest mb-2">{round.category}</p>}
          <p className="text-cream/90 text-xl sm:text-2xl lg:text-3xl leading-snug font-medium">{round.question}</p>
          {hasEffect("freeze") && (
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center bg-[#00BFFF]/10 backdrop-blur-sm">
              <span className="font-bebas text-3xl text-[#00BFFF] tracking-widest">❄ FROZEN</span>
            </div>
          )}
        </div>

        {/* options */}
        <div className={`grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4 ${hasEffect("blur") ? "blur-md pointer-events-none" : ""}`}>
          {displayOptions.map((opt, displayI) => {
            const isHidden = fogHidden.includes(displayI);
            const isAnswered = answered !== null;
            const isCorrect = correctIdx !== null && opt.origIdx === correctIdx;
            const isMine = answered === opt.origIdx;
            const isDecoy = opt.origIdx === decoyIdx;
            return (
              <button
                key={opt.origIdx}
                onClick={() => answer(opt.origIdx)}
                disabled={isAnswered || hasEffect("freeze")}
                className={`relative text-left px-5 py-4 sm:py-5 rounded-xl border transition-all text-base sm:text-lg
                  ${isAnswered && isCorrect ? "border-[#50C878] bg-[#50C878]/15"
                    : isAnswered && isMine ? "border-[#EF4444] bg-[#EF4444]/15"
                    : "border-cream/10 bg-cream/[0.03] hover:border-cream/25 active:scale-[0.98]"}
                  ${isDecoy && !isAnswered ? "ring-1 ring-[#A855F7]/40" : ""}`}
              >
                <span className={`text-cream/85 ${isHidden ? "blur-sm select-none" : ""}`}>
                  {isHidden ? "• • • • •" : opt.text}
                </span>
                {isDecoy && !isAnswered && (
                  <span className="absolute top-1 right-2 text-[8px] text-[#A855F7]/70 uppercase">suggested</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* attack tray pinned to the bottom edge */}
      <div className="flex-none w-full max-w-5xl mx-auto rounded-2xl p-3 sm:p-4 mt-auto"
        style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(168,85,247,0.18)" }}>
        <div className="flex items-center justify-between mb-2.5">
          <span className="font-bebas text-sm tracking-wider text-[#A855F7]">ATTACK METER</span>
          <span className="text-cream/40 text-xs">{Math.round(meter.charge)} / {METER_MAX}</span>
        </div>
        <div className="h-2 rounded-full bg-cream/[0.07] overflow-hidden mb-3">
          <div className="h-full rounded-full transition-[width] duration-300"
            style={{ width: `${(meter.charge / METER_MAX) * 100}%`, background: "linear-gradient(90deg, #A855F7, #00BFFF)" }} />
        </div>
        <div className="grid grid-cols-6 gap-2">
          {(Object.keys(ATTACK_META) as SabotageAttackKind[]).map((kind) => {
            const cost = ATTACK_COSTS[kind];
            const affordable = meter.charge >= cost && now - meter.lastFiredAt >= ATTACK_COOLDOWN_MS;
            return (
              <button
                key={kind}
                onClick={() => fireAttack(kind)}
                disabled={!affordable}
                title={ATTACK_META[kind].desc}
                className={`flex flex-col items-center gap-0.5 py-2 rounded-lg border text-center transition-all
                  ${affordable ? "border-[#A855F7]/40 bg-[#A855F7]/10 hover:bg-[#A855F7]/20 active:scale-95" : "border-cream/5 bg-cream/[0.02] opacity-40"}`}
              >
                <span className="text-lg leading-none">{ATTACK_META[kind].icon}</span>
                <span className="text-[9px] text-cream/70 font-bebas tracking-wide">{ATTACK_META[kind].label}</span>
                <span className="text-[8px] text-cream/40">{cost}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
