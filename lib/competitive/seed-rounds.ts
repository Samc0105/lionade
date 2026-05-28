// Competitive platform — per-mode round seeding.
//
// Called once at match creation (from the queue route) to populate the
// mode-specific round/hand tables so the screen has authoritative content the
// moment both players load in. Both players see the SAME rounds (fairness).
//
// Server-only (writes via the service-role client).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CompetitiveMode } from "./types";
import { getSabotageQuestions } from "./sabotage-questions";
import { pickZoomImages } from "./zoom-images";
import { pickSpectrumEntries } from "./spectrum-data";
import { pickPinPlaces } from "./pin-places";
import { getCountryPlaces } from "./rest-countries";
import { drawRandomCard } from "./pokerface-cards";

const SABOTAGE_ROUNDS = 8;
const ZOOM_ROUNDS = 6;
const SPECTRUM_ROUNDS = 10;
const PIN_ROUNDS = 10;
const POKERFACE_HANDS = 6;

export async function seedRoundsForMatch(
  supabase: SupabaseClient,
  matchId: string,
  mode: CompetitiveMode,
): Promise<void> {
  switch (mode) {
    case "sabotage":
      return seedSabotage(supabase, matchId);
    case "zoom":
      return seedZoom(supabase, matchId);
    case "spectrum":
      return seedSpectrum(supabase, matchId);
    case "pin":
      return seedPin(supabase, matchId);
    case "pokerface":
      return seedPokerFace(supabase, matchId);
  }
}

async function seedSabotage(supabase: SupabaseClient, matchId: string) {
  const qs = await getSabotageQuestions(SABOTAGE_ROUNDS);
  const rows = qs.map((q, i) => ({
    match_id: matchId,
    round_num: i,
    question: q.question,
    options: q.options,
    correct_index: q.correctIndex,
    category: q.category,
  }));
  if (rows.length) await supabase.from("sabotage_rounds").insert(rows);
}

async function seedZoom(supabase: SupabaseClient, matchId: string) {
  const imgs = pickZoomImages(ZOOM_ROUNDS);
  const rows = imgs.map((img, i) => ({
    match_id: matchId,
    round_num: i,
    image_url: img.url,
    answer: img.answer,
    aliases: img.aliases,
    reveal_sec: 15,
  }));
  if (rows.length) await supabase.from("zoom_rounds").insert(rows);
}

async function seedSpectrum(supabase: SupabaseClient, matchId: string) {
  const entries = pickSpectrumEntries(SPECTRUM_ROUNDS);
  const rows = entries.map((e, i) => ({
    match_id: matchId,
    round_num: i,
    prompt: e.prompt,
    true_value: e.trueValue,
    min_value: e.min,
    max_value: e.max,
    unit: e.unit,
  }));
  if (rows.length) await supabase.from("spectrum_rounds").insert(rows);
}

async function seedPin(supabase: SupabaseClient, matchId: string) {
  // Merge curated landmarks/cities with REST Countries centroids for variety.
  const curated = pickPinPlaces(PIN_ROUNDS);
  let pool = curated;
  try {
    const countries = await getCountryPlaces();
    if (countries.length > 0) {
      const merged = [...curated, ...countries].sort(() => Math.random() - 0.5);
      pool = merged.slice(0, PIN_ROUNDS);
    }
  } catch {
    // curated-only fallback
  }
  const rows = pool.map((p, i) => ({
    match_id: matchId,
    round_num: i,
    prompt: p.prompt,
    true_lat: p.lat,
    true_lng: p.lng,
  }));
  if (rows.length) await supabase.from("pin_rounds").insert(rows);
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function seedPokerFace(_supabase: SupabaseClient, _matchId: string) {
  // Poker Face hands carry non-null presenter_id/caller_id foreign keys, which
  // depend on the live match teams + hand parity (presenter alternates). We
  // therefore DEFER hand creation to the Poker Face present endpoint
  // (app/api/competitive/pokerface/present/route.ts), which knows the real
  // teams and draws the card at present time. Seeding nothing here avoids FK
  // violations on placeholder ids. Intentional no-op.
  void POKERFACE_HANDS;
  void drawRandomCard;
}
