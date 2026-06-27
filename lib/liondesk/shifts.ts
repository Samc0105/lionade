// Registry of every LionDesk shift, grouped by career track. Add a shift here
// and it shows up in that track's campaign automatically.

import type { Shift } from "./types";
import type { Track } from "@/lib/helpdesk/types";
import { SHIFT_1 } from "./shift1";
import { SHIFT_2 } from "./shift2";
import { SHIFT_3 } from "./shift3";
import { SHIFT_4 } from "./shift4";
import { SHIFT_5 } from "./shift5";
import { SOC_SHIFT_1 } from "./soc-shift1";
import { SWE_SHIFT_1 } from "./swe-shift1";
import { REDTEAM_SHIFT_1 } from "./redteam-shift1";
import extraShifts from "./extra-shifts.generated.json";
import ladderShifts from "./extra-shifts-ladder.generated.json";

// Authored campaign shifts + the workflow-authored second shifts (SOC/SWE/Red
// Team) + the shift 3-5 ladder that fills out every track's Intern->senior climb.
// All auto-register from their generated JSON files.
const AUTHORED: Shift[] = [SHIFT_1, SHIFT_2, SHIFT_3, SHIFT_4, SHIFT_5, SOC_SHIFT_1, SWE_SHIFT_1, REDTEAM_SHIFT_1];
export const SHIFTS: Shift[] = [
  ...AUTHORED,
  ...(extraShifts as unknown as Shift[]),
  ...(ladderShifts as unknown as Shift[]),
];

export function shiftsForTrack(track: Track): Shift[] {
  return SHIFTS.filter((s) => s.track === track).sort((a, b) => a.order - b.order);
}

export function getShift(id: string): Shift | undefined {
  return SHIFTS.find((s) => s.id === id);
}
