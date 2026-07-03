// Room code generator for Focus Rooms.
//
// Mirrors the party generator (lib/party/room-code.ts): 4-digit numeric codes
// drawn from the platform CSPRNG, collision-checked at insert time against
// rooms that are still joinable (lobby/running). Sam's 2026-05-27 party call
// applies here too: verbal shareability beats extra entropy at our scale.
// Done/expired rooms free their code back to the pool; snapshot reads order
// by created_at DESC so a recycled code always resolves to the newest room.

import { randomInt } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const CODE_LENGTH = 4;

export function generateFocusRoomCode(): string {
  let out = "";
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += String(randomInt(0, 10));
  }
  return out;
}

/**
 * Returns a 4-digit code not currently used by any lobby/running focus room.
 * Falls back to a fresh CSPRNG draw after 10 attempts (party pattern).
 */
export async function generateUniqueFocusRoomCode(
  supabase: SupabaseClient,
): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = generateFocusRoomCode();
    const { data } = await supabase
      .from("focus_rooms")
      .select("id")
      .eq("code", code)
      .in("status", ["lobby", "running"])
      .maybeSingle();
    if (!data) return code;
  }
  return generateFocusRoomCode();
}

export function isValidFocusRoomCode(input: string): boolean {
  if (typeof input !== "string") return false;
  if (input.length !== CODE_LENGTH) return false;
  return /^[0-9]+$/.test(input);
}

export function normalizeFocusRoomCode(input: string): string {
  return input.replace(/[^0-9]/g, "");
}
