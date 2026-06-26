// Help Desk Sim — authored scenario content (zero API cost; all deterministic).
//
// Each scenario is a realistic IT support ticket. The player investigates with
// a fake terminal (each command returns scripted output drawn from the
// evidence) and resolves the ticket by running the CORRECT fix. Wrong fixes
// return teaching feedback instead of "solving" it. The whole thing is data —
// add a scenario object to grow the queue, no engine changes.

export type Tone = "info" | "warn" | "success";

export interface SimCommand {
  /** Lowercased inputs that trigger this command (matched exact OR by prefix). */
  aliases: string[];
  /** What the terminal prints back. */
  output: string;
  /** Marks the correct fix — running it resolves the ticket. */
  resolvesTicket?: boolean;
  /** Output colour: info (default), warn (a plausible-but-wrong fix), success. */
  tone?: Tone;
}

export interface SimScenario {
  id: string;
  difficulty: "Entry" | "Intermediate" | "Advanced";
  reward: number; // Fangs on resolve
  ticket: {
    from: string;
    subject: string;
    priority: "Low" | "Medium" | "High";
    body: string;
  };
  /** The "evidence" panel — logs, statuses, errors the player reads. */
  evidence: { label: string; lines: string[] }[];
  /** One-line statement of what "fixed" means. */
  goal: string;
  /** Revealed by the `hint` command. */
  hint: string;
  /** Shown when the ticket is resolved — the "why" so the player learns. */
  successMessage: string;
  commands: SimCommand[];
}

export const SCENARIOS: SimScenario[] = [
  {
    id: "printer-queue-jam",
    difficulty: "Entry",
    reward: 40,
    ticket: {
      from: "Dana — Accounting",
      subject: "Can't print the month-end report",
      priority: "High",
      body:
        "I've hit print like 20 times and NOTHING comes out. Now there's a pile of nothing in the queue. This is due at 5pm. Help!",
    },
    evidence: [
      {
        label: "Print Spooler — last events",
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
      "The printer shows Ready and pings fine, so it isn't hardware or network. Look at what's at the FRONT of the print queue.",
    successMessage:
      "Nailed it. Job 7 hit ERROR_PRINTER_OFFLINE and jammed everything queued behind it. Clearing it released the rest. Reinstalling drivers or swapping cables would've burned 20 minutes — the help-desk instinct is: read the log, rule out hardware + network, then fix the actual blocker.",
    commands: [
      {
        aliases: ["printer status", "status", "stat"],
        output:
          "HP-ACCT-2: ONLINE, Ready. Spooler: RUNNING. Print queue: 5 jobs.\nJob 7 is STUCK (ERROR_PRINTER_OFFLINE) and is blocking jobs 8-11.",
      },
      {
        aliases: ["view log spooler", "tail spooler", "logs", "log", "cat spooler.log"],
        output:
          "Job 7  ERROR_PRINTER_OFFLINE  <-- stuck, head of queue\nJob 8..11  QUEUED, waiting on Job 7",
      },
      {
        aliases: ["ping hp-acct-2", "ping printer", "ping"],
        output: "Reply from HP-ACCT-2: time<1ms (4/4 packets). The printer is reachable on the network.",
      },
      {
        aliases: ["clear queue", "purge queue", "cancel job 7", "clear job 7", "flush queue"],
        output:
          "Cleared the stuck job. Jobs 8-11 released — Dana's report is printing now.",
        resolvesTicket: true,
        tone: "success",
      },
      {
        aliases: ["restart spooler", "restart service", "net stop spooler"],
        output:
          "Spooler restarted... Job 7 is STILL at the head of the queue. Restarting the service didn't clear the jammed job itself.",
        tone: "warn",
      },
      {
        aliases: ["reinstall driver", "update driver", "reinstall drivers"],
        output:
          "Driver reinstalled — still stuck. The driver was fine; the log shows a jammed QUEUE, not a driver fault.",
        tone: "warn",
      },
      {
        aliases: ["replace cable", "check cable", "swap cable"],
        output:
          "The cable's fine — `ping` already showed the printer ONLINE. This is a software queue jam, not a physical link.",
        tone: "warn",
      },
      {
        aliases: ["restart printer", "reboot printer", "power cycle"],
        output:
          "Power-cycled the printer. The stuck spooler job survives the reboot — you need to clear the QUEUE, not the printer.",
        tone: "warn",
      },
    ],
  },
  {
    id: "wifi-confroom-drops",
    difficulty: "Intermediate",
    reward: 55,
    ticket: {
      from: "Marcus — Sales",
      subject: "Wi-Fi keeps dropping in Conf Room B",
      priority: "Medium",
      body:
        "Every meeting in Conf Room B my laptop drops Wi-Fi for ~30 seconds then reconnects. Only that room — my desk is fine. It's killing my client calls.",
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
      "It's ONE room and EVERY client there is affected, not just Marcus. So it's the access point / its channel, not his laptop. Check what else is crowding its channel.",
    successMessage:
      "Right read. A weak signal plus 38 clients jammed onto a congested channel 6 = handshake timeouts and drops. Moving to a clear channel fixes it. Rebooting the AP or blaming Marcus's laptop are the rookie moves — the log pointed at the wireless link, not the LAN.",
    commands: [
      {
        aliases: ["wifi status", "status", "ap status"],
        output:
          "Conf Room B served by AP-FLOOR2-B. Signal at the table: -78 dBm (weak). 38 clients. Channel 6.",
      },
      {
        aliases: ["view log", "logs", "log", "tail wifi"],
        output:
          "Marcus-MBP: repeated 'Disassociated from AP-FLOOR2-B (4WAY-HANDSHAKE-TIMEOUT)', then roams to AP-FLOOR2-A.",
      },
      {
        aliases: ["ping gateway", "ping", "ping gw"],
        output:
          "Reply, time<2ms — when he's connected the wired network is fine. The drops are the WIRELESS link, not the LAN.",
      },
      {
        aliases: ["scan channels", "survey", "channel scan", "scan"],
        output:
          "Channel 6: 41 networks (heavily congested). Channel 1: 22. Channel 11: 6 networks (clear).",
      },
      {
        aliases: ["set channel 11", "move ap to channel 11", "change channel 11", "channel 11"],
        output:
          "Moved AP-FLOOR2-B to channel 11. Handshakes stop timing out — Marcus stays connected through his next meeting.",
        resolvesTicket: true,
        tone: "success",
      },
      {
        aliases: ["reboot ap", "restart ap", "power cycle ap"],
        output:
          "Rebooted the AP — helps for a few minutes, but it comes back up on congested channel 6 and the drops return.",
        tone: "warn",
      },
      {
        aliases: ["replace wifi card", "replace laptop", "swap card", "reimage laptop"],
        output:
          "Marcus's card is fine — EVERY client in Conf B drops, not just him. It's the AP/channel, not one laptop.",
        tone: "warn",
      },
    ],
  },
];
