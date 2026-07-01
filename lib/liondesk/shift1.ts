import type { Shift } from "./types";

// Shift 1: First Day on the Desk (Help Desk Intern). Eight items, each routing
// through a different surface so the whole workstation gets used: a stuck
// printer (terminal), a locked account (admin console), a dead charger
// (stockroom + ordering), a phishing email (inbox judgment), a confused user
// (phone triage), an Outlook crash (knowledge base), a newsletter (inbox
// hygiene), and a server outage (escalation). Authored + deterministic.

export const SHIFT_1: Shift = {
  id: "helpdesk-shift-1",
  track: "helpdesk",
  order: 0,
  name: "Shift 1: First Day on the Desk",
  rank: "Help Desk Intern",
  accent: "#4A90D9",
  durationSeconds: 600,
  startingBudget: 3400,

  inventory: [
    { sku: "chg-usbc", name: "USB-C 65W charger", stock: 0, vendor: "CDW", unitCost: 39 },
    { sku: "tpad-x1", name: "ThinkPad X1 laptop", stock: 2, vendor: "CDW", unitCost: 1450 },
    { sku: "ram-16", name: "16GB DDR5 SODIMM", stock: 4, vendor: "Newegg", unitCost: 58 },
    { sku: "dock", name: "USB-C dock station", stock: 3, vendor: "CDW", unitCost: 189 },
    { sku: "kbm", name: "Wireless keyboard + mouse", stock: 5, vendor: "Amazon Biz", unitCost: 42 },
    { sku: "hdmi", name: "HDMI cable 2m", stock: 8, vendor: "Amazon Biz", unitCost: 9 },
  ],

  adUsers: [
    { username: "pkhan", name: "Priya Khan", status: "locked", mfa: "ok", group: "Sales" },
    { username: "jmalik", name: "Jordan Malik", status: "active", mfa: "ok", group: "Engineering" },
    { username: "swong", name: "Sam Wong", status: "reset_required", mfa: "drifted", group: "Finance" },
    { username: "dlopez", name: "Dana Lopez", status: "active", mfa: "ok", group: "Accounting" },
  ],

  kb: [
    {
      "id": "kb-vendor-bank-change",
      "title": "Verify a vendor or payroll bank-account change",
      "tags": [
        "phishing",
        "invoice",
        "payroll",
        "bec",
        "finance",
        "security"
      ],
      "body": [
        "A request to update a vendor's or an employee's bank details is a top target for business email compromise. The attacker just wants the next payment redirected to their account, so the email leans on a real-looking name and a fresh reply address.",
        "Never action a banking change from an inbound email alone. Call the vendor or employee back on a phone number you already have on file, not one printed in the email, and confirm the change with them directly.",
        "If the sender domain, reply-to, or headers do not line up, treat it as phishing and report it so the SOC can pull it from every inbox. A single unverified change can send an entire payroll run to a criminal."
      ]
    },
    {
      "id": "kb-mfa-fatigue",
      "title": "Tell a real MFA prompt from an MFA-fatigue attack",
      "tags": [
        "mfa",
        "security",
        "authentication",
        "phishing",
        "account"
      ],
      "body": [
        "Multi-factor prompts are normal when you just signed in or unlocked an app. A legitimate approval names the app, the location, and the time, and it lines up with something you actually did in that moment.",
        "An MFA-fatigue attack is a flood of approval requests you did not trigger, often at odd hours, betting you will tap Approve just to make it stop. Approving one hands an attacker who already has your password a live session.",
        "The rule is simple: if you did not start a sign-in, deny it, then report it so the account can be checked. If you did start it and the details match, approving is the correct and expected action. Denying every prompt out of reflex locks you out of your own tools."
      ]
    },
    {
      "id": "kb-callback-verify",
      "title": "Verify identity with an out-of-band callback",
      "tags": [
        "verification",
        "callback",
        "identity",
        "security",
        "bec"
      ],
      "body": [
        "Out-of-band verification means confirming a request through a second channel the requester did not choose. If a suspicious ask arrives by email, you verify by phone; if it arrives by phone, you verify through a known internal record.",
        "The number, link, or contact must come from a trusted source you already hold, never from the message under suspicion. Attackers happily supply their own callback number and answer it in your requester's name.",
        "Use this before any high-impact action a message asks for: a password reset, a payment, a bank-detail change, or granting access. The extra minute of a callback is what stops a convincing fake from costing real money or access."
      ]
    },
    {
      "id": "kb-quarantine-scope",
      "title": "Scope a phishing quarantine to every affected mailbox",
      "tags": [
        "phishing",
        "quarantine",
        "soc",
        "incident",
        "email"
      ],
      "body": [
        "When you confirm a phishing message, the fix is rarely one mailbox. The same lure is usually delivered to many recipients at once, so protecting only the person who reported it leaves the rest exposed.",
        "Check the delivery count in the headers or mail trace, then quarantine the message from all recipients and block the sending domain or link host so new copies cannot land. Thank the reporter, since a quick report is what let you act early.",
        "Deleting your own copy or replying to warn a single person does not remove the threat for everyone else. Report and quarantine at the true scope of the delivery, not the scope of who happened to speak up."
      ]
    },
    {
      "id": "kb-legit-vs-phish",
      "title": "Read the headers before you report an email",
      "tags": [
        "phishing",
        "headers",
        "spf",
        "dkim",
        "triage",
        "security"
      ],
      "body": [
        "Not every unexpected or urgent email is an attack. Judging by the subject line alone leads to two failures: clicking a real phish, or flooding security with genuine mail that only looked alarming.",
        "The evidence is in the headers. A message that passes SPF and DKIM from your own domain, asks for nothing sensitive, and carries no link or attachment is almost always legitimate internal traffic, even if the topic is a maintenance window or an account notice.",
        "Reserve a report for the real tells: authentication failures, a lookalike or mismatched sender domain, a credential or payment ask, or a link whose host is not your company. Over-reporting authenticated internal mail trains people to ignore the alerts that matter."
      ]
    },
    {
      "id": "kb-hover-before-click",
      "title": "Check where a link really goes before clicking",
      "tags": [
        "phishing",
        "links",
        "url",
        "security",
        "email"
      ],
      "body": [
        "The visible text of a link is just a label and can say anything. What matters is the real destination, which you see by hovering over the link or long-pressing it on mobile to reveal the actual host.",
        "Compare that host to the company you expect. A lookalike domain, a swapped character, an unrelated host, or a link buried inside a URL shortener is a strong signal to stop. Legitimate internal tools live on your own domain.",
        "When the destination does not match, do not click and do not sign in. Report the message so it can be quarantined. One careful look at the real URL prevents most credential-harvest phishing."
      ]
    },
    {
      id: "kb-outlook-profile",
      title: "Fix a corrupt Outlook profile",
      tags: ["outlook", "email", "crash", "office"],
      body: [
        "Symptom: Outlook crashes on launch or hangs on 'Loading profile'. A reinstall rarely helps because the data lives in the profile, not the app.",
        "Fix: rebuild the mail profile. Control Panel > Mail > Show Profiles > Add a new profile, set it as default, reopen Outlook and let it re-sync from the server.",
        "Why it works: the crash is a corrupt local profile, not a broken install. Rebuilding the profile is minutes; a full Office reinstall is an hour and changes nothing.",
      ],
    },
    {
      id: "kb-printer-spooler",
      title: "Clear a stuck print spooler",
      tags: ["printer", "spooler", "queue"],
      body: [
        "When one job errors at the head of the queue, every job behind it sits QUEUED forever.",
        "Confirm the printer is online and reachable first, then clear the stuck job. Restarting the spooler service does not remove the jammed job itself.",
      ],
    },
    {
      id: "kb-phishing",
      title: "Spot and report a phishing email",
      tags: ["phishing", "security", "email"],
      body: [
        "Tells: SPF or DKIM failures in the headers, a lookalike sender domain (1ionade vs lionade), urgency, and a link whose real host does not match the company.",
        "Action: do not click and do not reply. Report it through the Phish Report button so the SOC can quarantine it for everyone. Deleting it silently only protects you.",
      ],
    },
    {
      id: "kb-account-lockout",
      title: "Unlock an Active Directory account",
      tags: ["account", "lockout", "password", "ad"],
      body: [
        "Repeated bad passwords (often a saved password on a phone after a reset) trip the lockout threshold.",
        "Unlock the account and, if the user just changed their password, confirm the new one synced. Resetting MFA does nothing for a password lockout.",
      ],
    },
    {
      id: "kb-dock-no-signal",
      title: "Monitor shows no signal through a dock",
      tags: ["monitor", "dock", "display", "wifi"],
      body: [
        "A 'black screen' is usually a display or dock fault, not Wi-Fi. Wi-Fi has nothing to do with whether a monitor gets a picture.",
        "Check the dock power light and reseat the cable between dock and monitor. If the dock lost power, the screen goes black while the laptop is fine.",
      ],
    },
    {
      id: "kb-escalation",
      title: "When to escalate, and to whom",
      tags: ["escalation", "incident", "outage"],
      body: [
        "A company-wide outage of a core system is a major incident, not a desk ticket. Trying to 'fix' production infrastructure you do not own makes it worse and slows the real responders.",
        "Escalate immediately to the on-call owner (Tier 3 / the DBA on call), capture the impact, and keep users informed. Knowing what is above your pay grade is a senior skill.",
      ],
    },
  ],

  items: [
    // 1) PRINTER — terminal investigation, fix card.
    {
      id: "printer-queue",
      channel: "ticket",
      priority: "P2",
      from: { name: "Dana Lopez", role: "Accounting" },
      subject: "Can't print the month-end report",
      asset: "HP-ACCT-2",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 40,
      xp: 30,
      ticketBody:
        "I've hit print 20 times and nothing comes out, now there's a pile of nothing in the queue. This is due at 5pm.",
      evidence: [
        {
          label: "Print Spooler, last events",
          lines: [
            "10:42  Job 7  AcctReport.pdf  ERROR_PRINTER_OFFLINE",
            "10:44  Job 8  AcctReport.pdf  QUEUED (waiting on Job 7)",
            "10:51  Job 9  AcctReport.pdf  QUEUED (waiting on Job 7)",
          ],
        },
        { label: "Printer HP-ACCT-2", lines: ["Status: Ready", "Connection: Online", "Toner: 64%"] },
      ],
      commands: [
        {
          aliases: ["status", "printer status", "stat"],
          output: "HP-ACCT-2: ONLINE, Ready. Queue: 5 jobs. Job 7 is STUCK (ERROR_PRINTER_OFFLINE), blocking 8-11.",
          step: "diag",
        },
        {
          aliases: ["logs", "log", "tail spooler"],
          output: "Job 7  ERROR_PRINTER_OFFLINE  <-- head of queue\nJob 8..11  QUEUED, waiting on Job 7",
          step: "diag",
        },
        { aliases: ["ping", "ping printer"], output: "Reply from HP-ACCT-2: time<1ms. Reachable. Not a network problem." },
      ],
      goal: "Get Dana printing again. Find the blocker and clear it.",
      hint: "Ready and pings fine, so it isn't hardware or network. Look at the head of the queue.",
      actions: [
        {
          id: "clear-queue",
          label: "Clear the stuck job from the queue",
          correct: true,
          requires: ["diag"],
          csat: 12,
          teach:
            "Right. Job 7 errored offline and jammed everything behind it. Clearing it releases the rest. Read the log, rule out hardware and network, then clear the actual blocker.",
        },
        {
          id: "restart-spooler",
          label: "Restart the print spooler service",
          csat: -4,
          teach: "The service restarts but Job 7 is still at the head of the queue. Restarting the spooler doesn't remove the jammed job.",
        },
        { id: "reinstall-driver", label: "Reinstall the printer driver", csat: -4, teach: "The driver was fine. The log shows a jammed queue, not a driver fault. That just burned 15 minutes." },
        { id: "reboot-printer", label: "Reboot the printer", csat: -3, teach: "The stuck spooler job survives the reboot. You need to clear the queue, not the printer." },
      ],
    },

    // 2) LOCKED ACCOUNT — admin console.
    {
      id: "account-lockout",
      channel: "ticket",
      priority: "P1",
      from: { name: "Priya Khan", role: "Field Sales" },
      subject: "Locked out, big client call in 20 min",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 45,
      xp: 35,
      ticketBody:
        "I changed my password this morning like IT asked and now I'm completely locked out. I have a client call in 20 minutes, please help.",
      evidence: [
        {
          label: "Auth log, pkhan",
          lines: [
            "08:01  password CHANGED (self-service)",
            "08:03  LOGIN FAIL x6 from her iPhone Mail (old saved password)",
            "08:04  ACCOUNT LOCKED (threshold: 6 bad attempts)",
          ],
        },
      ],
      ad: { username: "pkhan", action: "unlock" },
      kbArticleId: "kb-account-lockout",
      goal: "Get Priya back in before her call. Use the admin console.",
      hint: "She just changed her password and her phone kept retrying the old one. That trips a lockout. What does an account lockout actually need?",
      actions: [
        {
          id: "unlock-account",
          label: "Unlock her account and confirm the new password synced",
          correct: true,
          requires: ["ad"],
          csat: 14,
          teach:
            "Exactly. Her phone's saved password kept retrying after the change and tripped the lockout. Unlock, then have her update the saved password on her phone so it doesn't re-lock.",
        },
        { id: "reset-mfa", label: "Reset her MFA device", csat: -5, teach: "MFA has nothing to do with a password lockout. Now she also has to re-enroll MFA before her call. You made it worse." },
        { id: "wait-it-out", label: "Tell her to wait 30 minutes for the auto-unlock", csat: -6, teach: "She has a client call in 20. The lockout has a manual unlock for exactly this reason. Don't make a P1 wait." },
      ],
    },

    // 3) DEAD CHARGER — stockroom + ordering.
    {
      id: "dead-charger",
      channel: "ticket",
      priority: "P3",
      from: { name: "Marcus Reed", role: "Sales" },
      subject: "Laptop charger died, down to 12%",
      asset: "ThinkPad X1",
      slaMinutes: 60,
      arriveAfter: 45,
      reward: 35,
      xp: 25,
      ticketBody:
        "My USB-C charger stopped working this morning, no light on the brick. I'm at 12% and have a full day of demos. Can I get a replacement?",
      part: { sku: "chg-usbc" },
      goal: "Get Marcus a working charger. Check the stockroom.",
      hint: "This is a dead piece of hardware, not a software issue. You can't ping a charger back to life. Check stock; if it's out, order it.",
      actions: [
        {
          id: "ship-charger",
          label: "Ship Marcus a replacement USB-C charger",
          correct: true,
          requires: ["part"],
          csat: 11,
          teach:
            "Clean. The brick is dead, so it's a parts swap, not a fix. We were out of USB-C chargers, so you ordered stock first, then shipped one. Keeping the stockroom topped up is the real lesson.",
        },
        { id: "remote-fix", label: "Remote in and update his power drivers", csat: -5, teach: "There's no light on the brick. No driver fixes dead hardware. You can't software your way out of a physical fault." },
        { id: "byo", label: "Tell him to grab any charger from a coworker", csat: -3, teach: "A random wattage charger may not power an X1, and now you've got no record and an unsolved asset. Issue the right part." },
      ],
    },

    // 4) PHISHING EMAIL — inbox judgment.
    {
      id: "phish-reset",
      channel: "email",
      priority: "P1",
      from: { name: "IT Helpdesk", role: "helpdesk@1ionade-it.com" },
      subject: "ACTION REQUIRED: your password expires in 2 hours",
      slaMinutes: 20,
      arriveAfter: 20,
      reward: 40,
      xp: 35,
      email: {
        isPhish: true,
        body:
          "Your Lionade password expires in 2 hours. To avoid losing access, verify your credentials immediately at the secure portal: http://lionade-account-verify.help-desk.live/login\n\nFailure to act will suspend your account. IT Helpdesk",
      },
      evidence: [
        {
          label: "Email headers",
          lines: [
            "From: IT Helpdesk <helpdesk@1ionade-it.com>",
            "Return-Path: bounce@mail-23.help-desk.live",
            "SPF: FAIL   DKIM: FAIL   DMARC: FAIL",
            "Link host: lionade-account-verify.help-desk.live  (not getlionade.com)",
          ],
        },
      ],
      kbArticleId: "kb-phishing",
      goal: "Decide what this email is, and do the right thing with it.",
      hint: "Look at the real sender domain and the link host, not the display name. Then check SPF/DKIM.",
      actions: [
        {
          id: "report-phish",
          label: "Report it as phishing",
          correct: true,
          csat: 12,
          outcome: "reported",
          teach:
            "Caught it. Lookalike domain (1ionade), SPF and DKIM both fail, and the link host isn't getlionade.com. Reporting it lets the SOC quarantine it for everyone, not just you.",
        },
        { id: "delete-silently", label: "Just delete it", csat: -2, teach: "Deleting protects only your inbox. The same email is sitting in 200 other inboxes. Report it so it gets pulled for everyone." },
        { id: "reply-verify", label: "Reply to ask if it's legit", csat: -4, teach: "Replying confirms your address is live and tips off the attacker. Never reply to a suspected phish. Report it." },
        {
          id: "click-link",
          label: "Click the link and reset to be safe",
          csat: -16,
          ends: true,
          outcome: "mishandled",
          teach:
            "That was the trap. The link is a credential harvester on a lookalike domain. You just handed over a password. In real life this is now an incident. Always verify the domain before you click.",
        },
      ],
    },

    // 5) CONFUSED USER — phone triage.
    {
      id: "black-screen-text",
      channel: "phone",
      priority: "P2",
      from: { name: "Tyler B.", role: "Marketing" },
      subject: "Text: screen is black??",
      slaMinutes: 25,
      arriveAfter: 70,
      reward: 38,
      xp: 30,
      phone: {
        opener: "hellooo my screen is black is it the wifi?? i cant work nothing turns on the internet is down i think",
        followups: [
          {
            label: "Is the power light on your monitor or dock on?",
            reply: "ohhh no the little light on the dock thing is off. it was on yesterday",
            correct: true,
          },
          { label: "Did you try restarting your laptop?", reply: "yeah like 3 times nothing. still black. is it the wifi??" },
          { label: "I'll reset the Wi-Fi on our end, one sec", reply: "ok... still black tho. did it work??" },
        ],
      },
      kbArticleId: "kb-dock-no-signal",
      goal: "Figure out what's actually wrong (the user is guessing) and fix it.",
      hint: "A black screen has nothing to do with Wi-Fi. The user is guessing. Ask one question that tells you if it's a display or power issue.",
      actions: [
        {
          id: "reseat-dock",
          label: "Walk him through reseating the dock and its power",
          correct: true,
          requires: ["phone"],
          csat: 12,
          teach:
            "Nice. He said 'wifi' but the dock had no power light. A black screen is a display/power issue, never Wi-Fi. One good question beat ten minutes of guessing.",
        },
        { id: "reset-wifi", label: "Reset his Wi-Fi connection", csat: -5, teach: "Wi-Fi doesn't decide whether a monitor gets a picture. You chased the user's guess instead of asking what's actually happening." },
        { id: "reboot-router", label: "Reboot the office router", csat: -7, teach: "You just bounced the whole office's internet for one black screen that wasn't even a network issue. Diagnose before you act." },
      ],
    },

    // 6) OUTLOOK CRASH — knowledge base.
    {
      id: "outlook-crash",
      channel: "ticket",
      priority: "P3",
      from: { name: "Dana Lopez", role: "Accounting" },
      subject: "Outlook crashes the second I open it",
      asset: "OptiPlex-7090",
      slaMinutes: 45,
      arriveAfter: 110,
      reward: 36,
      xp: 28,
      ticketBody:
        "Outlook crashes immediately every time I open it. Everything else works fine. I already tried turning it off and on. I don't know what to do.",
      kbArticleId: "kb-outlook-profile",
      goal: "Fix Dana's Outlook. You haven't seen this one before, so look it up.",
      hint: "You don't have to know everything. Search the knowledge base for the symptom before you start swinging.",
      actions: [
        {
          id: "rebuild-profile",
          label: "Rebuild her Outlook mail profile",
          correct: true,
          requires: ["kb"],
          csat: 11,
          teach:
            "That's the move the KB points to. The crash is a corrupt local profile, not a broken install. Rebuilding the profile takes minutes and the mail re-syncs from the server.",
        },
        { id: "reinstall-office", label: "Reinstall all of Office", csat: -5, teach: "An hour of downtime that changes nothing. The data lives in the profile, not the app. The KB would've saved you the detour." },
        { id: "reboot-again", label: "Tell her to reboot again", csat: -4, teach: "She already rebooted. Repeating a failed fix isn't troubleshooting. Look it up and target the actual cause." },
      ],
    },

    // 7) NEWSLETTER — inbox hygiene (not everything is a ticket).
    {
      id: "vendor-newsletter",
      channel: "email",
      priority: "P4",
      from: { name: "OfficeBeans Coffee", role: "newsletter@officebeans.com" },
      subject: "☕ This week's break-room menu + 15% off pods",
      slaMinutes: 120,
      arriveAfter: 130,
      reward: 10,
      xp: 8,
      email: {
        body:
          "Hello Lionade team! Here's this week's break-room coffee menu and a special 15% off your next pod order. Reply STOP to unsubscribe.",
      },
      goal: "Decide whether this even needs your time.",
      hint: "Part of the job is knowing what is not a ticket. Don't manufacture work.",
      actions: [
        {
          id: "archive",
          label: "Archive it and move on",
          correct: true,
          csat: 4,
          outcome: "archived",
          teach: "Correct. It's a vendor newsletter, not a support request. Protecting your attention for real tickets is a skill. Not everything in the inbox is work.",
        },
        { id: "make-ticket", label: "Open a ticket to track it", csat: -3, teach: "Now there's a fake ticket clogging the queue behind real P1s. Don't create work that isn't there." },
        { id: "forward-all", label: "Forward it to the whole company", csat: -4, teach: "You just spammed 200 people from the IT account. Newsletters get archived, not amplified." },
      ],
    },

    // 8) OUTAGE — escalation judgment.
    {
      id: "db-outage",
      channel: "ticket",
      priority: "P1",
      from: { name: "Jordan Malik", role: "Engineering" },
      subject: "Everything is down, no one can log in",
      slaMinutes: 10,
      arriveAfter: 160,
      reward: 50,
      xp: 45,
      ticketBody:
        "The whole app is throwing 500s and nobody across the company can log in. Sales, support, all of it. This started 3 minutes ago.",
      evidence: [
        {
          label: "Status board",
          lines: [
            "auth-db-prod      DOWN  (connections refused)",
            "api gateway       DEGRADED (500s climbing)",
            "affected users    company-wide",
            "on-call DBA       paged? NO",
          ],
        },
      ],
      kbArticleId: "kb-escalation",
      goal: "This is bigger than a desk ticket. Do the right thing fast.",
      hint: "Company-wide outage of a core database. Is fixing prod infrastructure your job, or is getting the right people on it your job?",
      actions: [
        {
          id: "escalate",
          label: "Escalate immediately to the on-call DBA and declare a major incident",
          correct: true,
          csat: 16,
          outcome: "escalated",
          teach:
            "Right call. A company-wide core outage is a major incident, not a desk fix. Paging the owner fast and capturing impact is exactly the senior move. Knowing your lane matters.",
        },
        {
          id: "diy-restart",
          label: "Try to restart the production database yourself",
          csat: -14,
          ends: true,
          outcome: "mishandled",
          teach:
            "You don't own prod and you could corrupt the database mid-failover, turning a 10-minute incident into a day-long one. Escalate to the owner instead of touching infrastructure above your access.",
        },
        { id: "ignore-outage", label: "Keep working other tickets, someone else will catch it", csat: -10, teach: "Nobody was paged yet. The status board literally shows on-call wasn't notified. Sitting on a company-wide P1 is how outages get long." },
      ],
    },
  ],
};
