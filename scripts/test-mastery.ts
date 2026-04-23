#!/usr/bin/env npx tsx
// Sanity check the BKT math. Run: npx tsx scripts/test-mastery.ts
// Kept as a script rather than a full test framework since we don't use one.

import {
  updateBKT, pPass, displayPct, pickNextSubtopic,
  isPassReady, isMasteryReached, pickDifficulty,
} from "../lib/mastery";

let passed = 0, failed = 0;
function assert(name: string, cond: boolean, details = "") {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else { failed++; console.log(`  ✗ ${name} ${details}`); }
}

console.log("\nupdateBKT — correct answers should push mastery up");
{
  let p = 0.10;
  for (let i = 0; i < 10; i++) p = updateBKT(p, true, "medium");
  assert("10× correct medium → ≥ 0.80", p >= 0.80, `got ${p.toFixed(3)}`);
  assert("10× correct medium → ≤ 0.98", p <= 0.98, `got ${p.toFixed(3)}`);
}

console.log("\nupdateBKT — wrong answers should drag mastery down");
{
  let p = 0.50;
  for (let i = 0; i < 10; i++) p = updateBKT(p, false, "hard");
  assert("10× wrong hard → ≤ 0.15", p <= 0.15, `got ${p.toFixed(3)}`);
}

console.log("\npPass — weighted aggregate");
{
  const topics = [
    { weight: 0.5, pMastery: 0.80 },
    { weight: 0.5, pMastery: 0.60 },
  ];
  const pass = pPass(topics);
  assert("equal weights, 0.80/0.60 → 0.70", Math.abs(pass - 0.70) < 0.001, `got ${pass}`);
}

console.log("\ndisplayPct — volume floor dampens early bars");
{
  const fresh = displayPct(0.80, 2);
  const seasoned = displayPct(0.80, 40);
  assert("early bar < seasoned bar", fresh < seasoned, `fresh=${fresh.toFixed(1)} seasoned=${seasoned.toFixed(1)}`);
  assert("fresh bar ≤ 50%", fresh <= 50, `got ${fresh.toFixed(1)}`);
}

console.log("\npickNextSubtopic — largest weighted gap wins");
{
  const next = pickNextSubtopic([
    { subtopicId: "a", weight: 0.05, pMastery: 0.10 },  // big gap, tiny weight → 0.0375
    { subtopicId: "b", weight: 0.6,  pMastery: 0.70 },  // small gap, big weight → 0.09
    { subtopicId: "c", weight: 0.35, pMastery: 0.85 },  // no gap
  ]);
  assert("picks b (largest weighted gap)", next === "b", `got ${next}`);
}

console.log("\nisPassReady — 0.80 threshold with floor gate");
{
  const ready = isPassReady([
    { weight: 0.5, pMastery: 0.90 },
    { weight: 0.5, pMastery: 0.75 },
  ]);
  assert("mixed high mastery passes gate", ready === true);

  const notReady = isPassReady([
    { weight: 0.5, pMastery: 0.99 },
    { weight: 0.5, pMastery: 0.55 },
  ]);
  assert("one subtopic below floor fails gate", notReady === false);
}

console.log("\nisMasteryReached — all-or-nothing");
{
  const partial = isMasteryReached([
    { weight: 0.5, pMastery: 0.95 },
    { weight: 0.5, pMastery: 0.90 },
  ]);
  assert("one subtopic below 0.95 fails", partial === false);

  const full = isMasteryReached([
    { weight: 0.5, pMastery: 0.96 },
    { weight: 0.5, pMastery: 0.95 },
  ]);
  assert("all ≥ 0.95 succeeds", full === true);
}

console.log("\npickDifficulty — cert-exam calibration: never easy");
assert("0.05 → medium (no easy tier)", pickDifficulty(0.05) === "medium");
assert("0.60 → medium", pickDifficulty(0.60) === "medium");
assert("0.70 → hard", pickDifficulty(0.70) === "hard");
assert("0.90 → hard", pickDifficulty(0.90) === "hard");

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
