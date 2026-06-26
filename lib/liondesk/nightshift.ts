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
  secondsPerHour: 26,
  core: 5, // advances-to-core that ends the night in a breach
  /** Seconds between threat advances, by hour (gets faster). */
  advanceSeconds: [7, 6.5, 6, 5, 4.5, 4],
  startThreatFeed: "net",
  startActiveFeed: "logs",
};

export function hourLabel(hour: number): string {
  // 0 -> 12 AM, 1 -> 1 AM, ... 6 -> 6 AM
  const display = hour <= 0 ? 12 : hour;
  return `${display} AM`;
}
