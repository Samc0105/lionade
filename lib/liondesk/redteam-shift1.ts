import type { Shift } from "./types";

// Red Team Shift 1: an AUTHORIZED, scoped engagement (fictional lab). The whole
// point of ethical hacking is discipline: stay in scope, find the weakness a
// real attacker would, and hand back a clear finding plus the fix. Every
// "win" here is identify + report + remediate. No weaponized payloads, no
// out-of-scope access. The terminal does enumeration; the cards are decisions.

export const REDTEAM_SHIFT_1: Shift = {
  id: "redteam-shift-1",
  track: "redteam",
  order: 0,
  name: "Engagement: Authorized, In Scope",
  rank: "Junior Pentester",
  accent: "#EF4444",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-scope",
      title: "Stay in scope",
      tags: ["scope", "authorization", "rules of engagement"],
      body: [
        "The signed scope is the law of an engagement. Testing anything outside it, even something juicy, is unauthorized access, full stop.",
        "If you find an out-of-scope exposure, do not touch it. Document it and tell the client so they can expand the scope in writing. Discipline is what separates a pentester from an attacker.",
      ],
    },
    {
      id: "kb-finding",
      title: "Write a finding: impact + remediation",
      tags: ["report", "finding", "remediation"],
      body: [
        "A finding without a fix is just a complaint. Every finding states the issue, the impact if a real attacker exploited it, and the concrete remediation.",
        "Your deliverable is a safer system, not a trophy. The remediation is the most valuable part of the report.",
      ],
    },
    {
      id: "kb-sqli",
      title: "Remediating SQL injection",
      tags: ["sqli", "injection", "parameterized", "database"],
      body: [
        "SQL injection happens when user input is concatenated into a query. The real fix is parameterized queries (prepared statements), so input is always data and never code.",
        "Blocklisting quotes or special characters is not a fix; attackers bypass blocklists. Add input validation and run the app on a least-privilege database account as defense in depth.",
      ],
    },
    {
      id: "kb-privesc",
      title: "Fixing privilege-escalation misconfigs",
      tags: ["privesc", "permissions", "cron", "least privilege"],
      body: [
        "A common privesc path is a world-writable file that runs as root (a cron script, a service). Anyone who can edit it can run code as root.",
        "Remediate by tightening ownership and permissions (owned by root, not world-writable) and auditing what runs privileged. Apply least privilege everywhere.",
      ],
    },
  ],

  items: [
    {
      id: "rt-recon",
      channel: "ticket",
      priority: "P2",
      from: { name: "Engagement brief", role: "Client (signed scope)" },
      subject: "Scope: lab.internal (10.10.10.10) only. Map exposure.",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 40,
      xp: 32,
      ticketBody:
        "Signed authorization covers exactly one host: lab.internal at 10.10.10.10. Enumerate its exposed services and report anything that should not be reachable. Do not touch anything else.",
      evidence: [
        { label: "Authorized scope", lines: ["IN SCOPE: 10.10.10.10 (lab.internal) ONLY", "OUT OF SCOPE: everything else on the network", "Window: today, business hours"] },
      ],
      commands: [
        { aliases: ["scan", "nmap", "ports"], output: "10.10.10.10: 22/ssh (expected), 443/https (expected), 5432/postgres OPEN to the world (NOT expected). A database port is publicly reachable.", step: "diag" },
        { aliases: ["banner", "enum 5432"], output: "5432/postgres responds. Reachable from outside the host's subnet. No firewall in front of it." },
      ],
      kbArticleId: "kb-finding",
      goal: "Enumerate the in-scope host and report what's exposed.",
      hint: "Two open ports are expected for this host. One is a database that has no business facing the world.",
      actions: [
        { id: "report-port", label: "Report the exposed Postgres port as a finding with remediation (firewall it / bind to localhost / put it behind the VPN)", correct: true, requires: ["diag"], csat: 14, teach: "Clean work. A publicly reachable database is a serious exposure. You enumerated in scope, identified it, and handed back the fix. That's the job: find it, prove the impact, give the remediation." },
        { id: "login-db", label: "Try logging into the database to see what's inside", correct: false, csat: -9, teach: "Accessing the data is beyond enumeration and risks real harm. You don't need to break in to report that an open database is a risk. Document the exposure, don't exploit it." },
        { id: "scan-network", label: "Scan the rest of the network for more open databases", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "That's out of scope, which makes it unauthorized access. Scope is the law of an engagement. Test only what you're authorized to test." },
      ],
    },
    {
      id: "rt-default-creds",
      channel: "ticket",
      priority: "P2",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "The admin panel on the in-scope app",
      slaMinutes: 30,
      arriveAfter: 30,
      reward: 42,
      xp: 34,
      ticketBody: "While testing the in-scope web app you reach /admin. Assess it.",
      evidence: [
        { label: "Login banner", lines: ["ACME Router Admin v1.2", "Notice: default login is admin / admin", "The default account was never changed", "Panel is reachable from the internet"] },
      ],
      kbArticleId: "kb-finding",
      goal: "Assess the admin panel and report.",
      hint: "The banner is telling on itself. What's the finding, and what's the fix?",
      actions: [
        { id: "report-creds", label: "Document the default-credential finding with remediation (force a strong unique password, disable the default account, restrict the panel by IP or VPN)", correct: true, csat: 13, teach: "Right. Default credentials on an internet-reachable admin panel are a critical, trivially exploited finding. You proved it from the banner and gave a concrete fix. No need to rummage around inside." },
        { id: "pivot-creds", label: "Log in and pivot to see what else you can reach", correct: false, csat: -10, teach: "Logging in to roam further risks real impact and may exceed scope. The finding (default creds) and its fix are the deliverable. Don't turn a finding into an intrusion." },
        { id: "ignore-creds", label: "Note it privately but leave it out of the report", correct: false, csat: -8, teach: "A finding you don't report can't be fixed. The whole value of the engagement is the client learning what to remediate. Always report it." },
      ],
    },
    {
      id: "rt-sqli",
      channel: "ticket",
      priority: "P1",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "The login form throws a revealing error",
      slaMinutes: 20,
      arriveAfter: 55,
      reward: 50,
      xp: 42,
      ticketBody: "Testing the in-scope login, a malformed username returns a database error that leaks the query structure.",
      evidence: [
        { label: "App error (in scope)", lines: ["DB error: syntax near WHERE user='...' AND pass='...'", "The username is concatenated straight into the SQL", "This is a SQL injection class vulnerability"] },
      ],
      commands: [
        { aliases: ["probe", "test input", "confirm"], output: "A single malformed character changes the query's behavior, confirming the input is concatenated into SQL (injection class). Enough to document; no need to dump data.", step: "diag" },
      ],
      kbArticleId: "kb-sqli",
      goal: "Confirm the class of bug, then report it with the real fix.",
      hint: "The error shows input going straight into the query. You've confirmed the class. What's the actual remediation (not a blocklist)?",
      actions: [
        { id: "report-sqli", label: "Document the SQL injection and remediate with parameterized queries, input validation, and a least-privilege DB account", correct: true, requires: ["diag"], csat: 16, teach: "Exactly the right call. You confirmed the injection class without exploiting it, and the remediation is the real one: parameterized queries make input data, never code. Least privilege limits the blast radius if anything else slips through." },
        { id: "dump-db", label: "Use the injection to dump the whole database as proof", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "Exfiltrating real data is destructive and usually well beyond scope. You already confirmed the vulnerability; dumping the database is exploitation, not assessment. Confirm, document, remediate." },
        { id: "blocklist-quotes", label: "Recommend they block quote characters in the input", correct: false, csat: -7, teach: "A character blocklist is not a fix; attackers bypass blocklists with encodings and alternate syntax. The real remediation is parameterized queries, which the KB spells out." },
      ],
    },
    {
      id: "rt-scope-creep",
      channel: "ticket",
      priority: "P3",
      from: { name: "Your own recon notes", role: "during the engagement" },
      subject: "You can reach a production customer DB (NOT in scope)",
      slaMinutes: 30,
      arriveAfter: 110,
      reward: 38,
      xp: 30,
      ticketBody:
        "Mapping the in-scope host, you notice a production customer database on a different system is reachable. It is clearly out of scope. It looks wide open and very tempting.",
      evidence: [
        { label: "What you noticed", lines: ["Host: prod-customers-db (DIFFERENT system)", "Status: NOT in the signed scope", "It appears reachable and unauthenticated", "This is exactly the kind of thing a real attacker would jump on"] },
      ],
      kbArticleId: "kb-scope",
      goal: "Handle the out-of-scope discovery the right way.",
      hint: "It's not yours to touch, but it's also too important to ignore. There's a third option that's the professional one.",
      actions: [
        { id: "report-expand", label: "Stop, do not access it, and report it to the client so they can authorize and expand scope in writing", correct: true, requires: ["kb"], csat: 14, teach: "That's the professional move. You flagged a serious exposure without ever touching it, and you let the client expand the scope in writing. Maximum value, zero unauthorized access. This judgment is what makes you trusted with the next engagement." },
        { id: "just-a-peek", label: "Take a quick look since a real attacker would", correct: false, csat: -14, ends: true, outcome: "mishandled", teach: "An attacker's mindset is fine; an attacker's authorization is not. Accessing an out-of-scope production database is unauthorized, possibly illegal, and ends engagements and careers. Report it, never touch it." },
        { id: "ignore-it", label: "Ignore it since it's not in scope", correct: false, csat: -6, teach: "Staying in scope does not mean staying silent. A serious exposure you noticed should be reported so the client can act. Don't touch it, but absolutely tell them." },
      ],
    },
  ],
};
