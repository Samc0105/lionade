// Seed 30 Trainer Ninny ghosts for Arena V2 cold-start.
//
// Layout: 5 subjects × 3 ELO bands × 2 ghosts/cell = 30 ghosts.
//   subjects: algebra, biology, chemistry, physics, earth-science
//             (earth-science silently skipped today — content pool < 10
//             questions; the rest of the 24 still seed.)
//   ELO bands: 1100, 1400, 1700
//   accuracy by band: 1100 → 60%, 1400 → 75%, 1700 → 90%  (Phase 3 tune)
//
// Phase 3 retune (2026-05-26): accuracy dropped from 75/85/95 → 60/75/90.
// Net effect: new players win MORE often in their first 3 trainer matches
// → trainer cohort flips from a slight ELO-deflation source to a slight
// inflation source at launch, which makes the cold-start feel competent
// rather than humbling. data-economist signed off — pure rating change,
// no Fang economy interaction (trainer matches transfer zero Fangs).
//
// Each ghost gets 10 question_ids drawn from the existing `questions` table
// at the matching subject. We do NOT filter by difficulty in V1 — the
// question difficulty mix is what defines a band's challenge; the ghost's
// accuracy + timing model defines its strength.
//
// Idempotency:
//   - Default behavior: skip inserts for any (subject, elo, slot) cell
//     where a trainer ghost already exists with the same first question_id.
//     This keeps re-runs safe but ALSO means a re-run after an accuracy
//     tune-down will NOT update existing rows. To actually refresh
//     accuracy/timing, pass --reseed (see CLI flag below).
//   - With --reseed: DELETEs all trainer-Ninny-owned ghosts before
//     inserting fresh ones, so the new accuracy bands take effect.
//
// Usage:
//   set -a && source .env.local && set +a && npx tsx scripts/seed-trainer-ninny-ghosts.ts
//   set -a && source .env.local && set +a && npx tsx scripts/seed-trainer-ninny-ghosts.ts --reseed

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SECRET_KEY;
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
  process.exit(1);
}

const RESEED = process.argv.includes("--reseed");

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const TRAINER_NINNY_USER_ID = "00000000-0000-0000-0000-00000000a155";

const SUBJECTS = ["algebra", "biology", "chemistry", "physics", "earth-science"];
// Phase 3 tune (2026-05-26): 75/85/95 → 60/75/90 to make new-player cold-start friendlier.
const BANDS: Array<{ elo: number; accuracy: number; baseTimeMs: number; variance: number }> = [
  { elo: 1100, accuracy: 0.60, baseTimeMs: 8500, variance: 3500 },
  { elo: 1400, accuracy: 0.75, baseTimeMs: 6000, variance: 2500 },
  { elo: 1700, accuracy: 0.90, baseTimeMs: 4000, variance: 1500 },
];
const GHOSTS_PER_CELL = 2;

// Deterministic RNG so re-runs produce the same ghost timing/answers.
function mulberry32(seed: number) {
  let s = seed;
  return function () {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFor(subject: string, elo: number, slot: number) {
  let h = 0;
  const s = `${subject}|${elo}|${slot}`;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

interface QuestionRow {
  id: string;
  correct_answer: string;
  options: string[];
}

async function loadQuestions(subject: string): Promise<QuestionRow[]> {
  // V2 user-facing "subject" choices (algebra/biology/etc.) map to the
  // questions.topic column. questions.subject is the higher-level
  // category (Math/Science).
  const { data, error } = await supabase
    .from("questions")
    .select("id, correct_answer, options")
    .eq("topic", subject)
    .limit(200);
  if (error) throw error;
  return data ?? [];
}

async function seedSubject(subject: string) {
  const pool = await loadQuestions(subject);
  if (pool.length < 10) {
    console.warn(`  [skip] ${subject}: only ${pool.length} questions in pool, need 10+`);
    return;
  }

  for (const band of BANDS) {
    for (let slot = 0; slot < GHOSTS_PER_CELL; slot++) {
      const rng = mulberry32(seedFor(subject, band.elo, slot));

      // Pick 10 questions deterministically.
      const indices: number[] = [];
      const used = new Set<number>();
      while (indices.length < 10) {
        const idx = Math.floor(rng() * pool.length);
        if (!used.has(idx)) { used.add(idx); indices.push(idx); }
      }
      const questions = indices.map((i) => pool[i]);
      const question_ids = questions.map((q) => q.id);

      // Generate answers + timing.
      const answers = questions.map((q) => {
        const correct = rng() < band.accuracy;
        const correctIdx = q.options.findIndex((o) => o === q.correct_answer);
        let selected_index: number;
        if (correct) {
          selected_index = correctIdx >= 0 ? correctIdx : 0;
        } else {
          // Pick a non-correct index.
          const candidates = q.options.map((_, i) => i).filter((i) => i !== correctIdx);
          selected_index = candidates[Math.floor(rng() * candidates.length)];
        }
        const time_ms = Math.round(
          band.baseTimeMs + (rng() - 0.5) * 2 * band.variance,
        );
        return {
          question_id: q.id,
          selected_index,
          time_ms: Math.max(800, time_ms),
          correct,
        };
      });

      const total_score = answers.reduce((sum, a) => sum + (a.correct ? 100 : 0), 0);

      // Idempotency: skip if a trainer ghost for this subject/band/slot
      // already exists. We don't have a natural key, so use a fingerprint
      // on question_ids + elo + subject.
      const fingerprint = `${subject}|${band.elo}|${slot}`;
      const { data: existing } = await supabase
        .from("duel_ghosts")
        .select("id")
        .eq("subject", subject)
        .eq("elo_at_recording", band.elo)
        .eq("is_trainer", true)
        .eq("owner_user_id", TRAINER_NINNY_USER_ID)
        .contains("question_ids", [question_ids[0]])
        .limit(1);

      if (existing && existing.length > 0) {
        console.log(`  [skip-existing] ${fingerprint}`);
        continue;
      }

      const { error: insErr } = await supabase.from("duel_ghosts").insert({
        owner_user_id: TRAINER_NINNY_USER_ID,
        subject,
        elo_at_recording: band.elo,
        question_ids,
        answers,
        total_score,
        is_trainer: true,
      });
      if (insErr) {
        console.error(`  [error] ${fingerprint}:`, insErr.message);
        continue;
      }
      console.log(`  [seeded] ${fingerprint} → 10qs, ${total_score}pts`);
    }
  }
}

async function main() {
  console.log(`Seeding Trainer Ninny ghosts (Arena V2)${RESEED ? " — RESEED mode" : ""}...`);

  if (RESEED) {
    // Clear all trainer ghosts before re-inserting so the new accuracy
    // bands actually take effect. Scoped to TRAINER_NINNY_USER_ID + is_trainer
    // so we never touch real-player ghosts.
    const { data: existing, error: countErr } = await supabase
      .from("duel_ghosts")
      .select("id", { count: "exact" })
      .eq("owner_user_id", TRAINER_NINNY_USER_ID)
      .eq("is_trainer", true);
    if (countErr) {
      console.error("[reseed] count failed:", countErr.message);
      process.exit(1);
    }
    console.log(`[reseed] deleting ${existing?.length ?? 0} existing trainer ghosts...`);
    const { error: delErr } = await supabase
      .from("duel_ghosts")
      .delete()
      .eq("owner_user_id", TRAINER_NINNY_USER_ID)
      .eq("is_trainer", true);
    if (delErr) {
      console.error("[reseed] delete failed:", delErr.message);
      process.exit(1);
    }
    console.log("[reseed] cleared.");
  }

  for (const subject of SUBJECTS) {
    console.log(`subject: ${subject}`);
    await seedSubject(subject);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
