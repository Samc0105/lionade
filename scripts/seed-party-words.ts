// Seed party_word_lists from lib/party/word-lists.ts.
//
// Idempotent: uses an upsert keyed on (subject, word) so re-runs replace
// difficulty/factoid for existing rows without duplicating. Pass --reseed to
// DELETE the entire table contents first (use after curator updates words).
//
// Usage:
//   set -a && source .env.local && set +a && npx tsx scripts/seed-party-words.ts
//   set -a && source .env.local && set +a && npx tsx scripts/seed-party-words.ts --reseed

import { createClient } from "@supabase/supabase-js";
import { WORD_LISTS } from "@/lib/party/word-lists";

const RESEED = process.argv.includes("--reseed");

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY");
    process.exit(1);
  }
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (RESEED) {
    console.log("--reseed: wiping party_word_lists...");
    const { error: delErr } = await supabase.from("party_word_lists").delete().not("id", "is", null);
    if (delErr) {
      console.error("delete failed:", delErr.message);
      process.exit(1);
    }
  }

  const rows: { subject: string; word: string; difficulty: string; factoid: string }[] = [];
  for (const subject of Object.keys(WORD_LISTS) as (keyof typeof WORD_LISTS)[]) {
    for (const entry of WORD_LISTS[subject]) {
      rows.push({
        subject,
        word: entry.word,
        difficulty: entry.difficulty,
        factoid: entry.factoid,
      });
    }
  }
  console.log(`Upserting ${rows.length} word rows across ${Object.keys(WORD_LISTS).length} subjects...`);

  // Chunk inserts to avoid request-size limits (50 per chunk).
  const CHUNK = 100;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("party_word_lists")
      .upsert(chunk, { onConflict: "subject,word" });
    if (error) {
      console.error("upsert failed at chunk", i, ":", error.message);
      process.exit(1);
    }
  }

  const { count } = await supabase
    .from("party_word_lists")
    .select("id", { count: "exact", head: true });
  console.log(`Done. party_word_lists row count = ${count ?? "unknown"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
