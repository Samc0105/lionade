import type { Shift } from "./types";

// Shift 2: Tier 1 Support. Harder, with the signature mechanic of a real desk:
// an INCIDENT STORM. A floor-wide Wi-Fi outage spawns a flood of duplicate
// tickets. The lesson is to spot the pattern and fix the ROOT once, which
// mass-resolves the duplicates, instead of troubleshooting each laptop. Plus a
// security escalation (a stolen laptop) and the usual mix.

export const SHIFT_2: Shift = {
  id: "helpdesk-shift-2",
  track: "helpdesk",
  order: 1,
  name: "Shift 2: The Floor Goes Dark",
  rank: "Tier 1 Support",
  accent: "#4A90D9",
  durationSeconds: 600,
  startingBudget: 3000,

  inventory: [
    { sku: "hdmi", name: "HDMI cable 2m", stock: 6, vendor: "Amazon Biz", unitCost: 9 },
    { sku: "dock", name: "USB-C dock station", stock: 0, vendor: "CDW", unitCost: 189 },
    { sku: "chg-usbc", name: "USB-C 65W charger", stock: 3, vendor: "CDW", unitCost: 39 },
    { sku: "ram-16", name: "16GB DDR5 SODIMM", stock: 4, vendor: "Newegg", unitCost: 58 },
  ],

  adUsers: [],

  kb: [
    {
      id: "kb-poe-trip",
      title: "A floor lost Wi-Fi: check the switch and PoE",
      tags: ["wifi", "outage", "switch", "poe", "network"],
      body: [
        "When every AP on one floor drops at once, it is almost never the access points. They share an upstream: the floor switch and its Power over Ethernet.",
        "A power surge or a fault can err-disable a switch port, killing PoE to the APs hanging off it. The APs show no power because the port cut them off.",
        "Fix: re-enable the err-disabled switch port to restore PoE. Rebooting one AP does nothing when the whole port is down.",
      ],
    },
    {
      id: "kb-mapped-drive",
      title: "Reconnect a disconnected mapped drive",
      tags: ["drive", "mapped", "network", "share"],
      body: [
        "A mapped drive showing a red X usually means the persistent mapping did not reconnect at login, not that the file server is down.",
        "Reconnect the mapping (net use, or reconnect from File Explorer) and tick 'reconnect at sign-in'. Confirm the share path is still reachable first.",
      ],
    },
    {
      id: "kb-lost-device",
      title: "Report a lost or stolen device",
      tags: ["security", "stolen", "lost", "device", "escalation"],
      body: [
        "A lost or stolen laptop is a security event, not a password ticket. Company data may be on it.",
        "Escalate to Security immediately so they can remote-lock and wipe the device per policy, then disable the account sessions. Resetting the password alone leaves the data on the device exposed.",
      ],
    },
    {
      id: "kb-invoice-phish",
      title: "Spot invoice and attachment phishing",
      tags: ["phishing", "invoice", "attachment", "security"],
      body: [
        "Invoice lures push you to open an attachment or click to 'view'. Check the real sender domain and whether you even have a relationship with the vendor.",
        "Do not open the attachment. Report it so the SOC can quarantine it for everyone.",
      ],
    },
  ],

  items: [
    // ── INCIDENT STORM: floor-3 Wi-Fi outage (1 root + 3 duplicates) ──
    {
      id: "wifi-floor3-root",
      channel: "ticket",
      priority: "P1",
      from: { name: "Facilities", role: "Building Ops" },
      subject: "Whole 3rd floor reports no Wi-Fi",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 60,
      xp: 45,
      incident: { group: "wifi-floor3", root: true },
      ticketBody:
        "We're getting flooded: nobody on the 3rd floor has Wi-Fi. Started about 5 minutes ago. Other floors are fine.",
      evidence: [
        {
          label: "Wireless controller, 3rd floor",
          lines: [
            "AP-FLOOR3-01   DOWN  (no power)",
            "AP-FLOOR3-02   DOWN  (no power)",
            "AP-FLOOR3-03   DOWN  (no power)",
            "uplink switch  SW-3F  port Gi1/0/12  status: err-disabled (PoE fault)",
          ],
        },
      ],
      commands: [
        { aliases: ["status", "controller status"], output: "All 3 floor-3 APs DOWN, no power. Upstream SW-3F port Gi1/0/12 is err-disabled (PoE fault). Other floors normal.", step: "diag" },
        { aliases: ["show poe", "poe", "switch"], output: "SW-3F Gi1/0/12: err-disabled, PoE cut. This port feeds all three floor-3 APs.", step: "diag" },
        { aliases: ["ping ap", "ping"], output: "AP-FLOOR3-01: 100% packet loss. No power, so nothing to ping." },
      ],
      kbArticleId: "kb-poe-trip",
      goal: "The whole floor is down. Find the single cause and fix it once.",
      hint: "Every AP on the floor dropped at the same instant. They don't fail together by chance. What do they share upstream?",
      actions: [
        {
          id: "reenable-port",
          label: "Re-enable the err-disabled switch port to restore PoE",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That's the incident. A PoE fault err-disabled the switch port feeding all three APs, so the whole floor dropped at once. Re-enabling the port restored power and Wi-Fi, and every duplicate ticket closed itself. One root cause, one fix.",
        },
        { id: "reboot-one-ap", label: "Reboot AP-FLOOR3-01", csat: -5, teach: "It has no power to reboot. You're treating a symptom on one device while the whole floor's switch port is down." },
        { id: "tell-forget", label: "Tell everyone to forget and rejoin the network", csat: -6, teach: "There's nothing for them to join. The APs are unpowered. You just sent a floor of people on a wild goose chase." },
      ],
    },
    {
      id: "wifi-dup-1",
      channel: "ticket",
      priority: "P2",
      from: { name: "Alex Rivera", role: "Sales" },
      subject: "My Wi-Fi won't connect",
      slaMinutes: 20,
      arriveAfter: 10,
      reward: 8,
      xp: 6,
      incident: { group: "wifi-floor3" },
      ticketBody: "I'm on the 3rd floor and my laptop says no networks found. Worked an hour ago.",
      goal: "Handle this user. Notice anything familiar about it?",
      hint: "You just saw another 3rd-floor Wi-Fi ticket. And another. Is this one laptop's problem?",
      actions: [
        { id: "ack-incident", label: "Link it to the known 3rd-floor incident and reassure them", correct: true, csat: 2, teach: "Good instinct. This is the same floor-wide outage. Acknowledge it, point at the incident, and the real fix is at the root, not this laptop.", outcome: "resolved" },
        { id: "troubleshoot-laptop", label: "Walk them through resetting their laptop's Wi-Fi adapter", csat: -3, teach: "Their adapter is fine. This is the third identical ticket from that floor. Spot the pattern instead of debugging one machine." },
      ],
    },
    {
      id: "wifi-dup-2",
      channel: "ticket",
      priority: "P3",
      from: { name: "Priya Nadar", role: "Marketing" },
      subject: "internet is down",
      slaMinutes: 25,
      arriveAfter: 18,
      reward: 8,
      xp: 6,
      incident: { group: "wifi-floor3" },
      ticketBody: "3rd floor, my internet just stopped. Is something going on?",
      goal: "Another one. Same handling.",
      hint: "Same floor, same minute, same symptom.",
      actions: [
        { id: "ack-incident-2", label: "Link it to the 3rd-floor incident and reassure them", correct: true, csat: 2, teach: "Right. Tie it to the incident. Fixing the root will clear all of these at once.", outcome: "resolved" },
        { id: "reset-router-2", label: "Reboot the office router", csat: -7, teach: "You'd knock the whole company offline for a single-floor issue that isn't even the router. Diagnose before you act." },
      ],
    },
    {
      id: "wifi-dup-3",
      channel: "ticket",
      priority: "P3",
      from: { name: "Sam Okafor", role: "Design" },
      subject: "no wifi on 3rd floor either",
      slaMinutes: 25,
      arriveAfter: 26,
      reward: 8,
      xp: 6,
      incident: { group: "wifi-floor3" },
      ticketBody: "Adding to the pile, 3rd floor design pod has no Wi-Fi.",
      goal: "You know this one by now.",
      hint: "If you fix the root cause, you won't have to touch this ticket at all.",
      actions: [
        { id: "ack-incident-3", label: "Link it to the 3rd-floor incident", correct: true, csat: 2, teach: "Yep. Go fix the switch port and this closes on its own.", outcome: "resolved" },
        { id: "new-ap-3", label: "Order and install a new access point for the pod", csat: -6, teach: "An AP isn't broken and you can't install one mid-shift. This is a powered-off switch port, not missing hardware." },
      ],
    },

    // ── standalone tickets ──
    {
      id: "stolen-laptop",
      channel: "ticket",
      priority: "P1",
      from: { name: "Jordan Lee", role: "Field Sales" },
      subject: "I think my laptop was stolen at the airport",
      slaMinutes: 10,
      arriveAfter: 60,
      reward: 55,
      xp: 45,
      ticketBody:
        "I set my work laptop down at the gate and when I turned around it was gone. I've looked everywhere. It has all my client files on it. What do I do?",
      kbArticleId: "kb-lost-device",
      goal: "A company laptop is missing. This is bigger than a password.",
      hint: "There's company data on that device. Is your job to reset a password, or to get the right team to lock it down?",
      actions: [
        {
          id: "escalate-security",
          label: "Escalate to Security to remote-lock and wipe the device, then kill the sessions",
          correct: true,
          csat: 16,
          outcome: "escalated",
          teach:
            "Exactly right. A lost device is a security event. Security can remote-lock and wipe it and disable the account's sessions per policy. That protects the client data on the device, which a password reset alone would not.",
        },
        { id: "just-reset-pw", label: "Reset their password and issue a new laptop", csat: -8, teach: "The data is still sitting on the stolen device. A new password doesn't wipe what's already on the disk. Escalate to Security first." },
        { id: "wait-found", label: "Tell them to check lost and found and report back tomorrow", csat: -12, ends: true, outcome: "mishandled", teach: "Every hour that device is out there with client data is a breach risk. You sat on a security incident. This should have been escalated immediately." },
      ],
    },
    {
      id: "invoice-phish",
      channel: "email",
      priority: "P2",
      from: { name: "Accounts Payable", role: "billing@acc0unts-payable.net" },
      subject: "Overdue invoice #44192 - open to avoid late fees",
      slaMinutes: 30,
      arriveAfter: 40,
      reward: 40,
      xp: 32,
      email: {
        isPhish: true,
        body:
          "Your account has an overdue invoice of $4,820. Open the attached statement to review and pay before late fees apply. INVOICE_44192.html\n\nAccounts Payable",
      },
      evidence: [
        { label: "Email headers", lines: ["From: Accounts Payable <billing@acc0unts-payable.net>", "SPF: FAIL   DKIM: none", "Attachment: INVOICE_44192.html  (HTML, not PDF)", "We have no vendor at this domain."] },
      ],
      kbArticleId: "kb-invoice-phish",
      goal: "Decide what this is and handle it.",
      hint: "An HTML 'invoice' from a lookalike domain you have no relationship with. Check the sender and the attachment type.",
      actions: [
        { id: "report-invoice-phish", label: "Report it as phishing", correct: true, csat: 12, outcome: "reported", teach: "Caught it. Lookalike domain (acc0unts), SPF fail, and an HTML attachment posing as an invoice. Reporting it lets the SOC pull it from every inbox." },
        { id: "open-attachment", label: "Open the attachment to see what's owed", csat: -16, ends: true, outcome: "mishandled", teach: "The HTML attachment is the payload. Opening it is how this gets you. Never open an unexpected attachment from a lookalike sender." },
        { id: "forward-finance", label: "Forward it to Finance to handle the bill", csat: -4, teach: "You just spread the phish to Finance. It isn't a real bill, it's an attack. Report it, don't route it." },
      ],
    },
    {
      id: "mapped-drive",
      channel: "ticket",
      priority: "P3",
      from: { name: "Dana Lopez", role: "Accounting" },
      subject: "My S: drive vanished",
      slaMinutes: 45,
      arriveAfter: 95,
      reward: 34,
      xp: 26,
      ticketBody: "The S: drive I use for everything has a red X and won't open. The file server is up for everyone else though.",
      kbArticleId: "kb-mapped-drive",
      goal: "Get Dana's drive back. Look it up if you're unsure.",
      hint: "Others can reach the server, so it's her mapping, not the share. Search the KB for mapped drives.",
      actions: [
        { id: "reconnect-drive", label: "Reconnect the mapped drive and set it to reconnect at sign-in", correct: true, requires: ["kb"], csat: 11, teach: "That's it. The persistent mapping didn't reconnect at login. Re-mapping it and ticking 'reconnect at sign-in' fixes it for good. The server was never the problem." },
        { id: "reimage-drive", label: "Reimage her machine", csat: -6, teach: "Wildly overkill for a dropped drive mapping. You'd wipe her whole setup over a one-line fix. The KB had it." },
        { id: "reboot-drive", label: "Tell her to reboot", csat: -3, teach: "A reboot might re-trigger the mapping by luck, but it won't stick. Reconnect it properly so it survives the next login." },
      ],
    },
  ],
};
