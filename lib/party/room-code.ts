// Room code generator for Lionade Party.
//
// 4-digit numeric codes (e.g. "4729"), trading some unguessability for
// share-ability. 10,000 codes total — fine at low DAU with collision
// checking at insert time; tighten if active rooms ever cross ~500.
//
// Previously 6-char alphanumeric (30^6 ≈ 729M). Sam dropped to 4-digit
// numeric on 2026-05-27 because verbal sharing matters more than the
// extra entropy at our scale.

import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const CODE_LENGTH = 4;

// Room codes must be unguessable per the auto-security review — use the
// platform CSPRNG (Node's OpenSSL), not Math.random.
export function generateRoomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += String(randomInt(0, 10));
  }
  return out;
}

/**
 * Returns a 4-digit code that's not currently in use by any non-ended room.
 * Falls back to fresh CSPRNG-driven digits after 10 attempts (we try more
 * times than the old 6-char generator because 10,000 codes is a smaller
 * pool — collisions are likelier). Never uses Date.now()-derived digits.
 */
export async function generateUniqueRoomCode(
  supabase: SupabaseClient,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateRoomCode();
    const { data } = await supabase
      .from("party_rooms")
      .select("id")
      .eq("code", code)
      .neq("status", "ended")
      .maybeSingle();
    if (!data) return code;
  }
  // Defensive fallback: regenerate with fresh CSPRNG draws.
  return generateRoomCode();
}

export function isValidRoomCode(input: string): boolean {
  if (typeof input !== "string") return false;
  if (input.length !== CODE_LENGTH) return false;
  return /^[0-9]+$/.test(input);
}

export function normalizeRoomCode(input: string): string {
  return input.replace(/[^0-9]/g, "");
}
