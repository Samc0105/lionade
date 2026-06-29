import type { Shift } from "./types";

// SOC Shift 2: The Long Night. A harder graveyard rotation for a SOC Analyst II.
// Shift 1 taught triage and single host containment; this one adds the moves that
// separate an analyst from a button pusher: tuning a noisy rule without going
// blind, scoping lateral movement before you contain, running a credential
// harvesting phishing campaign to ground, and pulling apart a slow data leak that
// hides inside ordinary DNS traffic. Defensive and fictional throughout. The
// lessons are always: confirm the cause, contain without destroying evidence, fix
// once at the source, and escalate by the book.
//
// Economy note (HELD): every reward and xp value below is a DISPLAY PREVIEW only,
// exactly like the rest of the campaign. The real grant is server authoritative
// and clamped in app/api/techhub/shifts/complete, where this shift's ceiling lives
// as "soc-shift-2": { maxFangs: 300 }. Until the held migration 20260626120000 is
// applied this shift banks nothing, the same held state as every other shift.
// Never grant Fangs from the client.

export const SOC_SHIFT_2: Shift = {
  id: "soc-shift-2",
  track: "soc",
  order: 1,
  name: "SOC Shift 2: The Long Night",
  rank: "SOC Analyst II",
  accent: "#2BBE6B",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-soc2-alert-tuning",
      title: "Tune a noisy detection without going blind",
      tags: ["detection", "tuning", "false positive", "soc"],
      body: [
        "A rule that fires hundreds of times an hour is worse than no rule, because the flood trains analysts to ignore it and the real hit drowns in the noise.",
        "Find the one benign source behind most of the firings and write a tight suppression for exactly that source and destination, then leave the rule live for everything else. Never disable a detection or bulk close its alerts just to make the noise stop. That is how, the day a real attacker uses the same path, nobody is watching.",
      ],
    },
    {
      id: "kb-soc2-lateral",
      title: "Scope and contain lateral movement",
      tags: ["lateral movement", "containment", "edr", "incident"],
      body: [
        "When an attacker dumps credentials and uses them to reach a second host, you are watching hands on lateral movement. The job is to stop the spread while keeping the evidence intact.",
        "Scope it first: find every host the stolen account actually touched. Isolate exactly those through EDR so they stay powered for memory and log forensics, then escalate to incident response. Do not reimage (it destroys the evidence) and do not blanket block the trusted tool they abused across the whole fleet (it breaks legitimate administration and tips the attacker).",
      ],
    },
    {
      id: "kb-soc2-phish-campaign",
      title: "Respond to a credential harvesting campaign",
      tags: ["phishing", "credentials", "campaign", "containment"],
      body: [
        "A phishing campaign that harvests passwords is a race. Some recipients will have submitted their credentials before anyone reports it, and those credentials are valid until you act.",
        "Quarantine the message from every mailbox at once, block the harvesting domain so new clicks fail, and then reset the credentials and revoke the sessions of everyone who submitted. Pulling the mail without resetting the harvested accounts leaves the attacker holding live keys. A staff warning is a useful extra, never the fix.",
      ],
    },
    {
      id: "kb-soc2-dns-exfil",
      title: "Catch and cut data exfiltration over DNS",
      tags: ["dns", "exfiltration", "tunneling", "c2"],
      body: [
        "Data can leave a network hidden inside ordinary DNS lookups. A host sending a steady stream of long, high entropy TXT queries to a brand new domain is the classic sign of DNS tunneling, and a plain firewall rule on an external IP never sees it because the traffic looks like normal name resolution.",
        "Contain both ends: isolate the host through EDR so the channel stops while the machine stays powered for forensics, and sinkhole the malicious domain at your internal resolver so no other host can use the same trick. Blocking one IP at the edge or flushing the cache does nothing to a host that keeps generating fresh queries.",
      ],
    },
    {
      id: "kb-soc2-cred-harvest",
      title: "When a user gives a password to a phishing page",
      tags: ["phishing", "credentials", "account", "response"],
      body: [
        "If someone types their password into a fake login, treat the account as compromised from that moment. First confirm what was actually given away: the password for certain, and whether they approved any multifactor prompt.",
        "Then act at once: reset the credentials, revoke active sessions so any logon the attacker already started dies, and check the sign in history for access from an unfamiliar source. Telling the user to change it later leaves a live window for the attacker. Thank the person who called, because punishing honesty teaches everyone else to hide the next mistake.",
      ],
    },
  ],

  items: [
    {
      id: "soc2-noisy-rule",
      channel: "ticket",
      priority: "P3",
      from: { name: "SIEM", role: "Detection pipeline" },
      subject: "One rule is firing hundreds of times an hour",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 38,
      xp: 30,
      ticketBody:
        "A single detection rule, 'outbound connection to rare destination', has fired hundreds of times since midnight. The wall of duplicate alerts is burying everything else in the queue.",
      evidence: [
        {
          label: "Rule firing pattern",
          lines: [
            "Rule: outbound to a rare external destination",
            "Source of nearly every hit: backup-worker-01 (10.0.9.12)",
            "Destination: the offsite backup vendor, on the approved vendor list",
            "Change log: a new nightly backup job went live at 23:50",
          ],
        },
      ],
      commands: [
        {
          aliases: ["correlate", "siem", "investigate"],
          output:
            "Almost every hit is backup-worker-01 talking to the offsite backup vendor in the nightly window. The destination is on the approved vendor list. This is the new backup job, not an attacker.",
          step: "diag",
        },
        {
          aliases: ["history", "baseline"],
          output:
            "Before 23:50 last night this rule fired a handful of times a day. The spike lines up exactly with the new backup job going live.",
        },
      ],
      kbArticleId: "kb-soc2-alert-tuning",
      goal: "Cut the noise without losing the detection.",
      hint: "Almost every hit is one known backup host talking to an approved vendor. How do you quiet that one source without turning the rule off for everyone?",
      actions: [
        {
          id: "tune-rule",
          label: "Tune the rule to suppress the known backup host to the approved vendor, and keep it live for everything else",
          correct: true,
          requires: ["diag"],
          csat: 14,
          teach:
            "Right. The flood is one sanctioned backup job hitting an approved destination. A tight suppression for that source and destination clears the noise while the rule still catches a genuinely rare destination from any other host. That is detection engineering, not a mute button.",
        },
        {
          id: "disable-rule",
          label: "Disable the rule until the noise stops",
          correct: false,
          csat: -9,
          teach:
            "Turning the rule off blinds you to every real rare destination, which is exactly what a beacon or an exfil channel looks like. Suppress the one benign source, do not switch off the detection.",
        },
        {
          id: "mute-all",
          label: "Bulk acknowledge the alerts and move on",
          correct: false,
          csat: -6,
          teach:
            "Clicking past hundreds of alerts trains you to ignore this rule, so the day it catches a real attacker you will bulk close that too. Fix the cause of the noise by tuning, not by numbing yourself to it.",
        },
      ],
    },
    {
      id: "soc2-lateral",
      channel: "ticket",
      priority: "P1",
      from: { name: "EDR", role: "Endpoint" },
      subject: "Credential dumping tool seen on a finance workstation",
      slaMinutes: 15,
      arriveAfter: 30,
      reward: 52,
      xp: 44,
      ticketBody:
        "EDR flagged a credential dumping technique on FIN-WKS-12, run through a trusted Windows binary. Minutes later the same admin account logged into a second machine it had never touched. This looks like a foothold that is starting to move.",
      evidence: [
        {
          label: "EDR detail",
          lines: [
            "FIN-WKS-12: a built in Windows tool was abused to read credentials out of memory",
            "The same local admin account then authenticated to FIN-WKS-19 for the first time ever",
            "Both hosts are reachable from each other on the finance subnet",
            "Pattern is consistent with hands on lateral movement, not malware noise",
          ],
        },
      ],
      commands: [
        {
          aliases: ["process", "tree", "edr"],
          output:
            "A trusted system binary on FIN-WKS-12 was used to dump credentials from memory (a living off the land technique). Its parent process is a script in a user temp folder. This is deliberate, not a crash.",
          step: "diag",
        },
        {
          aliases: ["lateral", "logons", "scope"],
          output:
            "The dumped admin account just made a first ever logon to FIN-WKS-19. Two hosts are now in play. Nothing yet on the wider domain, but it is moving.",
          step: "scope",
        },
      ],
      kbArticleId: "kb-soc2-lateral",
      goal: "Contain the foothold and the spread without destroying the evidence.",
      hint: "It is already on a second host. You need to stop the movement and preserve memory and logs. What does that rule out, and how wide do you go?",
      actions: [
        {
          id: "isolate-both",
          label: "Isolate both FIN-WKS-12 and FIN-WKS-19 through EDR, preserve them, and escalate to incident response",
          correct: true,
          requires: ["diag", "scope"],
          csat: 16,
          teach:
            "Correct. You scoped it to the two hosts the account actually touched, isolated exactly those through EDR so they stay powered for forensics, and escalated. You contained the spread without going dark on the whole company or wiping the evidence the investigation needs.",
        },
        {
          id: "block-binary-fleet",
          label: "Block the abused Windows binary across the whole fleet",
          correct: false,
          csat: -10,
          teach:
            "That trusted binary is used by legitimate administration everywhere, so a fleet wide block breaks normal operations and tips the attacker that you are onto them, while the two compromised hosts keep talking. Isolate the affected hosts first, then hunt for the technique.",
        },
        {
          id: "reimage-now",
          label: "Reimage FIN-WKS-12 immediately to be safe",
          correct: false,
          csat: -12,
          ends: true,
          outcome: "mishandled",
          teach:
            "Reimaging wipes the memory, the dropped script, and the logon trail that show how they got in and where they went next. You also ignored the second host they already reached. Isolate and preserve, scope the spread, then remediate once the investigation has what it needs.",
        },
      ],
    },
    {
      id: "soc2-phish-campaign",
      channel: "email",
      priority: "P2",
      from: { name: "Reported by several staff", role: "user-reported phish" },
      subject: "Multiple users forwarded the same fake HR benefits login page",
      slaMinutes: 20,
      arriveAfter: 60,
      reward: 46,
      xp: 38,
      email: {
        body:
          "Six employees forwarded the same message in the last twenty minutes. It tells staff to confirm their account on an HR benefits portal that is a near copy of our real sign in page. Two of the six admit they already entered their password before getting suspicious.",
        isPhish: true,
      },
      evidence: [
        {
          label: "Campaign detail",
          lines: [
            "Sender domain: hr-benefits-portal.help (not our domain), SPF and DKIM both FAIL",
            "Linked page is a pixel copy of our real login, hosted on the same lookalike domain",
            "Delivered to 240 mailboxes, six reported it, two confirm they submitted their password",
            "The fake page posts whatever is typed to an attacker controlled address",
          ],
        },
      ],
      commands: [
        {
          aliases: ["headers", "investigate", "scope"],
          output:
            "One campaign, 240 recipients, lookalike domain failing SPF and DKIM, harvesting page live. Two users confirm they entered credentials. This is an active credential harvesting campaign, not a one off.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-soc2-phish-campaign",
      goal: "Run the campaign to ground: pull it, cut the harvest, and protect the people who fell for it.",
      hint: "It hit 240 inboxes and at least two people already typed their password. Quarantining the mail is only half of it. What about the credentials that are already gone?",
      actions: [
        {
          id: "quarantine-reset-block",
          label: "Quarantine the message from all 240 mailboxes, force a credential reset and session revoke on the users who submitted, and block the harvesting domain",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the full response. You pulled the mail org wide, blocked the harvesting domain so new clicks go nowhere, and most important you reset and revoked the accounts whose credentials were already harvested before the attacker could use them. Pulling the email alone would have left those stolen credentials live.",
        },
        {
          id: "quarantine-only",
          label: "Quarantine the message everywhere and close the case",
          correct: false,
          csat: -9,
          teach:
            "Quarantine stops new victims, but two people already handed over their password. Those credentials are in the attacker's hands right now. You have to reset and revoke the affected accounts, or you left the door open right after closing the window.",
        },
        {
          id: "warn-staff-only",
          label: "Email all staff a warning to watch out for the fake page",
          correct: false,
          csat: -7,
          teach:
            "A warning is useful, but it does not pull the live message from 240 inboxes and it does nothing for the two accounts already compromised. Awareness is not containment. Quarantine, block, and reset.",
        },
      ],
    },
    {
      id: "soc2-dns-exfil",
      channel: "ticket",
      priority: "P1",
      from: { name: "Threat hunting", role: "SOC" },
      incident: { group: "soc2-c2", root: true },
      subject: "A host is leaking data slowly inside DNS lookups",
      slaMinutes: 15,
      arriveAfter: 90,
      reward: 55,
      xp: 46,
      ticketBody:
        "A hunt query surfaced MKTG-WKS-04 making a steady stream of unusually long DNS TXT lookups to subdomains of a domain registered three days ago. The volume is small but constant. It looks like data is being smuggled out one query at a time.",
      evidence: [
        {
          label: "DNS analysis",
          lines: [
            "MKTG-WKS-04 sends long, high entropy TXT queries every few seconds",
            "All to subdomains of update-sync-cdn.live, registered three days ago",
            "Encoded chunks decode into pieces of internal file paths",
            "Classic DNS tunneling: the data rides out inside ordinary looking lookups",
          ],
        },
      ],
      commands: [
        {
          aliases: ["dns", "analyze", "investigate"],
          output:
            "MKTG-WKS-04 is tunneling data out through TXT queries to a domain that is three days old. The traffic looks like normal DNS, which is why a plain firewall rule never saw it. The host is actively exfiltrating.",
          step: "diag",
        },
        {
          aliases: ["whois", "domain", "reputation"],
          output:
            "update-sync-cdn.live: registered three days ago, no reputation, not on any allowlist. The kind of throwaway domain built for a covert channel.",
        },
      ],
      kbArticleId: "kb-soc2-dns-exfil",
      goal: "Stop the leak at both ends and preserve the host for the investigation.",
      hint: "It is data leaving inside DNS, so blocking one external IP at the firewall misses it. What stops the channel and the spread while keeping the evidence?",
      actions: [
        {
          id: "isolate-sinkhole",
          label: "Isolate the host through EDR, sinkhole the malicious domain at the internal resolver, preserve the host, and escalate",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Exactly right. Isolating MKTG-WKS-04 through EDR cuts the channel while keeping the machine powered for forensics, and sinkholing the domain at the resolver stops any other host from using the same trick. You closed the leak without destroying the evidence of what was taken.",
        },
        {
          id: "block-ip-firewall",
          label: "Block the domain's current IP at the perimeter firewall",
          correct: false,
          csat: -8,
          teach:
            "The data is leaving as DNS queries through your own resolver, and the attacker can rotate to a new IP or a backup domain in seconds. An IP block at the edge barely slows a DNS tunnel. Isolate the host and sinkhole the domain at the resolver.",
        },
        {
          id: "flush-resolver",
          label: "Flush the DNS resolver cache and keep watching",
          correct: false,
          csat: -10,
          teach:
            "A cache flush does nothing to a host that is actively generating new queries to smuggle data out. Every flush just clears entries it immediately rebuilds. Contain the host and cut the channel at the resolver, do not watch the data keep leaving.",
        },
      ],
    },
    {
      id: "soc2-c2-dup",
      channel: "ticket",
      priority: "P3",
      from: { name: "NOC", role: "Network operations" },
      incident: { group: "soc2-c2" },
      subject: "Odd DNS volume from one marketing machine",
      slaMinutes: 25,
      arriveAfter: 96,
      reward: 8,
      xp: 6,
      ticketBody:
        "Monitoring noticed one marketing workstation making far more DNS lookups than its neighbors. Probably nothing, but flagging it.",
      goal: "Tie it to the right incident.",
      hint: "One host, a flood of strange DNS lookups. Sound like anything else open right now?",
      actions: [
        {
          id: "link-c2",
          label: "Link it to the DNS exfiltration incident",
          correct: true,
          csat: 2,
          outcome: "resolved",
          teach: "Yes. This is the same host and the same channel as the exfil case. The root containment closes this report too.",
        },
        {
          id: "ignore-volume",
          label: "Close it, one chatty machine is normal",
          correct: false,
          csat: -5,
          teach:
            "That chatty machine is the one smuggling data out inside its DNS lookups. The unusual volume is the tell, not the noise. Link it to the active incident.",
        },
      ],
    },
    {
      id: "soc2-cred-phone",
      channel: "phone",
      priority: "P2",
      from: { name: "Worried employee", role: "Caller" },
      subject: "Caller thinks they just typed their password into a fake page",
      slaMinutes: 20,
      arriveAfter: 130,
      reward: 44,
      xp: 36,
      phone: {
        opener:
          "hi, um, i think i messed up. i got an email about my mailbox being full, clicked the link, and i typed my username and password before it looked wrong. what do i do",
        followups: [
          {
            label: "Did you actually enter your password, and did you approve any login or multifactor prompt afterward?",
            reply:
              "yes i typed my password. and right after, my phone buzzed with one of those approve sign in prompts, but i did not tap approve, i was already nervous.",
            correct: true,
          },
          {
            label: "Do not worry about it, just change your password sometime this week",
            reply:
              "ok but, i mean, i literally just gave my password to a fake site like a minute ago. waiting a week feels wrong, are you sure?",
          },
          {
            label: "Why would you click a link like that?",
            reply: "i, sorry, i know. i just wanted to fix it. so what should i actually do now",
          },
        ],
      },
      kbArticleId: "kb-soc2-cred-harvest",
      goal: "Get the facts, then contain the exposed account quickly and calmly.",
      hint: "Find out exactly what they gave away (the password, and any approval prompt) before you act. The fix protects the account now, not next week.",
      actions: [
        {
          id: "reset-revoke",
          label: "Reset the account credentials now, revoke active sessions, check for any sign in from the attacker, and reassure the caller for reporting it",
          correct: true,
          requires: ["phone"],
          csat: 16,
          teach:
            "Correct. You asked what was actually given away first (the password, and an approval prompt they wisely declined), then you reset and revoked immediately so the harvested credentials are useless, and you checked for any attacker logon. Thanking the caller keeps people reporting instead of hiding mistakes.",
        },
        {
          id: "change-later",
          label: "Tell them to change the password later and move on",
          correct: false,
          csat: -10,
          teach:
            "The attacker has working credentials right now. Waiting even an hour gives them a window to sign in. A handed over password is an emergency reset and session revoke, not a someday task.",
        },
        {
          id: "scold-ignore",
          label: "Tell them not to click links and close the call",
          correct: false,
          csat: -9,
          teach:
            "Scolding the one person brave enough to call teaches everyone else to stay quiet next time, and it does nothing about the live credentials. Reset the account now, then make reporting feel safe.",
        },
      ],
    },
  ],
};
