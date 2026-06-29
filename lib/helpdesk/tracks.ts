// TechHub career tracks + their full rank ladders (Intern -> top).
//
// Rank titles here MUST match the `rank` strings used on the scenarios in
// scenarios.ts so a ticket's rank label and its rung on the ladder agree.
// Only the first few rungs of each ladder have live tickets today; the rest
// are shown as the road ahead (the career timeline the player is climbing).

import type { Track, TrackDef } from "./types";

function ladder(titles: string[]) {
  return titles.map((title, level) => ({ level, title }));
}

export const TRACKS: TrackDef[] = [
  {
    id: "helpdesk",
    name: "IT Support",
    tagline: "Keep the office running",
    blurb:
      "The front line of every company. Triage tickets, rule out the obvious, and fix what is actually broken before the 5pm deadline.",
    color: "#4A90D9",
    icon: "Headset",
    ranks: ladder([
      "Help Desk Intern",
      "Tier 1 Support",
      "Tier 2 Support",
      "Sysadmin",
      "Network Admin",
      "IT Manager",
      "Director of IT",
      "CTO",
    ]),
  },
  {
    id: "soc",
    name: "Cybersecurity",
    tagline: "Defend the network",
    blurb:
      "Sit in the SOC and read the logs. Spot the attack hiding in the noise, contain it the right way, and learn why each move matters.",
    color: "#2BBE6B",
    icon: "ShieldCheck",
    ranks: ladder([
      "SOC Intern",
      "SOC Analyst I",
      "SOC Analyst II",
      "Incident Responder",
      "Threat Hunter",
      "Security Engineer",
      "SOC Manager",
      "CISO",
    ]),
  },
  {
    id: "swe",
    name: "Software Engineering",
    tagline: "Ship it and keep it up",
    blurb:
      "Read the stack trace, find the bug, fix the root cause. From your first 500 error to rolling back a bad deploy under fire.",
    color: "#FFD700",
    icon: "Code",
    ranks: ladder([
      "SWE Intern",
      "Junior Engineer",
      "Software Engineer",
      "Senior Engineer",
      "Staff Engineer",
      "Principal Engineer",
      "Engineering Manager",
      "VP Engineering",
      "CTO",
    ]),
  },
  {
    id: "redteam",
    name: "Ethical Hacking",
    tagline: "Break in to lock it down",
    blurb:
      "Authorized engagements only. Find the hole a real attacker would, document it, and hand over the fix. Offense that makes the defense stronger.",
    color: "#EF4444",
    icon: "Bug",
    ranks: ladder([
      "Pentest Intern",
      "Junior Pentester",
      "Pentester",
      "Senior Pentester",
      "Red Team Lead",
      "OffSec Manager",
      "Director of OffSec",
      "CISO",
    ]),
  },
  {
    id: "netops",
    name: "Cloud & Network Ops",
    tagline: "Keep the pipes open",
    blurb:
      "Run the network and the cloud behind it. Size subnets, chase down a DNS failure, let a load balancer fail over on its own, lock roles to least privilege, and triage the 2am page that is only a warning.",
    color: "#22D3EE",
    icon: "Cloud",
    ranks: ladder([
      "Cloud Ops Intern",
      "Junior Network Engineer",
      "Cloud Operations Engineer",
      "Site Reliability Engineer",
      "Senior SRE",
      "Network Architect",
      "Infrastructure Lead",
      "VP Infrastructure",
    ]),
  },
];

export const TRACK_IDS: Track[] = TRACKS.map((t) => t.id);

export function getTrack(id: string): TrackDef | undefined {
  return TRACKS.find((t) => t.id === id);
}
