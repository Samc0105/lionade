"use client";

import { useEffect, useMemo, useState } from "react";
import { ShareNetwork, Sword } from "@phosphor-icons/react";
import LionDesk from "@/components/liondesk/LionDesk";
import { generateShift, dateSeed, weekSeed } from "@/lib/liondesk/generate";
import { decodeCombo, encodeCombo, type ComboData, type ChallengeVs } from "@/lib/liondesk/combocode";
import { recordShiftResult } from "@/lib/liondesk/stats";
import { recordShiftConcepts } from "@/lib/liondesk/conceptMastery";
import { recordPlayDay } from "@/lib/liondesk/playstreak";
import { recordDailyClear, type DailyMode } from "@/lib/liondesk/dailyLog";
import { apiPost } from "@/lib/api-client";
import AchievementBanner from "@/components/liondesk/AchievementBanner";
import ChallengeResult from "@/components/liondesk/ChallengeResult";
import type { Shift } from "@/lib/liondesk/types";
import type { State, ShiftResult } from "@/lib/liondesk/engine";

interface Props {
  daily?: boolean;
  chaos?: boolean;
  weekly?: boolean;
  comboCode?: string;
  /** A shared, seeded code (Idea 14): reproduces one EXACT shift. */
  sharedCode?: string;
}

// Every generated shift carries its seed in the id (generateShift sets
// `surprise-<seed>`), so we can read it back to build a shareable code.
function seedOf(s: Shift): number | null {
  const m = /(\d+)$/.exec(s.id);
  return m ? Number(m[1]) >>> 0 : null;
}

// Idea 31: record a finished shared deterministic run on The Board. Best effort
// and fire and forget: the server clamps the score, derives the grade, computes
// the period key, and keeps the player's best for the current period. It grants
// nothing (the economy stays in the shift completions route). A held migration or
// a signed out player simply no ops with liveYet false, and any failure is
// swallowed, so a board write can never block, delay, or break the run itself.
// Called only for the three shared modes (Daily Combo, Daily Chaos, Weekly
// Challenge) the player can fairly be ranked on, never for seeded, combo, plain
// chaos, surprise, or beat my desk challenge runs (see dailyModeFor).
function postBoardScore(mode: DailyMode, score: number): void {
  apiPost<{ ok?: boolean; liveYet?: boolean }>("/api/techhub/leaderboard", { mode, score }).catch(() => {});
}

// Plays a procedurally generated shift. Modes:
// - sharedCode: a seeded link (Idea 14); reproduces one EXACT shift (same items,
//   order, mutators) and never rerolls into a different draw.
// - comboCode: a shared combo (decode + draw); rerolls to a fresh draw of the
//   same recipe.
// - daily / daily+chaos: date-seeded, stable for everyone today (no reroll).
// - chaos: 3-4 stacked modifiers, rerolls.
// - default: a random Surprise Shift, rerolls.
// Generated after mount so the RNG / date never run during SSR.
export default function PlayGeneratedShift({ daily = false, chaos = false, weekly = false, comboCode, sharedCode }: Props) {
  const [shift, setShift] = useState<Shift | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [newAch, setNewAch] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  // Idea 29: the recipient's own finished result, captured on completion so a
  // challenge link can embed it and the you versus them comparison can render.
  const [result, setResult] = useState<ShiftResult | null>(null);
  const [challengeCopied, setChallengeCopied] = useState(false);

  // The sharer's embedded score and grade, if this run was opened from a beat my
  // desk challenge link (Idea 29). Null for a plain seed, combo, daily, or
  // surprise run. Decoded from the URL (deterministic, no storage), so there is no
  // flash-of-zero to guard.
  const challenger = useMemo<ChallengeVs | null>(() => {
    if (!sharedCode) return null;
    return decodeCombo(sharedCode)?.vs ?? null;
  }, [sharedCode]);

  function makeShift(): Shift {
    // A seeded share code wins over every other flag, so the link is exact and
    // the precedence never collides with daily / weekly / chaos / comboCode.
    if (sharedCode) {
      const c = decodeCombo(sharedCode);
      if (c) {
        if (c.seed != null) {
          // Rolled mutators are re-rolled from the seed (replaying the RNG gives
          // the identical queue); hand-picked mutators are applied verbatim.
          return c.rolled
            ? generateShift({ seed: c.seed, chaos: c.chaos, track: c.track, count: c.count, name: "Shared Shift" })
            : generateShift({ seed: c.seed, track: c.track, count: c.count, modifierIds: c.modifierIds, name: "Shared Shift" });
        }
        return generateShift({ track: c.track, count: c.count, modifierIds: c.modifierIds, name: "Shared Shift" });
      }
    }
    if (comboCode) {
      const c = decodeCombo(comboCode);
      if (c) return generateShift({ track: c.track, count: c.count, modifierIds: c.modifierIds, name: "Shared Combo" });
    }
    if (weekly) return generateShift({ seed: weekSeed(), chaos: true, name: "Weekly Challenge" });
    if (chaos && daily) return generateShift({ seed: dateSeed(), chaos: true, name: "Daily Chaos" });
    if (chaos) return generateShift({ chaos: true, name: "Chaos Shift" });
    if (daily) return generateShift({ seed: dateSeed(), name: "Daily Combo" });
    return generateShift({ name: "Surprise Shift" });
  }

  // daily, daily-chaos, weekly, and a shared exact shift are the fixed runs;
  // everything else rerolls into a fresh draw.
  const rerollable = !daily && !weekly && !sharedCode;

  // Which of the three shared, deterministic modes (if any) this shift is, using
  // the SAME query-flag precedence as makeShift above. Returns null for the
  // non-shared variants (Shared Shift, Shared Combo, Chaos Shift, Surprise Shift)
  // so the Today's Board only tracks the three shared modes the player can
  // actually clear off the checklist.
  function dailyModeFor(): DailyMode | null {
    if (sharedCode) return null;
    if (comboCode) return null;
    if (weekly) return "weekly";
    if (chaos && daily) return "chaos";
    if (chaos) return null;
    if (daily) return "combo";
    return null;
  }

  // The shareable code for the shift on screen, capturing its full config so the
  // link reproduces it exactly. A shift opened from a shared link re-shares the
  // very same code; otherwise we read the seed off the shift and pack the recipe.
  function shareDataFor(s: Shift): ComboData | null {
    const seed = seedOf(s);
    if (seed == null) return null;
    if (comboCode) {
      // Hand-picked recipe: keep the chosen track, count, and mutators verbatim.
      const c = decodeCombo(comboCode);
      return { track: c?.track, count: c?.count ?? 6, modifierIds: (s.modifiers ?? []).map((m) => m.id), seed };
    }
    // Rolled run (surprise / chaos / daily / weekly): the mutators come from the
    // seed, so the code only needs the seed plus whether it rolled in chaos mode.
    return { track: undefined, count: 6, modifierIds: [], seed, rolled: true, chaos: weekly || chaos };
  }

  function shareShift() {
    if (!shift || typeof window === "undefined") return;
    // Re-share the exact code we were opened with, else build one from this shift.
    let code = sharedCode;
    if (!code) {
      const data = shareDataFor(shift);
      if (!data) return;
      code = encodeCombo(data);
    }
    if (!code) return;
    const url = `${window.location.origin}/learn/techhub/surprise?seed=${code}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
    }
  }

  // Idea 29: copy a beat my desk challenge link. It rebuilds the exact shift just
  // played and embeds the player's own score and grade, so a friend who opens it
  // plays the identical queue and sees how they stack up. Available only once the
  // shift is finished (you cannot challenge with a score you do not have yet). It
  // grants nothing and touches no server; the seed and the vs both live in the URL.
  function challengeFriend() {
    if (!shift || !result || typeof window === "undefined") return;
    const vs: ChallengeVs = { score: result.score, grade: result.grade };
    // From a shared or challenge link, reuse its exact config and just swap in my
    // own score as the new bar. Otherwise pack this shift's recipe like a share.
    let data: ComboData | null = null;
    if (sharedCode) {
      const c = decodeCombo(sharedCode);
      if (c) data = { ...c, vs };
    }
    if (!data) {
      const base = shareDataFor(shift);
      if (!base) return;
      data = { ...base, vs };
    }
    const code = encodeCombo(data);
    if (!code) return;
    const url = `${window.location.origin}/learn/techhub/surprise?seed=${code}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => { setChallengeCopied(true); setTimeout(() => setChallengeCopied(false), 1800); }).catch(() => {});
    }
  }

  useEffect(() => {
    setShift(makeShift());
    setCopied(false);
    setChallengeCopied(false);
    setResult(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, chaos, weekly, comboCode, sharedCode]);

  function reroll() {
    setShift(makeShift());
    setRunKey((k) => k + 1);
    setCopied(false);
    setChallengeCopied(false);
    setResult(null);
  }

  if (!shift) {
    return <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-10 text-center text-cream/40 font-mono text-sm">shuffling the queue...</div>;
  }

  return (
    <div className="space-y-3">
      <AchievementBanner ids={newAch} />
      {/* Idea 29: beat my desk. When this run was opened from a challenge link,
          show the bar to beat before the recipient finishes, then the you versus
          them comparison on completion. Rendered here (above the desk, outside the
          focus trapped report) so it stays keyboard and screen reader reachable,
          the same reasoning as the Share this shift control below. */}
      {challenger && <ChallengeResult theirs={challenger} mine={result} />}
      {shift.modifiers && shift.modifiers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">modifiers</span>
          {shift.modifiers.map((m) => (
            <span key={m.id} title={m.desc} className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.15)", color: "#C9A2F2", border: "1px solid rgba(168,85,247,0.35)" }}>{m.label}</span>
          ))}
        </div>
      )}

      {/* Idea 14: share the shift. Rendered inline above the desk and available
          throughout the run (not gated on completion), so it stays keyboard and
          screen-reader reachable. The end-of-shift report is a focus-trapped
          aria-modal dialog inside LionDesk, so a control surfaced only after
          completion would sit outside that trap and read as mouse only; keeping
          it here, before the report opens, gives assistive tech users a real path
          to it. Display only, it grants nothing and copies a seeded link, no
          backend involved. */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#A855F7]/25 bg-[#A855F7]/[0.06] px-3 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">Share this shift</span>
        <button
          onClick={shareShift}
          className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[#A855F7]/45 text-[#C9A2F2] text-[11px] hover:bg-[#A855F7]/10 transition-colors"
        >
          <ShareNetwork size={13} weight="fill" aria-hidden="true" /> <span aria-live="polite">{copied ? "Link copied" : "Copy link"}</span>
        </button>
        {result && (
          <button
            onClick={challengeFriend}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gold/45 text-gold text-[11px] hover:bg-gold/10 transition-colors"
          >
            <Sword size={13} weight="fill" aria-hidden="true" /> <span aria-live="polite">{challengeCopied ? "Challenge copied" : "Challenge a friend"}</span>
          </button>
        )}
        <p className="w-full font-mono text-[10px] text-cream/40 leading-relaxed">
          Copies a link that rebuilds this shift, the same tickets in the same order, for anyone you send it to.
        </p>
        {result && (
          <p className="w-full font-mono text-[10px] text-cream/40 leading-relaxed">
            Beat my desk: the challenge link adds your score ({result.score}, grade {result.grade}) so a friend plays this exact shift and sees how they stack up against you.
          </p>
        )}
      </div>

      <LionDesk key={`${shift.id}-${runKey}`} shift={shift} onComplete={(r, state: State) => {
        recordPlayDay();
        recordShiftConcepts(shift, state);
        const dm = dailyModeFor();
        if (dm) {
          // Local clock in log keeps the best non-D grade for the day (display only).
          if (r.grade !== "D") recordDailyClear(dm, r.grade);
          // Idea 31: post the run to the server ranked Board. Every finished shared
          // run counts (the server keeps your best), even a D, so your standing is
          // always your true best for the period. Best effort, never blocks.
          postBoardScore(dm, r.score);
        }
        setNewAch(recordShiftResult(shift, r));
        setResult(r);
      }} onReplay={rerollable ? reroll : undefined} />
      <p className="font-mono text-[10px] text-cream/40">
        {sharedCode
          ? "A shared shift. The same queue every time you open this link."
          : daily
          ? "Today's challenge is the same for everyone and rerolls at midnight."
          : "A fresh draw every time. Hit “Run it back” for a new combo."}
      </p>
    </div>
  );
}
