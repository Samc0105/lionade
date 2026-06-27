import type { Shift } from "./types";

// A gentle first shift that teaches the three core interactions: read a ticket
// and pick the fix, investigate in the terminal, and judge an email. Generous
// SLAs, no modifiers. Not scored toward stats or career (it's practice).

export const TUTORIAL_SHIFT: Shift = {
  id: "tutorial",
  track: "helpdesk",
  order: -1,
  name: "Tutorial: Your First Tickets",
  rank: "Day One",
  accent: "#2BBE6B",
  durationSeconds: 480,
  startingBudget: 0,
  inventory: [],
  adUsers: [],
  kb: [],
  items: [
    {
      id: "tut-monitor",
      channel: "ticket",
      priority: "P4",
      from: { name: "Casey", role: "Reception" },
      subject: "My screen is completely dead",
      slaMinutes: 60,
      arriveAfter: 0,
      reward: 20,
      xp: 15,
      ticketBody: "I sat down and my monitor is just black. The computer seems on, the screen is dead.",
      evidence: [{ label: "What you can see", lines: ["the PC fans are running", "the monitor's power light is OFF", "the monitor power cable is half out of the wall"] }],
      goal: "Read the clues, then pick the right fix. (This is how every ticket works.)",
      hint: "The monitor has no power light, and the evidence says the power cable is loose. Start with the simplest thing.",
      actions: [
        { id: "reseat-power", label: "Reseat the monitor's power cable", correct: true, csat: 12, teach: "That's it. The power cable was loose, so the monitor had no power. Always rule out the simple physical stuff first. Nice." },
        { id: "replace-monitor", label: "Order a replacement monitor", csat: -5, teach: "A working monitor with a loose cable doesn't need replacing. Check the basics before you spend money." },
        { id: "reboot-pc", label: "Reboot the computer", csat: -4, teach: "The computer is fine; the monitor just has no power. Rebooting won't help a dead screen." },
      ],
    },
    {
      id: "tut-printer",
      channel: "ticket",
      priority: "P3",
      from: { name: "Dana", role: "Accounting" },
      subject: "Nothing prints, the queue is stuck",
      slaMinutes: 60,
      arriveAfter: 0,
      reward: 24,
      xp: 18,
      ticketBody: "I hit print a bunch of times and nothing comes out. Now there's a pile of jobs stuck in the queue.",
      evidence: [{ label: "Printer", lines: ["Status: Ready, Online", "Queue: 4 jobs", "Job 1 stuck (ERROR), blocking the rest"] }],
      commands: [
        { aliases: ["status", "printer status"], output: "Printer ONLINE, Ready. Job 1 is STUCK (error) and blocking the 3 jobs behind it.", step: "diag" },
        { aliases: ["ping", "ping printer"], output: "Reply <1ms. The printer is reachable, so it isn't the network." },
      ],
      goal: "Use the terminal to investigate, then clear the blocker. (Try `status`.)",
      hint: "Run a command or two first (the buttons under the terminal). The fix needs you to confirm what's stuck.",
      actions: [
        { id: "clear-queue", label: "Clear the stuck job from the queue", correct: true, requires: ["diag"], csat: 12, teach: "Exactly. One stuck job jammed the whole queue. Investigate first, then clear the actual blocker. That's the help-desk instinct." },
        { id: "restart-spooler", label: "Restart the print spooler service", csat: -4, teach: "The stuck job survives a spooler restart. You have to clear the jammed job itself." },
      ],
    },
    {
      id: "tut-phish",
      channel: "email",
      priority: "P3",
      from: { name: "IT Helpdesk", role: "helpdesk@1ionade-it.com" },
      subject: "URGENT: verify your password now or lose access",
      slaMinutes: 60,
      arriveAfter: 0,
      reward: 24,
      xp: 18,
      email: { isPhish: true, body: "Your password expires in 1 hour. Verify immediately at http://lionade-verify.security-check.live or your account will be suspended." },
      evidence: [{ label: "Headers", lines: ["From: helpdesk@1ionade-it.com  (not getlionade.com)", "SPF: FAIL   DKIM: FAIL", "link host: security-check.live  (not ours)"] }],
      goal: "Decide what this email is, and do the right thing with it.",
      hint: "Look at the real sender domain and the link, not the urgent wording. Then check SPF and DKIM.",
      actions: [
        { id: "report", label: "Report it as phishing", correct: true, csat: 12, outcome: "reported", teach: "Caught it. Lookalike domain, SPF and DKIM both fail, and the link isn't ours. Reporting it gets it pulled for everyone. You've got the basics down." },
        { id: "click", label: "Click the link and reset to be safe", csat: -12, ends: true, outcome: "mishandled", teach: "That was the trap. The link is a fake login that steals your password. Always check the domain before you click. In a real shift, this would be an incident." },
        { id: "delete", label: "Just delete it", csat: -2, teach: "Deleting protects only you. Reporting it gets it pulled from everyone else's inbox too." },
      ],
    },
  ],
};
