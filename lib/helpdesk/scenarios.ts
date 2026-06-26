// TechHub scenarios = the two hand-built helpdesk starters + the authored set
// in scenarios.generated.json (designed and adversarially verified offline,
// then merged here). All deterministic, zero API cost. Re-exports the types so
// existing imports from "@/lib/helpdesk/scenarios" keep working.

import type { SimScenario, Track } from "./types";
import generated from "./scenarios.generated.json";

export * from "./types";

// ── Hand-built starters (the original two helpdesk tickets, cleaned + tagged) ──
const STARTERS: SimScenario[] = [
  {
    id: "printer-queue-jam",
    track: "helpdesk",
    rank: "Help Desk Intern",
    rankLevel: 0,
    difficulty: "Entry",
    reward: 40,
    xp: 30,
    ticket: {
      from: "Dana, Accounting",
      subject: "Can't print the month-end report",
      priority: "High",
      body:
        "I've hit print like 20 times and nothing comes out. Now there's a pile of nothing in the queue. This is due at 5pm. Help!",
    },
    evidence: [
      {
        label: "Print Spooler, last events",
        lines: [
          "10:42  Job 7  'AcctReport.pdf'  STATUS: ERROR_PRINTER_OFFLINE",
          "10:44  Job 8  'AcctReport.pdf'  STATUS: QUEUED (waiting on Job 7)",
          "10:45  Job 9  'AcctReport.pdf'  STATUS: QUEUED (waiting on Job 7)",
          "10:51  Job 10 'AcctReport.pdf'  STATUS: QUEUED (waiting on Job 7)",
          "10:58  Job 11 'AcctReport.pdf'  STATUS: QUEUED (waiting on Job 7)",
        ],
      },
      { label: "Printer HP-ACCT-2", lines: ["Status: Ready", "Connection: Online", "Toner: 64%"] },
    ],
    goal: "Get Dana's report printing. Find why the queue is stuck and clear the blocker.",
    hint:
      "The printer shows Ready and pings fine, so it isn't hardware or network. Look at what's at the front of the print queue.",
    successMessage:
      "Nailed it. Job 7 hit ERROR_PRINTER_OFFLINE and jammed everything queued behind it. Clearing it released the rest. Reinstalling drivers or swapping cables would have burned 20 minutes. The help-desk instinct is simple: read the log, rule out hardware and network, then fix the actual blocker.",
    commands: [
      {
        aliases: ["printer status", "status", "stat"],
        output:
          "HP-ACCT-2: ONLINE, Ready. Spooler: RUNNING. Print queue: 5 jobs.\nJob 7 is STUCK (ERROR_PRINTER_OFFLINE) and is blocking jobs 8-11.",
      },
      {
        aliases: ["view log spooler", "tail spooler", "logs", "log", "cat spooler.log"],
        output: "Job 7  ERROR_PRINTER_OFFLINE  <-- stuck, head of queue\nJob 8..11  QUEUED, waiting on Job 7",
      },
      {
        aliases: ["ping hp-acct-2", "ping printer", "ping"],
        output: "Reply from HP-ACCT-2: time<1ms (4/4 packets). The printer is reachable on the network.",
      },
      {
        aliases: ["clear queue", "purge queue", "cancel job 7", "clear job 7", "flush queue"],
        output: "Cleared the stuck job. Jobs 8-11 released. Dana's report is printing now.",
        resolvesTicket: true,
        tone: "success",
      },
      {
        aliases: ["restart spooler", "restart service", "net stop spooler"],
        output:
          "Spooler restarted. Job 7 is STILL at the head of the queue. Restarting the service didn't clear the jammed job itself.",
        tone: "warn",
      },
      {
        aliases: ["reinstall driver", "update driver", "reinstall drivers"],
        output: "Driver reinstalled, still stuck. The driver was fine; the log shows a jammed queue, not a driver fault.",
        tone: "warn",
      },
      {
        aliases: ["replace cable", "check cable", "swap cable"],
        output: "The cable is fine. ping already showed the printer ONLINE. This is a software queue jam, not a physical link.",
        tone: "warn",
      },
      {
        aliases: ["restart printer", "reboot printer", "power cycle"],
        output: "Power-cycled the printer. The stuck spooler job survives the reboot. You need to clear the queue, not the printer.",
        tone: "warn",
      },
    ],
  },
  {
    id: "wifi-confroom-drops",
    track: "helpdesk",
    rank: "Tier 1 Support",
    rankLevel: 1,
    difficulty: "Intermediate",
    reward: 60,
    xp: 45,
    ticket: {
      from: "Marcus, Sales",
      subject: "Wi-Fi keeps dropping in Conf Room B",
      priority: "Medium",
      body:
        "Every meeting in Conf Room B my laptop drops Wi-Fi for ~30 seconds then reconnects. Only that room, my desk is fine. It's killing my client calls.",
    },
    evidence: [
      {
        label: "Client Wi-Fi log (Marcus-MBP)",
        lines: [
          "Disassociated from AP-FLOOR2-B  (reason: 4WAY-HANDSHAKE-TIMEOUT)",
          "Roamed to AP-FLOOR2-A ... reassociated",
          "Disassociated from AP-FLOOR2-B  (reason: 4WAY-HANDSHAKE-TIMEOUT)  x6 today",
        ],
      },
      {
        label: "AP-FLOOR2-B",
        lines: ["Channel: 6", "Connected clients: 38", "Signal at Conf B table: -78 dBm (weak)"],
      },
    ],
    goal: "Stop Marcus's Wi-Fi from dropping in Conf Room B.",
    hint:
      "It's one room and every client there is affected, not just Marcus. So it's the access point or its channel, not his laptop. Check what else is crowding its channel.",
    successMessage:
      "Right read. A weak signal plus 38 clients jammed onto a congested channel 6 equals handshake timeouts and drops. Moving to a clear channel fixes it. Rebooting the AP or blaming Marcus's laptop are the rookie moves; the log pointed at the wireless link, not the LAN.",
    commands: [
      {
        aliases: ["wifi status", "status", "ap status"],
        output: "Conf Room B served by AP-FLOOR2-B. Signal at the table: -78 dBm (weak). 38 clients. Channel 6.",
      },
      {
        aliases: ["view log", "logs", "log", "tail wifi"],
        output: "Marcus-MBP: repeated 'Disassociated from AP-FLOOR2-B (4WAY-HANDSHAKE-TIMEOUT)', then roams to AP-FLOOR2-A.",
      },
      {
        aliases: ["ping gateway", "ping", "ping gw"],
        output: "Reply, time<2ms. When he's connected the wired network is fine. The drops are the wireless link, not the LAN.",
      },
      {
        aliases: ["scan channels", "survey", "channel scan", "scan"],
        output: "Channel 6: 41 networks (heavily congested). Channel 1: 22. Channel 11: 6 networks (clear).",
      },
      {
        aliases: ["set channel 11", "move ap to channel 11", "change channel 11", "channel 11"],
        output: "Moved AP-FLOOR2-B to channel 11. Handshakes stop timing out. Marcus stays connected through his next meeting.",
        resolvesTicket: true,
        tone: "success",
      },
      {
        aliases: ["reboot ap", "restart ap", "power cycle ap"],
        output: "Rebooted the AP. Helps for a few minutes, but it comes back up on congested channel 6 and the drops return.",
        tone: "warn",
      },
      {
        aliases: ["replace wifi card", "replace laptop", "swap card", "reimage laptop"],
        output: "Marcus's card is fine. Every client in Conf B drops, not just him. It's the AP and channel, not one laptop.",
        tone: "warn",
      },
    ],
  },
];

const GENERATED = generated as unknown as SimScenario[];

export const SCENARIOS: SimScenario[] = [...STARTERS, ...GENERATED];

/** Scenarios for one track, ordered by rank (intern first). */
export function scenariosForTrack(track: Track): SimScenario[] {
  return SCENARIOS.filter((s) => s.track === track).sort((a, b) => a.rankLevel - b.rankLevel);
}

export function getScenario(id: string): SimScenario | undefined {
  return SCENARIOS.find((s) => s.id === id);
}
