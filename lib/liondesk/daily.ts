// "Shift of the Day" — deterministically rotates one shift per calendar day so
// there's a fresh reason to clock in daily (ties into the streak / daily-claim
// loop). Pure function of the date, so it's stable for everyone on a given day
// and needs no API.

import { SHIFTS } from "./shifts";
import type { Shift } from "./types";

/** Stable shift for a given day (defaults to today). */
export function dailyShift(date: Date = new Date()): Shift {
  const key = date.toISOString().slice(0, 10); // YYYY-MM-DD
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return SHIFTS[h % SHIFTS.length];
}
