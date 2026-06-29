// Golden-master tests for the pure LionDesk engine (lib/liondesk/engine.ts) and
// the scoring module (lib/liondesk/scoring.ts). No React, no DOM: the reducer is
// driven through fixed action sequences and the resulting numbers are pinned as
// literals. The point is a snapshot of the current behavior so a future refactor
// cannot silently change the scoring or economy math. When a change to either is
// intentional, update the expected literals here in the same commit.
//
// These build their own small synthetic shifts rather than importing authored
// content, so content edits never break the engine snapshot and the engine math
// stays the only thing under test. The economy stays server-authoritative: the
// Fang numbers asserted here are the engine PREVIEW (and the shared payout
// weighting); nothing here grants anything.

import { describe, expect, it } from "vitest";

import {
  buildInitial,
  computeResult,
  makeReducer,
  payoutWeight,
  shiftPayout,
  slaBudget,
  type Action,
  type Difficulty,
  type State,
} from "../engine";
import { gradeFor, PASS_SCORE, slaRemaining } from "../scoring";
import type { ActionCard, Shift, ShiftItem } from "../types";

/* ───────────────────────── synthetic content ───────────────────────── */

function action(o: Partial<ActionCard> & { id: string }): ActionCard {
  return { label: "Apply the fix", csat: 0, teach: "That is the right move.", ...o };
}

function ticketItem(
  o: Partial<ShiftItem> & { id: string; subject: string; reward: number; xp: number; actions: ActionCard[] },
): ShiftItem {
  return {
    channel: "ticket",
    priority: "P3",
    from: { name: "Riley Staff", role: "Staff" },
    slaMinutes: 15,
    arriveAfter: 0,
    goal: "Resolve the request.",
    hint: "Read the evidence first.",
    ...o,
  };
}

function phoneItem(
  o: Partial<ShiftItem> & { id: string; subject: string; reward: number; xp: number; actions: ActionCard[] },
): ShiftItem {
  return {
    channel: "phone",
    priority: "P2",
    from: { name: "Casey Caller", role: "Staff" },
    slaMinutes: 15,
    arriveAfter: 0,
    goal: "Pin the issue on the call.",
    hint: "Ask the right question first.",
    phone: {
      opener: "My laptop will not connect.",
      followups: [
        { label: "When did it start?", reply: "This morning.", correct: true },
        { label: "Did you try a reboot?", reply: "Yes, twice." },
      ],
    },
    ...o,
  };
}

function makeShift(o: Partial<Shift> & { id: string; items: ShiftItem[] }): Shift {
  return {
    track: "helpdesk",
    order: 0,
    name: "Golden Master Bench",
    rank: "Help Desk Technician",
    durationSeconds: 600,
    startingBudget: 0,
    inventory: [],
    kb: [],
    adUsers: [],
    ...o,
  };
}

/** Boot a shift to its post-clock-in state and hand back tiny drivers. */
function harness(shift: Shift, difficulty: Difficulty = "normal") {
  const reduce = makeReducer(shift);
  const start = reduce(buildInitial(shift), { t: "START", difficulty });
  const apply = (state: State, ...actions: Action[]): State =>
    actions.reduce((acc, a) => reduce(acc, a), state);
  const tick = (state: State, n: number): State =>
    apply(state, ...Array.from({ length: n }, () => ({ t: "TICK" }) as Action));
  return { reduce, start, apply, tick };
}

/* ───────────────────────── end-to-end golden master ───────────────────────── */

describe("engine: full shift golden master", () => {
  // A representative shift: two routine tickets (one gated behind a KB read), an
  // incident root that mass-resolves its duplicate, and a VIP that gets a botched
  // ending move. Driven through a fixed action sequence; every resulting number
  // is pinned below.
  const shift = makeShift({
    id: "gm-end-to-end",
    kb: [{ id: "kb-1", title: "Clear the print spooler", tags: ["printing"], body: ["Stop the spooler, clear the queue, start it again."] }],
    items: [
      ticketItem({ id: "t1", subject: "Password reset", reward: 120, xp: 40, actions: [action({ id: "t1-ok", correct: true, csat: 4 })] }),
      ticketItem({ id: "t2", subject: "Printer offline", reward: 120, xp: 40, kbArticleId: "kb-1", actions: [action({ id: "t2-ok", correct: true, csat: 4, requires: ["kb"] })] }),
      ticketItem({ id: "inc-root", subject: "Email outage", priority: "P2", reward: 200, xp: 80, incident: { group: "out", root: true }, actions: [action({ id: "inc-ok", correct: true, csat: 6 })] }),
      ticketItem({ id: "inc-dup", subject: "I cannot send mail", reward: 80, xp: 30, incident: { group: "out" }, actions: [action({ id: "inc-dup-ok", correct: true, csat: 4 })] }),
      ticketItem({
        id: "vip",
        subject: "CEO cannot open the deck",
        priority: "P4",
        reward: 100,
        xp: 50,
        from: { name: "Pat Chief", role: "CEO", vip: true },
        actions: [action({ id: "vip-bad", correct: false, ends: true, outcome: "mishandled", csat: -10, teach: "Never brush off a VIP. Confirm and fix it." })],
      }),
    ],
  });

  const { start, apply } = harness(shift, "normal");
  const final = apply(
    start,
    { t: "KB", articleId: "kb-1" },
    { t: "RESOLVE", id: "t1", actionId: "t1-ok" },
    { t: "RESOLVE", id: "t2", actionId: "t2-ok" },
    { t: "RESOLVE", id: "inc-root", actionId: "inc-ok" },
    { t: "RESOLVE", id: "vip", actionId: "vip-bad" },
  );

  it("ends once every live item is terminal", () => {
    expect(final.ended).toBe(true);
  });

  it("pins the item status transitions (incl. mass-resolved duplicate)", () => {
    expect(final.items["t1"].status).toBe("resolved");
    expect(final.items["t2"].status).toBe("resolved");
    expect(final.items["inc-root"].status).toBe("resolved");
    // inc-dup is never resolved by its own action: fixing the incident root
    // mass-resolves the rest of the group.
    expect(final.items["inc-dup"].status).toBe("resolved");
    expect(final.items["vip"].status).toBe("mishandled");
  });

  it("pins the CSAT, Fang preview, XP, and best streak", () => {
    // Correct picks at 100 CSAT clamp to 100; the only net move is the VIP botch
    // (csat -10, then -3 VIP weight, scaled x1 on normal) so CSAT lands at 87.
    expect(final.csat).toBe(87);
    // Fang preview: 120 + 120 + round(200 * 1.25 streak) = 120 + 120 + 250 = 490.
    expect(final.fangs).toBe(490);
    // XP preview: 40 + 40 + round(80 * 1.25) = 40 + 40 + 100 = 180.
    expect(final.xp).toBe(180);
    expect(final.bestStreak).toBe(3);
    // The VIP botch was the last move, so the live streak reset to zero.
    expect(final.streak).toBe(0);
  });

  it("pins the score, letter grade, and difficulty-weighted Fang payout", () => {
    const result = computeResult(shift, final);
    // score = round(csat * 0.6 + resolved/total * 40) = round(87*0.6 + 4/5*40) = 84.
    expect(result.score).toBe(84);
    expect(result.grade).toBe("A");
    expect(result.grade).toBe(gradeFor(result.score));
    expect(result.resolved).toBe(4);
    expect(result.total).toBe(5);
    expect(result.csat).toBe(87);
    expect(result.fangs).toBe(490);
    expect(result.usedLifeline).toBe(false);
    // payoutWeight(normal, clean clear, streak 3) = 0.8 + 0.05 + 0.03 = 0.88.
    expect(result.payoutFactor).toBeCloseTo(0.88, 5);
    // Server-authoritative ceiling is illustrative here (360). The shared payout
    // formula weights it by how the shift was played: round(360 * 0.84 * 0.88).
    expect(shiftPayout(360, result.score, result.difficulty, result.usedLifeline, result.bestStreak)).toBe(266);
  });
});

/* ───────────────────────── resolve-streak multiplier ───────────────────────── */

describe("engine: resolve-streak multiplier", () => {
  // Eight identical correct resolves walk the multiplier ladder: x1 (1-2),
  // x1.25 (3-4), x1.5 (5-7), x1.75 (8+). Each ticket is worth 100 Fangs / 100 XP.
  const shift = makeShift({
    id: "gm-streak",
    items: Array.from({ length: 8 }, (_unused, i) =>
      ticketItem({ id: `s${i + 1}`, subject: `Routine ticket ${i + 1}`, priority: "P4", reward: 100, xp: 100, actions: [action({ id: `s${i + 1}-ok`, correct: true, csat: 0 })] }),
    ),
  });

  it("applies x1, x1.25, x1.5, and x1.75 at the right thresholds", () => {
    const { start, apply } = harness(shift, "normal");
    let s = start;
    const resolve = (id: string) => {
      s = apply(s, { t: "RESOLVE", id, actionId: `${id}-ok` });
    };

    resolve("s1");
    expect(s.streak).toBe(1);
    expect(s.fangs).toBe(100); // x1
    resolve("s2");
    expect(s.fangs).toBe(200); // x1
    resolve("s3");
    expect(s.streak).toBe(3);
    expect(s.fangs).toBe(325); // +round(100 * 1.25)
    resolve("s4");
    expect(s.fangs).toBe(450); // +125
    resolve("s5");
    expect(s.streak).toBe(5);
    expect(s.fangs).toBe(600); // +round(100 * 1.5)
    resolve("s6");
    expect(s.fangs).toBe(750); // +150
    resolve("s7");
    expect(s.fangs).toBe(900); // +150
    resolve("s8");
    expect(s.streak).toBe(8);
    expect(s.fangs).toBe(1075); // +round(100 * 1.75)
    expect(s.xp).toBe(1075);
    expect(s.bestStreak).toBe(8);
    expect(s.ended).toBe(true);
  });
});

/* ───────────────────────── requires gate ───────────────────────── */

describe("engine: requires gate", () => {
  const shift = makeShift({
    id: "gm-gate",
    kb: [{ id: "kb-g", title: "Reset the VPN client", tags: ["vpn"], body: ["Sign out, clear the cache, sign back in."] }],
    items: [
      ticketItem({ id: "g", subject: "VPN keeps dropping", reward: 100, xp: 40, kbArticleId: "kb-g", actions: [action({ id: "g-ok", correct: true, csat: 0, requires: ["kb"] })] }),
      // Keeps the shift open so we can inspect state after the gated resolve.
      ticketItem({ id: "keepalive", subject: "Spare request", reward: 50, xp: 20, actions: [action({ id: "keepalive-ok", correct: true, csat: 0 })] }),
    ],
  });

  it("blocks a resolve until its required step is done, then allows it", () => {
    const { start, apply } = harness(shift, "normal");

    const blocked = apply(start, { t: "RESOLVE", id: "g", actionId: "g-ok" });
    // Gate teaches instead of resolving: no status change, no try burned, no CSAT move.
    expect(blocked.items["g"].status).toBe("queued");
    expect(blocked.items["g"].attempts).toBe(0);
    expect(blocked.csat).toBe(100);
    const lastBlocked = blocked.feed[blocked.feed.length - 1];
    expect(lastBlocked.text).toContain("Hold on");
    expect(lastBlocked.tone).toBe("info");

    const resolved = apply(blocked, { t: "KB", articleId: "kb-g" }, { t: "RESOLVE", id: "g", actionId: "g-ok" });
    expect(resolved.items["g"].status).toBe("resolved");
    expect(resolved.items["g"].attempts).toBe(1);
    expect(resolved.ended).toBe(false);
  });
});

/* ───────────────────────── phone patience meter ───────────────────────── */

describe("engine: phone patience meter", () => {
  const shift = makeShift({
    id: "gm-phone",
    items: [phoneItem({ id: "call", subject: "Cannot connect to wifi", reward: 100, xp: 50, actions: [action({ id: "call-ok", correct: true, csat: 5, requires: ["phone"] })] })],
  });

  it("drains 2 per tick once picked up, drops on a wrong question, and stops once pinned", () => {
    const { start, apply, tick } = harness(shift, "normal");

    const opened = apply(start, { t: "OPEN", id: "call" });
    const afterTicks = tick(opened, 3);
    // PATIENCE_DECAY 2 per tick on normal: 100 -> 98 -> 96 -> 94.
    expect(afterTicks.items["call"].patience).toBe(94);

    const afterWrong = apply(afterTicks, { t: "PHONE", id: "call", index: 1, correct: false });
    // PATIENCE_WRONG 18: 94 -> 76.
    expect(afterWrong.items["call"].patience).toBe(76);

    const afterPin = apply(afterWrong, { t: "PHONE", id: "call", index: 0, correct: true });
    expect(afterPin.items["call"].steps).toContain("phone");
    // Once the issue is pinned the caller stops draining, even across more ticks.
    const settled = tick(afterPin, 3);
    expect(settled.items["call"].patience).toBe(76);
  });

  it("hangs up at zero patience: mishandled call and a CSAT hit", () => {
    const { start, apply } = harness(shift, "normal");
    let s = apply(start, { t: "OPEN", id: "call" });
    // 100 -> 82 -> 64 -> 46 -> 28 -> 10 -> 0 (the sixth wrong question hangs up).
    for (let i = 0; i < 6; i++) s = apply(s, { t: "PHONE", id: "call", index: 1, correct: false });
    expect(s.items["call"].patience).toBe(0);
    expect(s.items["call"].status).toBe("mishandled");
    // PATIENCE_HANGUP_PENALTY 12: 100 -> 88.
    expect(s.csat).toBe(88);
    expect(s.streak).toBe(0);
  });
});

/* ───────────────────────── SLA budget + remaining ───────────────────────── */

describe("scoring: SLA budget and remaining clock", () => {
  it("slaBudget scales by priority and difficulty", () => {
    const plain = makeShift({ id: "gm-sla-budget", items: [] });
    expect(slaBudget(plain, "P2", "normal")).toBe(200);
    expect(slaBudget(plain, "P1", "hard")).toBe(90); // 120 * 0.75
    expect(slaBudget(plain, "P2", "easy")).toBeCloseTo(280, 5); // 200 * 1.4
    const rushed = makeShift({ id: "gm-sla-rush", slaScale: 0.5, items: [] });
    expect(slaBudget(rushed, "P2", "normal")).toBe(100); // 200 * 0.5
  });

  it("slaRemaining counts down from the right anchor", () => {
    // Not landed, no follow-up: counts from arriveAfter.
    expect(slaRemaining({ arriveAfter: 0 }, { landedAt: null }, 0, 200)).toBe(200);
    expect(slaRemaining({ arriveAfter: 30 }, { landedAt: null }, 10, 200)).toBe(220);
    // Landed: counts from landedAt.
    expect(slaRemaining({ arriveAfter: 0 }, { landedAt: 5 }, 30, 200)).toBe(175);
    // A chained follow-up that has not landed counts from the current elapsed.
    expect(slaRemaining({ arriveAfter: 0, revealedBy: { itemId: "x", on: "resolve" } }, { landedAt: null }, 12, 100)).toBe(100);
    // The raw value goes negative past the deadline (callers clamp for display).
    expect(slaRemaining({ arriveAfter: 0 }, { landedAt: 1 }, 50, 6)).toBeLessThan(0);
  });

  it("breaches an unresolved ticket once it passes its SLA budget", () => {
    // The SLA sweep now commits the landedAt stamp on every tick (see the TICK
    // case), so the deadline is real and a breach actually fires. With slaScale
    // 0.05 a P1 budget on normal is 120 * 0.05 * 1.0 = 6 shift-seconds. The item
    // lands on tick 1 (elapsed 1, arriveAfter 0), so its deadline is elapsed 7;
    // by 30 ticks it has breached exactly once. The one-time CSAT hit is
    // BREACH_PENALTY.P1 (10) scaled by DIFF.normal.pen (1.0), so CSAT lands at 90.
    const shift = makeShift({
      id: "gm-sla-sweep",
      slaScale: 0.05, // ~6s budget on a P1, far inside the ticks below
      items: [ticketItem({ id: "p1", subject: "Server down", priority: "P1", reward: 100, xp: 40, actions: [action({ id: "p1-ok", correct: true, csat: 0 })] })],
    });
    const { start, tick } = harness(shift, "normal");
    const after = tick(start, 30);
    expect(after.items["p1"].breached).toBe(true);
    expect(after.items["p1"].landedAt).toBe(1);
    expect(after.csat).toBe(90);
  });
});

/* ───────────────────────── Bridge Pressure meter ───────────────────────── */

describe("engine: Bridge Pressure meter", () => {
  const shift = makeShift({
    id: "gm-bridge",
    items: [
      ticketItem({ id: "inc-root", subject: "Company-wide login outage", priority: "P2", reward: 100, xp: 40, incident: { group: "g", root: true }, actions: [action({ id: "inc-ok", correct: true, csat: 5 })] }),
      // A second open item so resolving the root does not end the shift.
      ticketItem({ id: "other", subject: "New hire setup", reward: 100, xp: 40, actions: [action({ id: "other-ok", correct: true, csat: 0 })] }),
    ],
  });

  it("climbs while an incident root is open and stands down once it is fixed", () => {
    const { start, apply, tick } = harness(shift, "normal");

    // BRIDGE_RISE 1.5 per tick on normal.
    const after5 = tick(start, 5);
    expect(after5.bridgePressure).toBe(7.5);
    expect(after5.bridgeStage).toBe(0);

    // By 24 ticks the meter is at 36, past BRIDGE_STAGE_1 (34), so stage 1 fired.
    const after24 = tick(start, 24);
    expect(after24.bridgePressure).toBe(36);
    expect(after24.bridgeStage).toBe(1);

    // Fix the root, then one more tick: the bridge eases (BRIDGE_EASE 4) and the
    // stage stands down to 0.
    const fixed = apply(after24, { t: "RESOLVE", id: "inc-root", actionId: "inc-ok" });
    expect(fixed.bridgeStage).toBe(1); // unchanged until the next tick
    const stoodDown = tick(fixed, 1);
    expect(stoodDown.bridgePressure).toBe(32); // 36 - 4
    expect(stoodDown.bridgeStage).toBe(0);
  });
});

/* ───────────────────────── pure scoring + payout ladders ───────────────────────── */

describe("scoring: grade ladder and pass score", () => {
  it("pins the pass score and every grade boundary", () => {
    expect(PASS_SCORE).toBe(50);
    expect(gradeFor(100)).toBe("S");
    expect(gradeFor(90)).toBe("S");
    expect(gradeFor(89)).toBe("A");
    expect(gradeFor(80)).toBe("A");
    expect(gradeFor(79)).toBe("B");
    expect(gradeFor(65)).toBe("B");
    expect(gradeFor(64)).toBe("C");
    expect(gradeFor(50)).toBe("C");
    expect(gradeFor(49)).toBe("D");
    expect(gradeFor(0)).toBe("D");
  });
});

describe("engine: payout weighting (preview mirror of the server grant)", () => {
  it("weights by difficulty, clean clear, and best streak, clamped to 1", () => {
    expect(payoutWeight("easy", true, 0)).toBeCloseTo(0.6, 5); // lifeline spent: no clean bonus
    expect(payoutWeight("easy", false, 0)).toBeCloseTo(0.65, 5); // 0.6 + 0.05
    expect(payoutWeight("normal", false, 3)).toBeCloseTo(0.88, 5); // 0.8 + 0.05 + 0.03
    expect(payoutWeight("hard", false, 0)).toBe(1); // 1 + 0.05 clamped to 1
    expect(payoutWeight("hard", false, 100)).toBe(1); // every bonus still clamps to 1
  });

  it("shiftPayout clears the gate, weights the ceiling, and clamps to it", () => {
    // hard + clean would weight above 1, but the clamp keeps it at the ceiling: a
    // perfect hard clear pays exactly round(maxFangs * score/100).
    expect(shiftPayout(360, 80, "hard", false, 0)).toBe(288); // 360 * 0.8 * 1
    expect(shiftPayout(360, 49, "hard", false, 0)).toBe(0); // below PASS_SCORE banks nothing
    expect(shiftPayout(100, 100, "hard", false, 50)).toBe(100); // clamped to the ceiling
    expect(shiftPayout(0, 100, "hard", false, 0)).toBe(0); // no ceiling, no payout
  });
});
