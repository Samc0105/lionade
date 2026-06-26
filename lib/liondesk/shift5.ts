import type { Shift } from "./types";

// Shift 5: Major Incident (the boss). A company-wide auth outage that unfolds in
// stages: the alert floods the queue with duplicate "can't log in" tickets
// (incident mechanic, fix the root to mass-resolve), an exec demands a status
// update mid-crisis (VIP comms), and once it's contained a postmortem lands.
// Tight SLAs, so the live breach clock bites. This is incident command:
// contain, communicate, then prevent it ever happening again.

export const SHIFT_5: Shift = {
  id: "helpdesk-shift-5",
  track: "helpdesk",
  order: 4,
  name: "Shift 5: Major Incident",
  rank: "IT Manager",
  accent: "#EF4444",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-incident-comms",
      title: "Communicating during an incident",
      tags: ["incident", "comms", "status", "stakeholders"],
      body: [
        "During an outage, silence is its own failure. People need to know you know, what's affected, and when you'll update them next.",
        "Send a clear, honest status: what's impacted, what you're doing, and the time of the next update. Never promise an exact fix time you can't guarantee; commit to the next update instead.",
      ],
    },
    {
      id: "kb-postmortem",
      title: "A blameless postmortem",
      tags: ["postmortem", "rca", "prevention", "blameless"],
      body: [
        "After an incident, the goal is to fix the system, not punish a person. Good engineers ship bad changes; the question is why the system let a bad change cause an outage.",
        "Run a blameless postmortem and land a concrete preventive action: validation, a canary or staged rollout, an alert that would have caught it. Blame makes people hide the next mistake.",
      ],
    },
  ],

  items: [
    {
      id: "inc-root",
      channel: "ticket",
      priority: "P1",
      from: { name: "Monitoring", role: "SEV-1 alert" },
      subject: "SEV-1: nobody can log in, company-wide",
      slaMinutes: 10,
      arriveAfter: 0,
      reward: 60,
      xp: 50,
      incident: { group: "auth-outage", root: true },
      ticketBody: "Auth is failing for everyone. Login returns errors across every app. It started right after a config change went out.",
      evidence: [
        { label: "Auth service", lines: ["auth-svc: 100% login failures since 09:00", "change log: 09:00 config push set LDAP timeout = 0", "timeout=0 means every auth call instantly fails", "previous config (timeout=5s) was healthy"] },
      ],
      commands: [
        { aliases: ["status", "auth", "logs"], output: "auth-svc failing 100% since 09:00. The 09:00 config push set LDAP timeout to 0, so every login times out instantly. The prior config had timeout=5s and was healthy.", step: "diag" },
        { aliases: ["changelog", "diff", "last change"], output: "Only change today: 09:00 config push (LDAP timeout 5s -> 0). Strong, clean correlation with the outage start.", step: "diag" },
      ],
      kbArticleId: "kb-postmortem",
      goal: "The whole company is locked out. Find the cause and stop the bleeding.",
      hint: "It started exactly when a config went out, and the config is obviously wrong. Under a SEV-1, what's the fastest safe move?",
      actions: [
        { id: "rollback-config", label: "Roll back the 09:00 config push to the last known-good", correct: true, requires: ["diag"], csat: 18, teach: "That's incident command. The bad config (timeout 0) broke every login; rolling back to the known-good config restores auth immediately and closes the flood of duplicate tickets at once. Stop the bleeding first, diagnose the why later." },
        { id: "scale-auth", label: "Scale up the auth service", correct: false, csat: -8, teach: "It's a config bug, not load. More replicas just fail every login in parallel. Roll back the change that caused it." },
        { id: "restart-auth", label: "Restart the auth service and hope it clears", correct: false, csat: -6, teach: "It restarts with the same broken config and keeps failing. A restart isn't a rollback. Revert the bad change." },
      ],
    },
    {
      id: "inc-dup-1",
      channel: "ticket",
      priority: "P2",
      from: { name: "Alex Rivera", role: "Sales" },
      subject: "I can't log in to anything",
      slaMinutes: 20,
      arriveAfter: 8,
      reward: 8,
      xp: 6,
      incident: { group: "auth-outage" },
      ticketBody: "None of my logins work, every app says authentication failed. Is it just me?",
      goal: "Another login complaint. Sound familiar?",
      hint: "This is the third 'can't log in' in a minute. It's the incident, not this user.",
      actions: [
        { id: "ack-1", label: "Link it to the SEV-1 auth incident and reassure them", correct: true, csat: 2, teach: "Good. Tie it to the incident. The root fix will clear it and every other login ticket at once.", outcome: "resolved" },
        { id: "reset-1", label: "Reset their password", correct: false, csat: -4, teach: "Their password is fine; auth is down for everyone. Resetting one account does nothing against a service-wide outage." },
      ],
    },
    {
      id: "inc-dup-2",
      channel: "ticket",
      priority: "P3",
      from: { name: "Priya Nadar", role: "Marketing" },
      subject: "login broken??",
      slaMinutes: 25,
      arriveAfter: 16,
      reward: 8,
      xp: 6,
      incident: { group: "auth-outage" },
      ticketBody: "Can't get into email or the dashboard. Everything says login failed.",
      goal: "Same incident, same handling.",
      hint: "Fix the root and you won't have to touch this one.",
      actions: [
        { id: "ack-2", label: "Link it to the auth incident", correct: true, csat: 2, teach: "Right. Acknowledge and move on; the root fix mass-resolves these.", outcome: "resolved" },
        { id: "troubleshoot-2", label: "Walk them through clearing their browser cache", correct: false, csat: -4, teach: "It's not their browser; it's the auth service. Don't send a user chasing their cache during a company-wide outage." },
      ],
    },
    {
      id: "inc-dup-3",
      channel: "ticket",
      priority: "P3",
      from: { name: "Sam Okafor", role: "Design" },
      subject: "me too, locked out",
      slaMinutes: 25,
      arriveAfter: 24,
      reward: 8,
      xp: 6,
      incident: { group: "auth-outage" },
      ticketBody: "Adding to the pile. Locked out of everything.",
      goal: "You know this one.",
      hint: "Root cause, one fix, all of these close.",
      actions: [
        { id: "ack-3", label: "Link it to the auth incident", correct: true, csat: 2, teach: "Yep. Go contain the root and this closes itself.", outcome: "resolved" },
        { id: "ticket-each-3", label: "Open a separate investigation for this user", correct: false, csat: -5, teach: "Spinning up per-user investigations during a SEV-1 buries the real work. Recognize the pattern and fix the root." },
      ],
    },
    {
      id: "inc-comms",
      channel: "email",
      priority: "P1",
      from: { name: "VP of Operations", role: "Exec", vip: true },
      subject: "What do I tell the whole company RIGHT NOW?",
      slaMinutes: 10,
      arriveAfter: 25,
      reward: 55,
      xp: 45,
      email: {
        body:
          "I'm getting pinged by every department head. People think their accounts are hacked. I need something to send company-wide in the next few minutes. What do I say?",
      },
      kbArticleId: "kb-incident-comms",
      goal: "Give the exec the right message to send, fast.",
      hint: "People are scared and guessing. They need to know you know, what's affected, and when they'll hear from you next. What you should NOT do is promise an exact fix time.",
      actions: [
        { id: "honest-status", label: "Draft a clear status: logins are down, it's a config issue we're rolling back, accounts are NOT compromised, next update in 15 minutes", correct: true, csat: 14, teach: "Exactly right. Honest, specific, and it kills the 'we're hacked' panic. Committing to the next update time, not a fix time, is the professional move: you control the cadence without overpromising." },
        { id: "stay-silent", label: "Tell them to wait until it's fixed before saying anything", correct: false, csat: -10, teach: "Silence during an outage breeds rumors (people already think they're hacked). A short, honest status now is worth more than a perfect one later." },
        { id: "promise-eta", label: "Promise it'll be fully fixed in exactly 10 minutes", correct: false, csat: -8, teach: "Never promise an exact fix time under an incident; if it slips you've burned trust on top of the outage. Commit to the next update, not the fix." },
      ],
    },
    {
      id: "inc-postmortem",
      channel: "ticket",
      priority: "P3",
      from: { name: "Engineering Director", role: "Leadership" },
      subject: "Once it's contained: schedule the post-incident review",
      slaMinutes: 30,
      arriveAfter: 120,
      reward: 40,
      xp: 34,
      ticketBody: "Good work containing it. Set up the post-incident review. The engineer who pushed the config feels awful. How do we run this?",
      kbArticleId: "kb-postmortem",
      goal: "Close the loop so this never happens again.",
      hint: "The point of a postmortem is a safer system, not a scapegoat. What concrete thing would have stopped a timeout of 0 from reaching production?",
      actions: [
        { id: "blameless", label: "Run a blameless postmortem and land a preventive action (config validation + a canary/staged rollout)", correct: true, requires: ["kb"], csat: 14, teach: "That's the move. The fix isn't blaming a person; it's a system that won't let a timeout=0 config reach everyone at once. Validation plus a canary rollout would have caught it. Blameless keeps people honest about the next mistake." },
        { id: "blame-engineer", label: "Write up the engineer who pushed the bad config", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "Blame is how you guarantee the next person hides their mistake until it's worse. Good engineers ship bad changes; the failure was a system that shipped it unchecked. Keep it blameless and fix the pipeline." },
        { id: "skip-pm", label: "Skip it, the outage is over", correct: false, csat: -7, teach: "Skip the postmortem and you've kept the loaded gun. The same unvalidated config push will fire again. The prevention is the whole point." },
      ],
    },
  ],
};
