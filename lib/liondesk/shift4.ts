import type { Shift } from "./types";

// Shift 4: Network Administrator. You own the plumbing now: DNS, DHCP, firewall,
// VLANs, and physical links. The failures are subtler and the blast radius is
// bigger. Terminal-heavy, and every wrong fix is a real network-admin foot-gun
// (open all ports, flatten the VLANs, hand out public DNS as a "fix").

export const SHIFT_4: Shift = {
  id: "helpdesk-shift-4",
  track: "helpdesk",
  order: 3,
  name: "Shift 4: Plumbing and Wiring",
  rank: "Network Administrator",
  accent: "#4A90D9",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-dns",
      title: "Internal DNS is down",
      tags: ["dns", "resolver", "name resolution"],
      body: [
        "If internal names stop resolving but the network is otherwise up, suspect the internal resolver, not every client.",
        "Restart or fail over to the secondary resolver. Pointing clients at public DNS like 8.8.8.8 is a band-aid that still can't resolve your internal names.",
      ],
    },
    {
      id: "kb-dhcp",
      title: "DHCP scope exhaustion",
      tags: ["dhcp", "lease", "ip", "scope"],
      body: [
        "When new devices can't get an address but the server is up, the scope (pool) is likely full, often from short-lived devices holding long leases.",
        "Free it by clearing stale leases and either expanding the scope or shortening the lease time. Static-assigning everyone does not scale and reboots don't free leases.",
      ],
    },
    {
      id: "kb-firewall",
      title: "A service is unreachable through the firewall",
      tags: ["firewall", "port", "least privilege"],
      body: [
        "A newly deployed service that refuses connections often just lacks an allow rule. Add the one specific rule it needs.",
        "Never disable the firewall or open all ports to make something work; that exposes everything. Least privilege: open exactly the port from exactly the source that needs it.",
      ],
    },
    {
      id: "kb-link",
      title: "An intermittent (flapping) link",
      tags: ["link", "flapping", "sfp", "crc"],
      body: [
        "Intermittent drops with rising CRC errors on one interface point at a failing transceiver or cable, not the whole switch.",
        "Replace the failing SFP or cable on that uplink. Rebooting the switch hides it briefly, then the flapping returns.",
      ],
    },
  ],

  items: [
    {
      id: "net-dns",
      channel: "ticket",
      priority: "P1",
      from: { name: "Monitoring", role: "alert" },
      subject: "Nothing resolves: internal DNS is down",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 50,
      xp: 40,
      ticketBody: "Half the company says apps and shares 'can't be found'. The network is up but names won't resolve.",
      evidence: [
        { label: "Resolver check", lines: ["dig intranet.lionade.local -> SERVFAIL", "primary resolver ns1: service NOT running (crashed 09:12)", "secondary ns2: healthy", "raw IPs still reachable, so it's DNS not the link"] },
      ],
      commands: [
        { aliases: ["dig", "nslookup", "resolve"], output: "Internal name lookups SERVFAIL. Pinging raw IPs works. The primary resolver ns1 crashed; ns2 is healthy. It's DNS, not connectivity.", step: "diag" },
      ],
      kbArticleId: "kb-dns",
      goal: "Get name resolution back for the company.",
      hint: "Raw IPs work, names don't, and one of your two resolvers is dead. What does that point at?",
      actions: [
        { id: "restart-resolver", label: "Restart the primary resolver (and fail traffic to the healthy secondary meanwhile)", correct: true, requires: ["diag"], csat: 16, teach: "Right. The resolver service crashed; restarting it (with the secondary carrying load in the meantime) restores resolution. Internal DNS is a single point of pain, so you'd also alert on the service so a crash pages you next time." },
        { id: "public-dns", label: "Point everyone at public DNS (8.8.8.8)", correct: false, csat: -8, teach: "Public DNS can't resolve your internal names, so intranet and shares still fail. It's a band-aid that doesn't even cover the wound. Fix the internal resolver." },
        { id: "reboot-clients", label: "Tell everyone to reboot their machines", correct: false, csat: -6, teach: "The clients are fine; your resolver is down. Rebooting hundreds of machines won't fix a server-side DNS outage." },
      ],
    },
    {
      id: "net-dhcp",
      channel: "ticket",
      priority: "P2",
      from: { name: "Front desk", role: "Reception" },
      subject: "New laptops can't get on the network",
      slaMinutes: 25,
      arriveAfter: 35,
      reward: 44,
      xp: 35,
      ticketBody: "We're onboarding a batch of new hires and none of their laptops can get an IP. Existing machines are fine.",
      evidence: [
        { label: "DHCP scope, floor 2", lines: ["scope 10.2.0.0/24: 254/254 leases USED (100%)", "~80 stale leases from guest phones, lease time 8 days", "existing devices keep their lease; new ones get nothing"] },
      ],
      commands: [
        { aliases: ["dhcp", "leases", "scope"], output: "Floor-2 DHCP scope is 100% leased. About 80 are stale guest-device leases on an 8-day lease time. New devices can't get an address.", step: "diag" },
      ],
      kbArticleId: "kb-dhcp",
      goal: "Get the new hires online.",
      hint: "Existing devices are fine, new ones get nothing, and the pool is full of stale leases. What frees up addresses?",
      actions: [
        { id: "free-scope", label: "Clear stale leases and shorten the lease time (or widen the scope)", correct: true, requires: ["diag"], csat: 14, teach: "Exactly. The pool was exhausted by stale long leases. Reclaiming them and shortening the lease time frees addresses immediately and keeps it from refilling. Widening the scope is the longer-term fix." },
        { id: "static-all", label: "Statically assign an IP to every new laptop", correct: false, csat: -6, teach: "Static-assigning everyone is unmanageable and just papers over an exhausted scope. Fix the pool, don't hand-config the company." },
        { id: "reboot-dhcp", label: "Reboot the DHCP server", correct: false, csat: -5, teach: "Leases survive a reboot, so the scope is still full afterward. You took the service down for nothing." },
      ],
    },
    {
      id: "net-firewall",
      channel: "ticket",
      priority: "P2",
      from: { name: "Dev team", role: "Engineering" },
      subject: "Our new service is unreachable",
      slaMinutes: 30,
      arriveAfter: 70,
      reward: 42,
      xp: 34,
      ticketBody: "We deployed a new internal API on port 8443 and nothing can reach it. The app is running fine on the host.",
      evidence: [
        { label: "Path check", lines: ["app listening on 8443 (healthy on the host)", "connections from clients: REFUSED at the firewall", "firewall has no allow rule for 8443", "every other port behaves normally"] },
      ],
      commands: [
        { aliases: ["trace", "telnet", "check port"], output: "The app is up and listening on 8443, but the firewall drops inbound 8443 (no allow rule). Other ports are fine. It's a missing firewall rule.", step: "diag" },
      ],
      kbArticleId: "kb-firewall",
      goal: "Make the new service reachable, safely.",
      hint: "The app is healthy; the firewall just has no rule for its port. What's the minimal change?",
      actions: [
        { id: "add-rule", label: "Add a single allow rule for 8443 from the intended source", correct: true, requires: ["diag"], csat: 13, teach: "Clean. One precise allow rule opens exactly what's needed and nothing else. That's least privilege: the service works and the rest of the firewall stays tight." },
        { id: "disable-fw", label: "Disable the firewall to unblock it", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "Turning off the firewall to expose one service exposes everything. That's how a single internal API becomes a company-wide breach. Add the one rule." },
        { id: "open-all", label: "Open all ports on the host", correct: false, csat: -8, teach: "Opening every port to fix one is the same mistake with extra steps. Open exactly 8443 from exactly the source that needs it." },
      ],
    },
    {
      id: "net-flap",
      channel: "ticket",
      priority: "P3",
      from: { name: "Monitoring", role: "alert" },
      subject: "Intermittent drops on the 3rd-floor uplink",
      slaMinutes: 40,
      arriveAfter: 120,
      reward: 38,
      xp: 30,
      ticketBody: "Users on one switch report Wi-Fi and wired sessions hiccupping every few minutes. Not constant, just flapping.",
      evidence: [
        { label: "Interface counters, sw-3f Gi1/0/24", lines: ["link flapped 41 times in the last hour", "CRC errors climbing steadily", "neighbor switch counters clean", "swapping the SFP on a spare port is clean"] },
      ],
      commands: [
        { aliases: ["interface", "counters", "show int"], output: "sw-3f Gi1/0/24: 41 link flaps/hour and rising CRC errors. The far end is clean. Signature of a failing transceiver or cable on this uplink.", step: "diag" },
      ],
      kbArticleId: "kb-link",
      goal: "Stop the flapping for good.",
      hint: "Rising CRC errors and constant flaps on one interface, with a clean neighbor. It's physical.",
      actions: [
        { id: "replace-sfp", label: "Replace the failing SFP and cable on that uplink", correct: true, requires: ["diag"], csat: 12, teach: "Right call. Flaps plus climbing CRC errors on a single interface are a dying transceiver or cable. Swap the physical part and the link goes solid. Software can't fix a bad photon path." },
        { id: "reboot-switch", label: "Reboot the whole switch", correct: false, csat: -6, teach: "A reboot quiets it for a few minutes, then the failing optic flaps again, and you took the whole switch offline meanwhile. Replace the part." },
        { id: "ignore-flap", label: "Ignore it, it's only intermittent", correct: false, csat: -5, teach: "Intermittent today is a hard-down tomorrow, usually at the worst time. A flapping uplink with rising errors is a part on its way out. Replace it now." },
      ],
    },
  ],
};
