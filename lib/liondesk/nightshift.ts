// Night Shift — the FNAF-style monitoring mode. You're alone on the graveyard
// shift watching a wall of feeds. An intruder moves through your systems and
// only shows up on the ONE feed it's currently on. Flip feeds to find it, then
// contain it on the right feed before it advances to the core. Survive to 6 AM.
//
// Deterministic config + authored copy (zero API). The real-time movement uses
// Math.random in the browser, which is fine here (this is not a workflow).

export type FeedKind = "logs" | "cam" | "net" | "siem" | "edr";

export interface Feed {
  id: string;
  label: string;
  short: string;
  kind: FeedKind;
  /** Lines shown when the feed is clear. */
  normal: string[];
  /** Lines shown when the intruder is on THIS feed. */
  threat: string[];
  /** Headline shown when the intruder is here. */
  threatHeadline: string;
  /** The correct containment action for this feed. */
  containLabel: string;
  /** One-line lesson shown on a successful contain. */
  teach: string;
}

export const FEEDS: Feed[] = [
  {
    id: "logs",
    label: "Auth Log Tail",
    short: "LOGS",
    kind: "logs",
    normal: ["GET /healthz 200", "cron nightly-backup OK", "session refresh ok", "GET /metrics 200"],
    threat: ["AUTH FAIL svc-admin x38", "AUTH FAIL svc-admin", "SUCCESS svc-admin from 203.0.113.66", "lateral: psexec -> FILESRV-2"],
    threatHeadline: "Brute force succeeded, lateral movement starting",
    containLabel: "Block the source IP + disable svc-admin",
    teach: "Failed-then-success from a foreign IP is a takeover. Block the source AND kill the compromised account.",
  },
  {
    id: "cam",
    label: "Server Room Cam",
    short: "CAM-1",
    kind: "cam",
    normal: ["racks nominal", "temp 21C", "no motion", "door: LOCKED"],
    threat: ["MOTION DETECTED 02:14", "cabinet B door OPEN", "unknown USB inserted", "no badge swipe on record"],
    threatHeadline: "Physical intrusion in the server room",
    containLabel: "Lock the room + disable the rogue USB port",
    teach: "Physical access beats most controls. Lock it down and kill the unauthorized USB before it drops a payload.",
  },
  {
    id: "net",
    label: "Network Map",
    short: "NET",
    kind: "net",
    normal: ["east-west traffic nominal", "no new flows", "egress within baseline"],
    threat: ["FILESRV-2 -> 10.0.9.0/24 sweep", "new flow to unknown host", "port-scan pattern internal"],
    threatHeadline: "Anomalous east-west scanning",
    containLabel: "Isolate the affected segment",
    teach: "Internal scanning is an attacker mapping their next hop. Isolate the segment to stop the spread.",
  },
  {
    id: "siem",
    label: "SIEM Board",
    short: "SIEM",
    kind: "siem",
    normal: ["0 critical alerts", "42 events triaged", "all rules healthy"],
    threat: ["CRITICAL: large outbound transfer", "180GB -> unknown host / 6 min", "DLP: customer records matched"],
    threatHeadline: "Data exfiltration in progress",
    containLabel: "Sever the exfil channel + preserve",
    teach: "A big outbound transfer of sensitive data is exfiltration. Cut the channel to stop the bleeding, preserve for IR.",
  },
  {
    id: "edr",
    label: "Endpoint Monitor",
    short: "EDR",
    kind: "edr",
    normal: ["processes nominal", "no new persistence", "EDR agents healthy"],
    threat: ["svch0st.exe spawned (temp path)", "beacon every 60s", "C2: cdn-sync-update.live", "scheduled task added"],
    threatHeadline: "C2 beacon + persistence on an endpoint",
    containLabel: "Isolate the host + kill the process",
    teach: "A masquerading process beaconing out is C2. Isolate the host (keep it powered) and quarantine, don't reimage yet.",
  },
];

export const NIGHT = {
  hours: 6, // 12 AM -> 6 AM
  core: 5, // advances-to-core that ends the night in a breach
  startActiveFeed: "logs",
};

export interface NightDef {
  n: number;
  name: string;
  secondsPerHour: number;
  /** Seconds between a threat's advances, by hour (gets faster). */
  advanceSeconds: number[];
  /** How many intruders are loose at once. */
  threats: number;
  /** Whether the power/attention resource is active this night. */
  power: boolean;
  powerDrainPerSec: number;
  flipCost: number;
  /** A feed periodically drops to static; the intruder can hide in the dark. */
  outages?: boolean;
  outageEverySec?: number;
  outageDurSec?: number;
  /** "Phone guy" briefing, shown before the night. */
  intro?: string;
}

export const NIGHTS: NightDef[] = [
  {
    n: 1, name: "Night 1", secondsPerHour: 26, advanceSeconds: [7, 6.5, 6, 5.5, 5, 4.5],
    threats: 1, power: false, powerDrainPerSec: 0, flipCost: 0,
    intro:
      "Uh, hello? Hello? Welcome to your first night on the desk. So the deal is simple: something is already inside, and it moves around. It only shows up on the feed it is sitting on, so keep flipping the feeds. The second you spot it, hit CONTAIN, fast. Don't let it reach the core five times. You'll be fine. Probably. See you at six.",
  },
  {
    n: 2, name: "Night 2", secondsPerHour: 25, advanceSeconds: [6.5, 6, 5.5, 5, 4.5, 4],
    threats: 1, power: true, powerDrainPerSec: 0.3, flipCost: 1,
    intro:
      "Hey, good, you made it. Tonight the monitors run off the backup power, and it drains while you watch. Flipping feeds costs a little too, so don't just mash through them. If the power hits zero the feeds go dark and you're blind. Pace yourself.",
  },
  {
    n: 3, name: "Night 3", secondsPerHour: 24, advanceSeconds: [6, 5.5, 5, 4.5, 4, 3.5],
    threats: 2, power: true, powerDrainPerSec: 0.35, flipCost: 1,
    intro: "So, uh, there are two of them now. Two intruders, moving independently. Watch the depth meter, contain whichever one you can find, and keep that power up. You've got this.",
  },
  {
    n: 4, name: "Night 4", secondsPerHour: 24, advanceSeconds: [5.5, 5, 4.5, 4, 3.5, 3],
    threats: 2, power: true, powerDrainPerSec: 0.45, flipCost: 1.2,
    outages: true, outageEverySec: 22, outageDurSec: 4,
  },
  {
    n: 5, name: "Night 5", secondsPerHour: 23, advanceSeconds: [5, 4.5, 4, 3.5, 3, 2.5],
    threats: 2, power: true, powerDrainPerSec: 0.5, flipCost: 1.5,
    outages: true, outageEverySec: 18, outageDurSec: 5,
  },
  {
    n: 6, name: "Night 6", secondsPerHour: 23, advanceSeconds: [4.5, 4, 3.5, 3, 2.5, 2],
    threats: 2, power: true, powerDrainPerSec: 0.5, flipCost: 1.5,
    outages: true, outageEverySec: 16, outageDurSec: 5,
  },
];

/** Build an ad-hoc night from the player's chosen difficulty (Custom Night). */
export function makeCustomNight(threats: number, speed: "slow" | "normal" | "fast" | "insane"): NightDef {
  const speeds: Record<string, number[]> = {
    slow: [7, 6.5, 6, 5.5, 5, 4.5],
    normal: [6, 5.5, 5, 4.5, 4, 3.5],
    fast: [5, 4.5, 4, 3.5, 3, 2.5],
    insane: [4, 3.5, 3, 2.5, 2, 1.8],
  };
  return {
    n: 0,
    name: "Custom Night",
    secondsPerHour: 24,
    advanceSeconds: speeds[speed],
    threats: Math.max(1, Math.min(3, threats)),
    power: true,
    powerDrainPerSec: 0.45,
    flipCost: 1.2,
    outages: speed === "fast" || speed === "insane",
    outageEverySec: 18,
    outageDurSec: 5,
  };
}

// ── Progression (local) ──
const NIGHT_KEY = "lionade.techhub.nightshift.v1";

export function getMaxNightSurvived(): number {
  if (typeof window === "undefined") return 0;
  try {
    return parseInt(window.localStorage.getItem(NIGHT_KEY) || "0", 10) || 0;
  } catch {
    return 0;
  }
}

export function recordNightSurvived(n: number): void {
  if (typeof window === "undefined") return;
  try {
    if (n > getMaxNightSurvived()) window.localStorage.setItem(NIGHT_KEY, String(n));
  } catch {
    /* ignore */
  }
}

export function hourLabel(hour: number): string {
  // 0 -> 12 AM, 1 -> 1 AM, ... 6 -> 6 AM
  const display = hour <= 0 ? 12 : hour;
  return `${display} AM`;
}
