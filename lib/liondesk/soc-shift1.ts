import type { Shift } from "./types";

// SOC Shift 1: the SAME desk, a different chair. This proves LionDesk
// generalizes past IT support. The dock shows fewer apps (no stockroom, no
// admin) because a SOC analyst's surfaces are the case queue, the alert inbox,
// the terminal (SIEM/EDR), and the knowledge base. Defense-focused and
// fictional throughout: the lesson is always triage, contain, preserve, escalate.

export const SOC_SHIFT_1: Shift = {
  id: "soc-shift-1",
  track: "soc",
  order: 0,
  name: "SOC Shift 1: Reading the Board",
  rank: "SOC Analyst I",
  accent: "#2BBE6B",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-alert-triage",
      title: "Triage an alert: real or noise?",
      tags: ["alert", "triage", "false positive", "soc"],
      body: [
        "Not every alert is an incident. The job is to separate signal from noise without ignoring the one that matters.",
        "Before you act, confirm context: who or what triggered it, is it a known sanctioned activity, does it correlate with anything else. A sanctioned scan from your own security team is not an attack.",
      ],
    },
    {
      id: "kb-contain-host",
      title: "Containing a compromised host",
      tags: ["containment", "isolation", "edr", "incident"],
      body: [
        "When a host shows signs of compromise, the priority is to stop the spread while preserving evidence for investigation.",
        "Isolate the host from the network through the EDR (it stays powered so memory and logs survive). Do not power it off and do not reimage immediately, both destroy the evidence the investigation needs.",
      ],
    },
    {
      id: "kb-account-compromise",
      title: "A login looks compromised",
      tags: ["brute force", "account", "containment"],
      body: [
        "A burst of failed logins followed by a success is a likely account takeover. Blocking the source alone leaves the now-valid session live.",
        "Contain both ends: block the source and disable or force a reset on the affected account, after you confirm the success actually landed.",
      ],
    },
  ],

  items: [
    {
      id: "soc-phish-confirm",
      channel: "email",
      priority: "P3",
      from: { name: "Reported by jmalik", role: "user-reported phish" },
      subject: "User reported: 'is this email safe?'",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 35,
      xp: 28,
      email: {
        body:
          "Forwarded by an employee: a message claiming their mailbox is full and they must 'revalidate' at a link. They didn't click. Asking if it's safe.",
      },
      evidence: [
        { label: "Headers of the reported message", lines: ["From: Mail Admin <support@mail-quota-reset.info>", "SPF: FAIL   DKIM: FAIL", "Link host: mail-quota-reset.info  (not our domain)", "Sent to: 38 internal recipients"] },
      ],
      kbArticleId: "kb-alert-triage",
      goal: "The user did the right thing by reporting. Now you decide and act.",
      hint: "Headers fail, lookalike domain, and it hit 38 mailboxes. What does that last number tell you to do?",
      actions: [
        { id: "quarantine-all", label: "Confirm phishing and quarantine it from all 38 mailboxes", correct: true, csat: 12, outcome: "reported", teach: "Right. It failed SPF and DKIM, the domain is a lookalike, and it landed in 38 inboxes. Quarantining org-wide protects the 37 people who haven't reported it yet. Then thank the reporter." },
        { id: "tell-user-delete", label: "Tell the one user to delete it and close the case", correct: false, csat: -5, teach: "You protected one mailbox and left 37 exposed. When a phish hits many recipients, pull it for everyone, not just the person who flagged it." },
        { id: "close-benign", label: "Close it as benign, the user didn't click", correct: false, csat: -8, teach: "The headers clearly fail and the domain is a lookalike. 'Nobody clicked yet' is luck, not safety. This is a real phish that needs quarantine." },
      ],
    },
    {
      id: "soc-brute-force",
      channel: "ticket",
      priority: "P2",
      from: { name: "Auth alert", role: "SIEM" },
      subject: "Many failed logins then a success: svc-reporting",
      slaMinutes: 20,
      arriveAfter: 20,
      reward: 45,
      xp: 38,
      ticketBody:
        "SIEM correlation alert: a service account saw a burst of failed logins from one external IP, then a successful login from the same IP.",
      evidence: [
        { label: "Auth events, svc-reporting", lines: ["318 FAILED logins from 198.51.100.77 over 6 min", "1 SUCCESS from 198.51.100.77 at 02:14", "svc-reporting normally signs in only from 10.0.0.0/8 (internal)", "external success is highly abnormal"] },
      ],
      commands: [
        { aliases: ["timeline", "query", "siem"], output: "318 failures then 1 success from 198.51.100.77. Account is svc-reporting. External source, never seen before. The success landed.", step: "diag" },
        { aliases: ["whois", "geo", "lookup ip"], output: "198.51.100.77: hosting provider, foreign region. Not a corporate egress IP." },
      ],
      kbArticleId: "kb-account-compromise",
      goal: "Decide if this is a takeover and contain it correctly.",
      hint: "Failed-then-success from an IP this account never uses. Blocking the IP is half the job. What about the session it just created?",
      actions: [
        { id: "contain-both", label: "Block the source IP and disable svc-reporting, then force a credential reset", correct: true, requires: ["diag"], csat: 14, teach: "Correct containment. The success means the account is compromised. Blocking the IP stops new attempts, but you must also kill the account's access and reset it, otherwise the live session keeps going." },
        { id: "block-ip-only", label: "Block the IP and close it", correct: false, csat: -7, teach: "You stopped new login attempts but left a valid, attacker-controlled session on svc-reporting. Contain both the source and the account." },
        { id: "ignore-service", label: "It's just a service account, lower the alert and move on", correct: false, csat: -10, teach: "Service accounts often have broad access, which makes a takeover worse, not better. A confirmed external success is never 'just' anything." },
      ],
    },
    {
      id: "soc-beacon",
      channel: "ticket",
      priority: "P1",
      from: { name: "EDR alert", role: "Endpoint" },
      subject: "Host beaconing to a newly registered domain",
      slaMinutes: 15,
      arriveAfter: 45,
      reward: 50,
      xp: 42,
      ticketBody:
        "EDR flags WKS-2207 making a steady outbound connection every 60 seconds to a domain registered two days ago. A process in a temp folder is responsible.",
      evidence: [
        { label: "EDR detail, WKS-2207", lines: ["Outbound to sync-telemetry-cdn.live every 60s (regular interval)", "Domain age: 2 days", "Process: updater.tmp.exe in C:\\Users\\Public\\Temp", "Pattern consistent with command-and-control beaconing"] },
      ],
      commands: [
        { aliases: ["process", "edr", "inspect"], output: "updater.tmp.exe beaconing to sync-telemetry-cdn.live every 60s. Unsigned, running from a public temp path. Classic beacon.", step: "diag" },
        { aliases: ["domain", "whois"], output: "sync-telemetry-cdn.live registered 2 days ago, no reputation, not in any allowlist." },
      ],
      kbArticleId: "kb-contain-host",
      goal: "This host looks compromised. Contain it the right way.",
      hint: "You want to stop the spread but keep the evidence. What does that rule out?",
      actions: [
        { id: "isolate-host", label: "Isolate the host via EDR and preserve it for investigation", correct: true, requires: ["diag"], csat: 16, teach: "That's the move. EDR isolation cuts the host off the network so the beacon and any spread stop, while it stays powered so memory and logs survive for the investigation. Containment first, forensics intact." },
        { id: "block-domain-only", label: "Just block the C2 domain at the firewall", correct: false, csat: -6, teach: "Malware usually has backup domains or IPs. Blocking one domain rarely stops it, and the compromised host is still active on your network. Isolate the host." },
        { id: "reimage-now", label: "Reimage the machine immediately to be safe", correct: false, csat: -9, teach: "Reimaging destroys the evidence: how it got in, what it touched, whether it spread. Isolate and preserve first, then remediate once the investigation has what it needs." },
      ],
    },
    {
      id: "soc-false-positive",
      channel: "ticket",
      priority: "P3",
      from: { name: "Vuln scan alert", role: "SIEM" },
      subject: "Port scanning detected from 10.0.7.20",
      slaMinutes: 30,
      arriveAfter: 80,
      reward: 30,
      xp: 26,
      ticketBody:
        "Alert: a host on the internal range is sweeping ports across multiple subnets. Looks like reconnaissance.",
      evidence: [
        { label: "Context", lines: ["Source 10.0.7.20 = vuln-scanner-01 (asset tag: SECURITY TEAM)", "Change calendar: 'Authorized monthly vuln scan, 02:00-04:00' is ACTIVE now", "Scan signature matches our own scanner's profile"] },
      ],
      kbArticleId: "kb-alert-triage",
      goal: "It looks like recon. Is it actually an attack?",
      hint: "Before you sound the alarm, check who owns 10.0.7.20 and whether anything is scheduled.",
      actions: [
        { id: "verify-close-benign", label: "Verify it's the sanctioned scanner and close as a benign false positive", correct: true, csat: 12, outcome: "resolved", teach: "Good triage. The source is your own security team's scanner running an authorized, scheduled scan. Closing it as benign, with a note, is correct. Chasing it would waste the team's time and erode trust in the alerts." },
        { id: "isolate-scanner", label: "Isolate 10.0.7.20 immediately, it's scanning the network", correct: false, csat: -8, teach: "You just cut off your own security team's authorized scanner mid-run. Overreacting to a sanctioned activity is how alert fatigue and false alarms start. Verify context first." },
        { id: "page-everyone", label: "Declare an incident and page the whole team", correct: false, csat: -6, teach: "A scheduled, sanctioned scan is not an incident. Paging everyone for a false positive burns credibility you'll need for the real one." },
      ],
    },
    {
      id: "soc-exfil-escalate",
      channel: "ticket",
      priority: "P1",
      from: { name: "DLP alert", role: "Data Loss Prevention" },
      subject: "Large data transfer to personal cloud storage",
      slaMinutes: 15,
      arriveAfter: 120,
      reward: 48,
      xp: 40,
      ticketBody:
        "DLP flagged an account uploading a large volume of customer records to a personal file-sharing account, outside any normal workflow.",
      evidence: [
        { label: "DLP detail", lines: ["User: contractor account, ending in 4 days", "Volume: thousands of customer records in 20 min", "Destination: personal cloud storage, not a sanctioned service", "Activity: outside the user's normal pattern"] },
      ],
      kbArticleId: "kb-contain-host",
      goal: "This could be data theft. What's the right first move?",
      hint: "Potential insider data exfiltration involving a departing contractor. Is this yours to quietly handle, or does it need the incident process and the right stakeholders?",
      actions: [
        { id: "escalate-ir", label: "Escalate to the IR lead, preserve the evidence, and engage the right stakeholders per policy", correct: true, csat: 16, outcome: "escalated", teach: "Right call. Suspected insider exfiltration is a major incident with legal and HR implications. Escalate through IR, preserve the logs and evidence, and let the process engage the right people. Acting alone or tipping off the user can compromise the case." },
        { id: "message-user", label: "Message the user directly to ask what they're doing", correct: false, csat: -10, teach: "Tipping off a suspected insider gives them time to destroy evidence or finish the transfer. Suspected exfiltration goes through IR, quietly and by the book." },
        { id: "ignore-contractor", label: "It's a contractor, probably just backing up work, close it", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "A departing contractor moving thousands of customer records to personal storage is the textbook exfiltration pattern. Assuming good faith here could mean a major breach went unreported on your shift." },
      ],
    },
  ],
};
