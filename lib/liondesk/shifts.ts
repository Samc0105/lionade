// Registry of every LionDesk shift, grouped by career track. Add a shift here
// and it shows up in that track's campaign automatically.

import type { Shift, ShiftItem } from "./types";
import type { Track } from "@/lib/helpdesk/types";
import { SHIFT_1 } from "./shift1";
import { SHIFT_2 } from "./shift2";
import { SHIFT_3 } from "./shift3";
import { SHIFT_4 } from "./shift4";
import { SHIFT_5 } from "./shift5";
import { SOC_SHIFT_1 } from "./soc-shift1";
import { SWE_SHIFT_1 } from "./swe-shift1";
import { REDTEAM_SHIFT_1 } from "./redteam-shift1";
import { EXTRA_INCIDENT_GROUPS } from "./extra-tickets";
import extraShifts from "./extra-shifts.generated.json";
import ladderShifts from "./extra-shifts-ladder.generated.json";

// Flatten a chained follow-up into a top-level item revealed when its trigger
// resolves (or fails), mirroring the combination engine's chain expansion (which
// is private to generate.ts). The boss shift below is authored from the
// EXTRA_INCIDENT_GROUPS phases, so the phase 1 root's chainOnResolve (the phase 2
// root) becomes a real queued item that only appears once phase 1 is fixed.
function expandIncidentChains(items: ShiftItem[]): ShiftItem[] {
  const out: ShiftItem[] = [];
  for (const it of items) {
    const { chainOnResolve, chainOnFail, ...base } = it;
    out.push(base as ShiftItem);
    if (chainOnResolve) out.push({ ...chainOnResolve, arriveAfter: chainOnResolve.arriveAfter ?? 0, revealedBy: { itemId: it.id, on: "resolve" } });
    if (chainOnFail) out.push({ ...chainOnFail, arriveAfter: chainOnFail.arriveAfter ?? 0, revealedBy: { itemId: it.id, on: "fail" } });
  }
  return out;
}

const incidentGroupItems = (group: string): ShiftItem[] =>
  EXTRA_INCIDENT_GROUPS.find((g) => g.group === group)?.items ?? [];

// MAJOR INCIDENT (boss): a two-phase, company-wide outage. Phase 1 is a single
// sign on outage (an incident root plus its flood of duplicate "I cannot log in"
// tickets). Resolving the phase 1 root does not end it: its chainOnResolve spawns
// the phase 2 root (a reconnect stampede that exhausts the database connection
// pool) plus its own flood, so fixing phase 1 escalates straight into phase 2.
// The Bridge Pressure meter (engine state, surfaced in LionDesk) climbs the whole
// time the org is on the incident bridge. The content lives in
// EXTRA_INCIDENT_GROUPS so the same incident can also be drawn by the Doubles
// modifier; here it is assembled into one climactic shift.
//
// Economy note (HELD): this is preview only, exactly like every campaign shift.
// Its Fang and XP fields are a display preview; the real grant is
// server-authoritative and clamped in app/api/techhub/shifts/complete, gated by
// the held migration 20260626120000. When that migration is applied, add the
// matching server reward ceiling there, mirroring the existing SHIFT_REWARDS
// pattern, e.g. "helpdesk-major-incident": { maxFangs: 360 }. Until then this
// shift banks nothing (the same held state as the rest of the campaign). Never
// grant Fangs from the client.
export const HELPDESK_MAJOR_INCIDENT: Shift = {
  id: "helpdesk-major-incident",
  track: "helpdesk",
  order: 5,
  name: "Major Incident: The SSO Meltdown",
  rank: "Incident Commander",
  accent: "#EF4444",
  durationSeconds: 600,
  startingBudget: 0,
  inventory: [],
  adUsers: [],
  kb: [
    {
      id: "kb-sso-cert",
      title: "Renew an expired SSO signing certificate",
      tags: ["sso", "identity", "certificate", "outage"],
      body: [
        "Symptom: every login fails at the same moment with a signature or assertion error, while the network, database, and app servers are all healthy. A company wide lockout that starts on one timestamp points at a single shared dependency, not at user accounts.",
        "Cause: the identity provider signs each login assertion with a certificate. When that certificate expires, every assertion is rejected as invalid, so everyone is locked out at once. It is not passwords and not the back end.",
        "Fix: renew (rotate) the SSO signing certificate and reload it on the identity provider. Logins recover immediately. Then add monitoring and a reminder well before the next expiry so this never surprises you again.",
      ],
    },
    {
      id: "kb-conn-stampede",
      title: "Survive a login stampede (connection pool exhaustion)",
      tags: ["database", "scaling", "incident", "stampede"],
      body: [
        "Symptom: right after an outage is fixed, everything times out because every client that was down reconnects in the same instant. This thundering herd saturates the database connection pool, so new connections are refused even though CPU looks fine.",
        "The trap: restarting the database drops all sessions and the herd simply stampedes it again the moment it returns. Adding more app servers opens even more connections and makes the exhaustion worse.",
        "Fix: stagger the reconnects so the herd drains in waves (add a little random jitter to client retry timing) and raise the connection pool ceiling so there is headroom while it drains. Recovery should ease load back on, not slam it.",
      ],
    },
  ],
  items: expandIncidentChains([
    ...incidentGroupItems("mi-sso-outage"),
    ...incidentGroupItems("mi-db-stampede"),
  ]),
};

// Authored campaign shifts + the workflow-authored second shifts (SOC/SWE/Red
// Team) + the shift 3-5 ladder that fills out every track's Intern->senior climb.
// All auto-register from their generated JSON files.
const AUTHORED: Shift[] = [SHIFT_1, SHIFT_2, SHIFT_3, SHIFT_4, SHIFT_5, SOC_SHIFT_1, SWE_SHIFT_1, REDTEAM_SHIFT_1, HELPDESK_MAJOR_INCIDENT];
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
