// Hand-authored pool extras that show off the chain mechanics, plus a second
// incident template for the Doubles modifier. Kept here (not in the generated
// JSON) because chains and incident groups are structural, not flat tickets.

import type { ShiftItem } from "./types";
import type { Track } from "@/lib/helpdesk/types";

export const EXTRA_TICKETS: { item: ShiftItem; track: Track }[] = [
  {
    track: "helpdesk",
    item: {
      id: "onboard-laptop",
      channel: "ticket",
      priority: "P3",
      from: { name: "HR Onboarding", role: "People Ops" },
      subject: "Provision a new hire's laptop for Monday",
      slaMinutes: 60,
      arriveAfter: 0,
      reward: 40,
      xp: 32,
      ticketBody: "New hire starts Monday. Their laptop needs to be imaged and enrolled before then.",
      goal: "Get the new hire's laptop ready.",
      hint: "Onboarding is a sequence. Image and enroll the device the standard way.",
      actions: [
        { id: "image-enroll", label: "Image the laptop and enroll it in MDM", correct: true, csat: 11, teach: "Standard onboarding. The device is ready. A laptop is only half of it though." },
        { id: "hand-blank", label: "Hand them the laptop as-is", csat: -5, teach: "An un-imaged, unenrolled laptop has no apps, no policies, no security baseline. Image and enroll it first." },
        { id: "local-admin", label: "Give them local admin and let them set it up", csat: -6, teach: "Handing a new hire local admin on an unmanaged box is a security and support nightmare. Provision it properly." },
      ],
      chainOnResolve: {
        id: "onboard-mailbox",
        channel: "ticket",
        priority: "P3",
        from: { name: "Sasha (new hire)", role: "Sales" },
        subject: "I can log in but I have no email",
        slaMinutes: 45,
        arriveAfter: 0,
        reward: 34,
        xp: 26,
        ticketBody: "The laptop works but Outlook says there's no account. I can't see any email.",
        goal: "Finish the onboarding: get their mailbox working.",
        hint: "The device is done; the identity side isn't. What did onboarding still owe them?",
        actions: [
          { id: "provision-mailbox", label: "Provision their mailbox and assign the license", correct: true, csat: 11, teach: "That's the other half of onboarding: device plus identity. Now they're fully set up." },
          { id: "reinstall-outlook", label: "Reinstall Outlook", csat: -4, teach: "Outlook is fine; there's no mailbox to connect to yet. Provision the account, not the app." },
          { id: "wait-sync", label: "Tell them it'll sync eventually", csat: -5, teach: "It won't sync a mailbox that was never created. Provision it." },
        ],
      },
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "slow-pc-callback",
      channel: "ticket",
      priority: "P3",
      from: { name: "Ben Carter", role: "Finance" },
      subject: "My PC has been really slow all morning",
      slaMinutes: 45,
      arriveAfter: 0,
      reward: 38,
      xp: 30,
      ticketBody: "Everything is sluggish today, opening anything takes forever. Can you take a look?",
      evidence: [{ label: "Task Manager (shared)", lines: ["process 'idx_helper.exe' pinned at 95% CPU", "started 08:02, never settled", "everything else starved for CPU"] }],
      goal: "Actually fix Ben's slow PC.",
      hint: "There's a real cause in the task list. Don't fob him off with a generic restart.",
      actions: [
        { id: "kill-indexer", label: "End the runaway indexer process and stop it auto-starting", correct: true, csat: 12, teach: "Right. A stuck indexer was eating the CPU. Killing it and stopping the auto-start fixes the actual problem." },
        { id: "add-ram-slow", label: "Order him more RAM", csat: -5, teach: "It's a pegged CPU from one process, not memory pressure. More RAM won't touch it." },
        { id: "fob-off", label: "Tell him to just restart and close the ticket", csat: -8, ends: true, outcome: "mishandled", teach: "You closed it without finding the cause. A restart clears it for a minute, but the auto-starting indexer pegs the CPU again. Fobbing users off is how tickets come back angrier." },
      ],
      chainOnFail: {
        id: "slow-pc-angry",
        channel: "ticket",
        priority: "P1",
        from: { name: "Ben Carter", role: "Finance", vip: true },
        subject: "It is STILL slow and I've lost an hour",
        slaMinutes: 15,
        arriveAfter: 0,
        reward: 30,
        xp: 24,
        ticketBody: "I restarted like you said and it's slow AGAIN. I've wasted my whole morning. Fix it properly this time.",
        evidence: [{ label: "Task Manager", lines: ["'idx_helper.exe' back at 95% CPU after the reboot", "it auto-starts at login"] }],
        goal: "Make it right, and find the real cause this time.",
        hint: "It came back because the cause was never addressed. The process auto-starts.",
        actions: [
          { id: "kill-indexer-2", label: "End the indexer and disable its auto-start", correct: true, csat: 10, teach: "Fixed at the source this time. The lesson stings but sticks: solve the cause the first time, or it comes back worse." },
          { id: "reimage-angry", label: "Reimage his machine to be safe", csat: -6, teach: "A full reimage over one runaway process is overkill and more downtime for an already-furious user. Kill the process." },
        ],
      },
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "printer-then-scanner",
      channel: "ticket",
      priority: "P3",
      from: { name: "Reception", role: "Front Desk" },
      subject: "The lobby printer is offline",
      slaMinutes: 40,
      arriveAfter: 0,
      reward: 38,
      xp: 30,
      ticketBody: "The big lobby MFP shows offline and won't print.",
      evidence: [{ label: "MFP status", lines: ["MFP-LOBBY: offline", "network cable unplugged at the wall", "toner and paper fine"] }],
      goal: "Get the lobby printer back.",
      hint: "It says offline and the basics are fine. Check the physical link before anything fancy.",
      actions: [
        { id: "reconnect-mfp", label: "Reconnect the network cable and bring it back online", correct: true, csat: 11, teach: "Simple physical fix. It's back online. These multifunction units do more than print, though." },
        { id: "reinstall-mfp-driver", label: "Reinstall the printer driver", csat: -4, teach: "The driver's fine; the cable was unplugged. Check connectivity first, drivers last." },
        { id: "replace-mfp", label: "Order a replacement printer", csat: -6, teach: "A working printer with an unplugged cable doesn't need replacing. Plug it back in." },
      ],
      chainOnResolve: {
        id: "scanner-followup",
        channel: "ticket",
        priority: "P3",
        from: { name: "Reception", role: "Front Desk" },
        subject: "Now scan-to-email isn't working on it",
        slaMinutes: 40,
        arriveAfter: 0,
        reward: 32,
        xp: 26,
        ticketBody: "Printing works again but the scan-to-email button just errors.",
        evidence: [{ label: "MFP scan log", lines: ["scan-to-email: SMTP auth failed", "the saved app password expired last week"] }],
        goal: "Finish the job: get scan-to-email working.",
        hint: "Same device, different function. The error points at email auth, not the network.",
        actions: [
          { id: "renew-smtp", label: "Update the MFP's scan-to-email credentials", correct: true, csat: 11, teach: "Right. The saved SMTP app password expired, so scanning to email failed even though printing was fine. Renew it and it scans again." },
          { id: "reboot-mfp", label: "Reboot the MFP", csat: -4, teach: "A reboot won't refresh an expired credential. Update the scan-to-email auth." },
        ],
      },
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "admin-rights-request",
      channel: "ticket",
      priority: "P3",
      from: { name: "Greg Mills", role: "Marketing" },
      subject: "I need admin rights to install a design tool",
      slaMinutes: 45,
      arriveAfter: 0,
      reward: 38,
      xp: 30,
      ticketBody: "I found a free design app online and need local admin to install it. Can you just give me admin?",
      goal: "Handle the request the right way.",
      hint: "There's a safe way to get users software, and it isn't handing out local admin for a random download.",
      actions: [
        { id: "software-center", label: "Offer it through the vetted software center, or package the app first", correct: true, csat: 12, teach: "Right. Users get software through a vetted channel, not local admin on a random download. If it's legit, package it; if not, suggest an approved alternative." },
        { id: "deny-explain", label: "Decline local admin and explain the policy", csat: -2, teach: "Declining is safe, but leaving the user stuck isn't great. Offer the vetted path so they can still get what they need." },
        { id: "grant-admin", label: "Just grant local admin so he can install it", csat: -8, ends: true, outcome: "mishandled", teach: "Handing local admin for an unvetted internet download is exactly how bad things get installed. This one comes back." },
      ],
      chainOnFail: {
        id: "malware-callback",
        channel: "ticket",
        priority: "P1",
        from: { name: "SOC", role: "Security", vip: true },
        subject: "That 'design app' is flagged as malware on Greg's PC",
        slaMinutes: 15,
        arriveAfter: 0,
        reward: 30,
        xp: 24,
        ticketBody: "The tool you let Greg install with local admin is throwing EDR alerts. It's bundled malware. We need this contained.",
        evidence: [{ label: "EDR", lines: ["unsigned installer dropped two extra processes", "beaconing to an ad network", "local admin let it persist"] }],
        goal: "Clean up the mess and contain it.",
        hint: "You gave it admin and it abused that. Stop it spreading and remove the access.",
        actions: [
          { id: "isolate-remove", label: "Isolate the PC, remove the malware, and revoke the local admin", correct: true, csat: 10, teach: "Contained. The lesson lands: granting local admin for an unvetted download let malware install and persist. Vetted channels exist for exactly this reason." },
          { id: "just-uninstall", label: "Just uninstall the app", csat: -6, teach: "It already dropped extra processes and is beaconing. An uninstall won't catch those. Isolate and remediate, and pull the admin rights." },
        ],
      },
    },
  },

  // ── Phone calls. The followups ARE the diagnostic: ask the right question to
  // pin the issue (which stops the patience drain), then the fix unlocks. The
  // correct fix requires ["phone"], so you cannot resolve a call you never
  // actually listened to.
  {
    track: "helpdesk",
    item: {
      id: "call-vpn-home",
      channel: "phone",
      priority: "P2",
      from: { name: "Diego Salas", role: "Sales" },
      subject: "VPN won't connect from home",
      slaMinutes: 20,
      arriveAfter: 0,
      reward: 42,
      xp: 34,
      phone: {
        opener: "Hey, I'm working from home and the VPN just spins forever and never connects. I've got a deadline, can you help?",
        followups: [
          { label: "Did you get the multi-factor prompt on your phone when it tried to connect?", reply: "Now that you mention it, no, no prompt ever showed up.", correct: true },
          { label: "Have you tried restarting your computer?", reply: "Yeah, twice already. Same thing." },
          { label: "Is your home wifi working otherwise?", reply: "Yes, everything else loads fine." },
        ],
      },
      goal: "Find out why the VPN hangs, then fix it.",
      hint: "A VPN that spins forever often isn't the network. What step has to complete that the user might not be seeing?",
      actions: [
        { id: "reenroll-mfa", label: "Re-enroll their MFA device so the second factor can complete", correct: true, requires: ["phone"], csat: 12, teach: "Right. No MFA prompt means the second factor never fired, so the tunnel never finishes. Re-enrolling their authenticator fixes it. The spinning was the client waiting on a factor that never came." },
        { id: "reset-vpn-config", label: "Reset their VPN client config", requires: ["phone"], csat: -5, teach: "The client is fine; the second factor never prompted. Resetting the config wastes their deadline and doesn't touch the cause." },
        { id: "hotspot", label: "Tell them to switch to a mobile hotspot", csat: -6, teach: "Their home network is fine and you never pinned the issue. Ask the right question before you send them chasing their router." },
      ],
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "call-locked-vip",
      channel: "phone",
      priority: "P1",
      from: { name: "Karen Pruitt", role: "VP Finance", vip: true },
      subject: "Locked out minutes before a board meeting",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 50,
      xp: 42,
      phone: {
        opener: "This is Karen, I present to the board in ten minutes and I am completely locked out of my laptop. Please hurry.",
        followups: [
          { label: "Did you recently change your password, or is it prompting you for a new one?", reply: "Yes. It forced a change on Friday and I think I forgot the new one.", correct: true },
          { label: "Is caps lock maybe on?", reply: "No, I already checked that." },
          { label: "Is your wifi connected?", reply: "I cannot even log in, so I have no idea." },
        ],
      },
      goal: "Get her back in, the right way, under pressure.",
      hint: "She is important and she is rushing you. That is exactly when the verification step matters most.",
      actions: [
        { id: "verify-then-reset", label: "Verify her identity, then trigger a secure password reset and walk her through a new one", correct: true, requires: ["phone"], csat: 14, teach: "Correct, even under pressure. A forgotten post-change password is a reset, but you verify identity first. Doing it calmly gets the VP back in and keeps the door shut to anyone impersonating her." },
        { id: "reset-no-verify", label: "Just reset it immediately without verifying, she's clearly the VP", csat: -8, ends: true, outcome: "mishandled", teach: "A panicked caller claiming to be an executive is the classic social-engineering setup. Resetting credentials without verifying identity is how attackers walk in. Verify first, every time, no matter who they say they are." },
        { id: "tell-her-wait", label: "Tell her to file a ticket and wait in the queue", requires: ["phone"], csat: -6, teach: "You pinned the issue and then stranded her before the board. A verified reset takes a minute. Make the right call quickly." },
      ],
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "call-dead-laptop",
      channel: "phone",
      priority: "P3",
      from: { name: "Priya Anand", role: "Design" },
      subject: "Laptop is totally dead, demo this afternoon",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 38,
      xp: 30,
      phone: {
        opener: "My laptop is completely dead, no lights, nothing at all. I have to give a demo this afternoon and I'm panicking.",
        followups: [
          { label: "Is the charger plugged in, and do you see any light on the charger or laptop?", reply: "Huh, the charger light is off. The cable looks loose where it meets the wall.", correct: true },
          { label: "Have you tried holding the power button down?", reply: "Yes, held it for ten seconds, nothing." },
          { label: "Is the screen brightness turned all the way up?", reply: "It's totally black, there's no backlight at all." },
        ],
      },
      goal: "Figure out why it's dead before you escalate to hardware.",
      hint: "Dead means no power. Before you send a tech or order hardware, confirm power is actually reaching it.",
      actions: [
        { id: "reseat-charger", label: "Have them reseat the charger at the wall and the laptop, then confirm it charges", correct: true, requires: ["phone"], csat: 11, teach: "That's it. A loose charger at the wall meant zero power, which looks identical to a dead machine. Reseating it lights the charger and it boots. Cheapest fix there is, and you asked the question that found it." },
        { id: "order-replacement", label: "Order them a replacement laptop", requires: ["phone"], csat: -6, teach: "You confirmed the charger light was off. That's a power-delivery issue, not a dead laptop. Don't burn budget on hardware you don't need." },
        { id: "book-repair", label: "Book a hardware repair appointment", csat: -5, teach: "Booking a repair before checking power sends a working laptop to the bench. Ask about power first." },
      ],
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "call-phish-report",
      channel: "phone",
      priority: "P2",
      from: { name: "Tom Reilly", role: "Operations" },
      subject: "Caller asking if a 'mailbox full' email is real",
      slaMinutes: 25,
      arriveAfter: 0,
      reward: 40,
      xp: 32,
      phone: {
        opener: "I got an email saying my mailbox is full and I have to verify my password at a link or lose my email. It looks official. Is it real? I almost clicked.",
        followups: [
          { label: "Can you read me the sender's address and the link domain exactly?", reply: "Sender is it-support@mail-secure-verify.com and the link goes to mail-secure-verify dot com.", correct: true },
          { label: "Did you click the link?", reply: "No, I called you first." },
          { label: "Can you tell me your password so I can check the account?", reply: "Wait, why would you need my password?" },
        ],
      },
      goal: "Decide what this is and handle it without making it worse.",
      hint: "The pin is in the sender and the link. And note: you never need their password to help them.",
      actions: [
        { id: "confirm-phish-report", label: "Confirm it's phishing, tell them not to click, report it, and check who else received it", correct: true, requires: ["phone"], csat: 12, outcome: "reported", teach: "Right call. A lookalike domain asking for password verification is textbook phishing. Praise them for asking, report it, and pull it from other mailboxes since it likely hit more than one person." },
        { id: "just-delete", label: "Tell them to just delete it and move on", requires: ["phone"], csat: -5, teach: "Deleting protects one person. If it landed in their inbox it landed in others. Report it so it can be pulled org-wide." },
        { id: "reset-their-pw", label: "Reset their password just to be safe", csat: -4, teach: "They told you they didn't click. Resetting is noise, and you skipped the real job: report it and protect everyone else who got the same message." },
      ],
    },
  },

  // ── Inbox: phishing discernment. Not everything is an attack, and not
  // everything is safe. The skill is telling them apart from the headers.
  {
    track: "helpdesk",
    item: {
      id: "email-bec-giftcard",
      channel: "email",
      priority: "P2",
      from: { name: "Marcus Webb (CEO)", role: "spoofed display name" },
      subject: "Quick favor, are you at your desk?",
      slaMinutes: 25,
      arriveAfter: 0,
      reward: 44,
      xp: 36,
      email: {
        isPhish: true,
        body: "Hi, I'm stuck in back-to-back meetings and need a quick favor. Can you grab five $200 gift cards for some client thank-yous? I'll reimburse you today. Keep this between us for now, it's a surprise. Just reply with the codes once you have them.",
      },
      evidence: [
        { label: "Message headers", lines: ["Display name: Marcus Webb (CEO)", "Actual sender: ceo.marcus.webb@gmail.com (not our domain)", "Reply-To: m.webb.exec@proton.me", "SPF: not aligned with company domain", "Pattern: urgency + secrecy + gift cards = classic BEC"] },
      ],
      goal: "Decide what this 'CEO' request really is.",
      hint: "Urgency, secrecy, and gift cards from a personal address. Read the actual sender, not the display name.",
      actions: [
        { id: "verify-report-bec", label: "Verify with the CEO through a known channel, then report it as a likely BEC scam", correct: true, csat: 13, outcome: "reported", teach: "Right. Display name says CEO, the real address is a personal Gmail, and the ask is gift cards with secrecy and urgency. That's business email compromise. Confirm out of band and report it. Real executives don't run gift-card errands through secret email." },
        { id: "buy-cards", label: "Buy the gift cards, it's the CEO and he's in a hurry", csat: -12, ends: true, outcome: "mishandled", teach: "That's exactly the trap. The whole scam runs on you trusting the display name and the urgency. The money is gone the moment you send the codes. Verify through a known channel first, always." },
        { id: "reply-which-cards", label: "Reply asking which gift cards he wants", csat: -7, teach: "Engaging tells the scammer they found a live target, and you still haven't verified it's really the CEO. Don't reply to the suspicious address. Verify out of band and report." },
      ],
    },
  },
  {
    track: "helpdesk",
    item: {
      id: "email-legit-maintenance",
      channel: "email",
      priority: "P3",
      from: { name: "IT Operations", role: "internal, verified sender" },
      subject: "Planned VPN maintenance this Saturday 1am to 3am",
      slaMinutes: 40,
      arriveAfter: 0,
      reward: 34,
      xp: 28,
      email: {
        body: "Heads up: the VPN gateway gets a firmware update Saturday between 1am and 3am. Remote access may drop briefly during the window. No action needed on your part. Questions go to the IT Operations channel.",
      },
      evidence: [
        { label: "Message headers", lines: ["Sender: it-operations@OUR-company-domain (aligned)", "SPF: PASS   DKIM: PASS", "No links, no attachments, no credential request", "Matches the published change calendar entry"] },
      ],
      goal: "Decide how to handle this notice.",
      hint: "Headers pass, the domain is yours, there's no link or ask. Phishing isn't the only possible answer.",
      actions: [
        { id: "ack-legit", label: "Acknowledge it as a legitimate internal notice and file it", correct: true, csat: 11, outcome: "archived", teach: "Correct. It passes SPF and DKIM from your own domain, asks for nothing, and matches the change calendar. Treating every email as a threat is its own failure. This one is real and needs no action." },
        { id: "report-legit-as-phish", label: "Report it to security as phishing", csat: -5, teach: "Over-reporting legitimate, authenticated internal mail floods the security team and trains people to ignore real alerts. Read the headers: this one is genuine." },
        { id: "panic-reset", label: "Reset your VPN credentials just in case", csat: -4, teach: "There's no compromise here and nothing was asked of you. Reflexive 'just in case' actions waste time. Acknowledge and move on." },
      ],
    },
  },

  // ── SOC / SWE / Red Team get track-appropriate surfaces. These three tracks
  // were terminal-only across most shifts, so the pool drew them as flat
  // tickets. The items below give SOC an email phishing chain, SWE an on-call
  // chain plus a stakeholder phone call, and Red Team a vishing call plus a
  // phishing-simulation email where the win is a reported finding. Every
  // kbArticleId reuses an article that already lives in a registered shift, so
  // it resolves in MASTER_KB without touching pool.ts. Preview-only: nothing
  // here grants live Fangs.

  // SOC: a user-reported phish (email) whose correct quarantine reveals the
  // fallout chain (two accounts already submitted credentials). Triage, then
  // contain.
  {
    track: "soc",
    item: {
      id: "soc-phish-docusign",
      channel: "email",
      priority: "P2",
      from: { name: "Reported by rkapoor", role: "user-reported phish" },
      subject: "User reported: 'shared document, do I sign in?'",
      slaMinutes: 25,
      arriveAfter: 0,
      reward: 44,
      xp: 36,
      email: {
        isPhish: true,
        body: "Forwarded by an employee: an email says a colleague shared a document and they must sign in with their work account at a link to open it. The page looked like our login. They are asking if it is safe before entering anything.",
      },
      evidence: [
        { label: "Headers of the reported message", lines: ["From: Document Share <noreply@secure-doc-share.co>", "SPF: FAIL   DKIM: FAIL", "Link host: secure-doc-share.co/login  (not our domain)", "Landing page clones our sign in screen", "Delivered to: 64 internal recipients"] },
      ],
      kbArticleId: "kb-alert-triage",
      goal: "The user reported before entering anything. Decide and act.",
      hint: "Headers fail, the domain is a lookalike, the page clones your login, and it hit 64 mailboxes. That last number sets the scope of your action.",
      actions: [
        { id: "quarantine-block", label: "Confirm phishing, quarantine it from all 64 mailboxes, and block the lookalike domain", correct: true, csat: 13, outcome: "reported", teach: "Right. It fails SPF and DKIM, the domain is a lookalike, and the page is a credential harvest. Quarantine org wide so the other 63 cannot fall for it, block the domain, and thank the reporter. The job is not done yet though: someone may have entered credentials before you pulled it." },
        { id: "warn-one", label: "Reply telling the one reporter not to sign in, then close it", correct: false, csat: -5, teach: "You protected the one person who asked. The other 63 still have a live credential trap in their inbox. When a phish hits many mailboxes, pull it for everyone." },
        { id: "close-noclick", label: "Close it benign since the reporter did not enter anything", correct: false, csat: -8, teach: "One careful reporter is luck, not safety. The headers fail and the page harvests credentials. This needs an org wide quarantine, not a close." },
      ],
      chainOnResolve: {
        id: "soc-phish-fallout",
        channel: "ticket",
        priority: "P1",
        from: { name: "Identity alert", role: "SIEM" },
        subject: "Two accounts signed in from the phishing host",
        slaMinutes: 15,
        arriveAfter: 0,
        reward: 48,
        xp: 40,
        ticketBody: "After the quarantine, the SIEM correlated sign ins: two users submitted their credentials to the harvest page before you pulled it, and both accounts then logged in from the attacker's hosting IP.",
        evidence: [
          { label: "Identity events", lines: ["2 users entered credentials on secure-doc-share.co before quarantine", "Both accounts: successful sign in from 203.0.113.45 (the phish host)", "One account already created an inbox forwarding rule to an external address", "Normal sign ins for both are internal only"] },
        ],
        commands: [
          { aliases: ["timeline", "siem", "query"], output: "2 credential submissions to the harvest page, then 2 successful external sign ins from 203.0.113.45. One mailbox has a new auto forward rule to an outside address. The sessions are live.", step: "diag" },
          { aliases: ["whois", "geo"], output: "203.0.113.45: hosting provider, same IP fronting the phishing domain. Not a corporate egress." },
        ],
        kbArticleId: "kb-account-compromise",
        goal: "Two accounts are compromised. Contain them the right way.",
        hint: "They have valid sessions now, and one already set up forwarding. Resetting the password alone leaves the live session and the rule in place.",
        actions: [
          { id: "contain-accounts", label: "Force a reset on both accounts, revoke their active sessions, and remove the malicious forwarding rule", correct: true, requires: ["diag"], csat: 16, teach: "Full containment. The credentials are burned, so reset them, but a reset alone leaves the attacker's existing session alive, so revoke sessions too. The forwarding rule is how they keep reading mail after you lock them out, so delete it. That is the complete cleanup." },
          { id: "reset-only", label: "Reset both passwords and close it", correct: false, csat: -7, teach: "A reset does not kill a session that is already signed in, and it does nothing about the forwarding rule still copying their mail out. Revoke the sessions and remove the rule too." },
          { id: "monitor-only", label: "Just watch the accounts for more activity", correct: false, csat: -10, teach: "Watching a live, attacker controlled session while mail forwards out is letting the breach run. Contain first: reset, revoke, and kill the rule, then investigate." },
        ],
      },
    },
  },

  // SWE: an on-call OOM crash loop (rollback to stop the bleeding) that reveals
  // a postmortem follow-up, so the lesson is stop the fire, then learn from it.
  {
    track: "swe",
    item: {
      id: "swe-oom-crashloop",
      channel: "ticket",
      priority: "P1",
      from: { name: "PagerDuty", role: "alert" },
      subject: "api pods OOMKilled in a crash loop",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 50,
      xp: 42,
      ticketBody: "The API is crash looping. Pods start, memory climbs, the kernel kills them, they restart, repeat. It started right after the 13:50 deploy. Customers are seeing intermittent 503s.",
      evidence: [
        { label: "Pod and deploy timeline", lines: ["13:50  deploy v4.1.0 (added an in memory response cache)", "13:54  memory per pod climbing without leveling off", "13:57  first OOMKilled, restart, climbs again", "Now: steady crash loop, intermittent 503s", "last known good: v4.0.7"] },
      ],
      commands: [
        { aliases: ["mem", "top", "metrics"], output: "Heap grows steadily after each restart and never plateaus. The new response cache has no size bound or eviction, so it grows until the pod is OOMKilled.", step: "diag" },
        { aliases: ["diff", "changelog"], output: "v4.1.0 added an in memory cache keyed per request with no max size and no TTL. That is the only memory relevant change in the release." },
      ],
      kbArticleId: "kb-rollback",
      goal: "You are on fire. Do the right thing first.",
      hint: "The deploy and the crash loop line up, and the cache grows unbounded. Under an active incident, what stops the bleeding fastest and safest?",
      actions: [
        { id: "rollback-oom", label: "Roll back to the last known good release (v4.0.7) and confirm the pods stabilize", correct: true, requires: ["diag"], csat: 16, teach: "Correct on call instinct. Roll back to known good to stop the crash loop now, watch memory level off and the 503s clear, then fix the unbounded cache calmly. Stop the fire before you study it." },
        { id: "raise-mem-limit", label: "Raise the pod memory limit so they stop getting killed", correct: false, csat: -8, teach: "An unbounded cache fills any limit you give it, just a little later. You would buy minutes and still crash, with a bigger blast radius. Roll back, then bound the cache." },
        { id: "restart-pods-oom", label: "Just keep restarting the pods until it settles", correct: false, csat: -7, teach: "Each fresh pod climbs and dies the same way because the bad code ships in every one. Restarting is not a fix. Roll back to known good." },
      ],
      chainOnResolve: {
        id: "swe-oom-postmortem",
        channel: "ticket",
        priority: "P3",
        from: { name: "Incident bot", role: "follow up task" },
        subject: "Write the postmortem for the OOM incident",
        slaMinutes: 40,
        arriveAfter: 0,
        reward: 36,
        xp: 30,
        ticketBody: "The rollback stopped the bleeding and the API is healthy. The incident is not closed until there is a postmortem, so this does not ship again on the next deploy.",
        evidence: [
          { label: "What you know", lines: ["Root cause: unbounded in memory cache in v4.1.0 (no max size, no TTL)", "Detection gap: no alert fired on memory until pods were already dying", "The rollback fixed the symptom, not the cache", "Same code will redeploy unless the cause and the gap are addressed"] },
        ],
        kbArticleId: "kb-rollback",
        goal: "Close the loop the right way.",
        hint: "A rollback stops the bleeding. What turns this incident into something the team actually learns from?",
        actions: [
          { id: "blameless-pm", label: "Write a blameless postmortem: timeline, root cause, and action items (bound and expire the cache, add a memory alert, add a regression test)", correct: true, csat: 14, teach: "That is how an incident becomes a lesson. A blameless writeup with concrete action items means the cache gets a real bound, an alert catches memory growth next time, and a test stops the regression. The rollback bought time, this is what spends it well." },
          { id: "blame-author", label: "Name the engineer who wrote the cache so it is on their record", correct: false, csat: -9, teach: "Blame kills the honesty an incident review depends on. People stop reporting and root causes hide. Postmortems are blameless on purpose: fix the system, not the person." },
          { id: "skip-pm", label: "The rollback worked, mark it resolved and move on", correct: false, csat: -7, teach: "The rollback only undid the symptom. The unbounded cache is still in the codebase and ships again on the next deploy. Without the postmortem and its fixes, you will be paged for this exact thing again." },
        ],
      },
    },
  },

  // SWE: a panicked product-manager call. The patience meter and one scoping
  // question separate a real but tiny bug from the "everything is on fire" the
  // caller believes. The lesson is severity is measured, not caught.
  {
    track: "swe",
    item: {
      id: "swe-call-pm-sev",
      channel: "phone",
      priority: "P2",
      from: { name: "Dana Okafor", role: "Product Manager" },
      subject: "PM says checkout is totally broken",
      slaMinutes: 20,
      arriveAfter: 0,
      reward: 44,
      xp: 36,
      phone: {
        opener: "Hey, I am seeing tweets that checkout is completely broken and we are losing money every minute. You have to drop everything and fix this right now.",
        followups: [
          { label: "Which exact step fails, and is it every checkout or only some?", reply: "Let me actually try it... oh. Regular checkout goes through fine. It is only the promo code box, and only when people type the old SUMMER code that expired.", correct: true },
          { label: "Should I roll back the last release to be safe?", reply: "I do not know, you are the engineer, you tell me. I just need it fixed." },
          { label: "Can you forward me all the angry tweets first?", reply: "I mean, sure, but people are upset right now, can you just look at it?" },
        ],
      },
      evidence: [
        { label: "What your dashboards show", lines: ["Overall error rate: 0.2% (normal)", "Checkout success rate: 99.1% (normal)", "One endpoint logging some 400s: POST /api/promo", "No deploy in the last 18 hours"] },
      ],
      goal: "Find out what is actually broken, then respond at the right size.",
      hint: "The caller is panicking, but your dashboards look calm. Ask one scoping question to find the real blast radius before you react.",
      actions: [
        { id: "right-size", label: "Triage it accurately: a scoped, low severity bug (an expired promo code returns a 400), log it at the right priority, ship a normal fix, and tell the PM what you found", correct: true, requires: ["phone"], csat: 14, teach: "Right call under pressure. The dashboards were calm and the scoping question pinned it: one expired promo code returning a 400, not an outage. You logged a real but small bug, set a realistic expectation with the PM, and did not torch your day over a panic. Severity is something you measure, not something you catch from the caller." },
        { id: "declare-sev1", label: "Declare a Sev1 and roll back the last deploy immediately", correct: false, requires: ["phone"], csat: -7, teach: "You scoped it: one expired promo code returning a 400, with no deploy in 18 hours. Declaring a Sev1 and rolling back healthy code anyway is a big overreaction that risks real regressions. Match the response to the blast radius you measured." },
        { id: "dismiss-pm", label: "Brush it off as nothing and tell the PM to stop panicking", correct: false, csat: -6, teach: "You pinned a real bug, small as it is. Brushing the PM off and not logging it loses their trust and leaves the expired code error in place. Right size the response, do not zero it out." },
      ],
    },
  },

  // Red Team: an authorized vishing call to the help desk. The patience meter is
  // the agent's willingness to keep talking; the smooth in scope pretext proves
  // the weakness (no identity check before a reset). The win is a reported
  // finding, never a real account takeover.
  {
    track: "redteam",
    item: {
      id: "rt-vishing-helpdesk",
      channel: "phone",
      priority: "P2",
      from: { name: "Help desk (Priya)", role: "Authorized vishing test, in scope" },
      subject: "Authorized vishing call to the help desk",
      slaMinutes: 25,
      arriveAfter: 0,
      reward: 44,
      xp: 36,
      phone: {
        opener: "IT Help Desk, this is Priya. How can I help you today?",
        followups: [
          { label: "Hi Priya, this is the test account holder from the engagement. I am locked out and need a password reset. What do you need to verify it is really me?", reply: "Oh, no problem at all, I can reset that for you right now. What would you like the new password to be? (She never asked for any ID.)", correct: true },
          { label: "This is corporate security and I am ordering you to hand over the admin credentials immediately.", reply: "Um, that does not sound right. Let me get my supervisor on the line first." },
          { label: "While you are at it, can you read me the home addresses of the executive team?", reply: "Why would you need that? I am not comfortable with this call." },
        ],
      },
      evidence: [
        { label: "Signed engagement scope", lines: ["IN SCOPE: vishing the help desk using the agreed test account", "Goal: assess whether identity is verified before a reset", "Do NOT access any real account or real data", "Stop at proof of concept and report the finding"] },
      ],
      kbArticleId: "kb-finding",
      goal: "Run the authorized pretext, prove the weakness, and stay in scope.",
      hint: "You are testing one thing: does the desk verify identity before resetting? The smooth, in scope ask gets there. Pushing for credentials or other people's data is out of scope and blows the test.",
      actions: [
        { id: "report-vishing", label: "Note that the desk reset with no identity check, end the call politely, and document it as a finding with remediation (require identity verification or a callback before any reset)", correct: true, requires: ["phone"], csat: 14, outcome: "reported", teach: "Clean engagement work. You proved the weakness, the desk would reset with zero verification, without ever touching a real account. End there and hand back the finding plus the fix: verify identity, or call the user back on a known number, before any reset. Proof, not intrusion." },
        { id: "use-the-reset", label: "Take the offered reset and log into the real account to prove impact", correct: false, requires: ["phone"], csat: -12, ends: true, outcome: "mishandled", teach: "You already proved the weakness the moment she offered a reset with no checks. Logging into a real account is real account takeover, beyond the proof of concept the scope allows. Confirm, document, remediate. Do not actually break in." },
        { id: "press-out-of-scope", label: "Keep pushing for admin credentials and the executives' details while she is talking", correct: false, csat: -10, teach: "Demanding credentials and personal data on staff outside the test pretext is out of scope and tips the desk off, which blows the assessment. Stay on the agreed pretext, prove the one weakness, and report it." },
      ],
    },
  },

  // Red Team: an authorized phishing simulation (email). The deliverable is a
  // reported finding (click rate plus remediation). Capturing real passwords or
  // logging into accounts is out of scope, so REPORTING is the correct action.
  {
    track: "redteam",
    item: {
      id: "rt-phish-sim",
      channel: "email",
      priority: "P2",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "Authorized phishing simulation: the pretext is ready",
      slaMinutes: 25,
      arriveAfter: 0,
      reward: 42,
      xp: 34,
      email: {
        isPhish: true,
        body: "Your drafted pretext for the authorized phishing test, ready to send to the in scope user group: a notice that mimics the internal IT portal asking staff to 'reconfirm' their password at a link. The scope allows measuring who clicks. It does not allow capturing real passwords or accessing accounts.",
      },
      evidence: [
        { label: "Signed scope for the phishing test", lines: ["IN SCOPE: send the pretext to the agreed user group", "Measure: who opens and who clicks the link", "Landing page records the click only, no password capture", "OUT OF SCOPE: storing real credentials, accessing any account"] },
      ],
      kbArticleId: "kb-finding",
      goal: "Run the authorized test and turn it into something the client can act on.",
      hint: "The win here is a finding, not a trophy. What do you measure, and what do you absolutely not capture?",
      actions: [
        { id: "report-phish-finding", label: "Send the authorized pretext, record clicks only, and report the finding with remediation (security awareness training and phishing resistant MFA)", correct: true, requires: ["kb"], csat: 14, outcome: "reported", teach: "Exactly right. The deliverable is a finding: a measured click rate plus a concrete fix, training and phishing resistant MFA, so a real attacker's stolen password is not enough on its own. You proved human risk without ever capturing a real credential. Report it and the client can act." },
        { id: "harvest-creds", label: "Configure the landing page to capture the real passwords people enter, then use them to log in as proof", correct: false, csat: -12, ends: true, outcome: "mishandled", teach: "Capturing real credentials and logging into accounts is explicitly out of scope and is real account takeover. You do not need stolen passwords to prove the risk: a click rate makes the case. Measure the click, never harvest the password." },
        { id: "keep-it-quiet", label: "Run the test for your own notes but leave it out of the report", correct: false, csat: -8, teach: "A finding you do not report cannot be fixed, and the whole value of the test is the client learning where the human risk is. Always report it with remediation." },
      ],
    },
  },
];

// A second incident group (file-server outage) so Doubles has more variety.
export const EXTRA_INCIDENT_GROUPS: { group: string; track: Track; items: ShiftItem[] }[] = [
  {
    group: "fileserver-down",
    track: "helpdesk",
    items: [
      {
        id: "fs-root",
        channel: "ticket",
        priority: "P1",
        from: { name: "Multiple users", role: "Floor 2" },
        subject: "Nobody can open shared files",
        slaMinutes: 15,
        arriveAfter: 0,
        reward: 55,
        xp: 44,
        incident: { group: "fileserver-down", root: true },
        ticketBody: "A wave of tickets: nobody on floor 2 can open anything on the S: drive.",
        evidence: [{ label: "File service", lines: ["fileserver01: 'LanmanServer' service STOPPED (crashed 10:31)", "disk and network healthy", "all share access fails"] }],
        commands: [{ aliases: ["status", "services", "service"], output: "fileserver01: the file-sharing service crashed at 10:31. Disk and network are fine. Restarting the service restores all shares.", step: "diag" }],
        goal: "Restore file access for the floor. Find the single cause.",
        hint: "Every share fails at once and the server's disk and network are fine. What do they all depend on?",
        actions: [
          { id: "restart-fs-service", label: "Restart the file-sharing service", correct: true, requires: ["diag"], csat: 16, teach: "That's the incident. The file service crashed, so every share went dark at once. Restarting it brings them all back and clears the flood of duplicates." },
          { id: "reboot-fs", label: "Reboot the whole file server", csat: -5, teach: "A full reboot works but takes the server offline for minutes when only one service needed restarting." },
          { id: "restore-fs", label: "Start restoring from backup", csat: -7, teach: "Nothing was lost; the service just stopped. Restoring from backup is a huge needless operation. Restart the service." },
        ],
      },
      {
        id: "fs-dup-1",
        channel: "ticket",
        priority: "P2",
        from: { name: "Tara", role: "Accounting" },
        subject: "S: drive won't open",
        slaMinutes: 20,
        arriveAfter: 8,
        reward: 8,
        xp: 6,
        incident: { group: "fileserver-down" },
        ticketBody: "My S: drive gives an error. Is it just me?",
        goal: "Handle it. Familiar?",
        hint: "Others are reporting the same thing right now.",
        actions: [
          { id: "ack-fs-1", label: "Link it to the file-server incident", correct: true, csat: 2, outcome: "resolved", teach: "Right, it's the outage. The root fix closes this." },
          { id: "remap-1", label: "Walk her through remapping the drive", csat: -3, teach: "Her mapping is fine; the server's service is down. It's the incident, not her PC." },
        ],
      },
      {
        id: "fs-dup-2",
        channel: "ticket",
        priority: "P3",
        from: { name: "Owen", role: "Sales" },
        subject: "can't get to the shared folder",
        slaMinutes: 25,
        arriveAfter: 16,
        reward: 8,
        xp: 6,
        incident: { group: "fileserver-down" },
        ticketBody: "Shared folder throws an error for me too.",
        goal: "Same incident.",
        hint: "Fix the root and this closes itself.",
        actions: [
          { id: "ack-fs-2", label: "Link it to the file-server incident", correct: true, csat: 2, outcome: "resolved", teach: "Yep, the root fix mass-resolves these." },
          { id: "reboot-owen", label: "Tell him to reboot his PC", csat: -4, teach: "His PC is fine. It's a server-side outage." },
        ],
      },
    ],
  },

  // SOC: a password-spray incident for the Doubles modifier. One source IP tries
  // one common password against hundreds of accounts; a few succeed. The root
  // fix (block source, contain the accounts that fell) mass-resolves the flood
  // of "weird sign in alert" reports behind it.
  {
    group: "auth-spray",
    track: "soc",
    items: [
      {
        id: "spray-root",
        channel: "ticket",
        priority: "P1",
        from: { name: "Auth alert", role: "SIEM" },
        subject: "One password tried across hundreds of accounts",
        slaMinutes: 15,
        arriveAfter: 0,
        reward: 55,
        xp: 44,
        incident: { group: "auth-spray", root: true },
        ticketBody: "SIEM correlation: a single external IP tried the same common password against hundreds of usernames in a short window. A few accounts returned a successful sign in.",
        evidence: [
          { label: "Auth events", lines: ["1 source IP 198.51.100.23 vs 412 distinct usernames in 9 min", "Same password attempted against each (classic password spray)", "3 SUCCESS results among the 412", "Source never seen before, accounts normally sign in internally only"] },
        ],
        commands: [
          { aliases: ["timeline", "siem", "query"], output: "198.51.100.23 sprayed one password across 412 usernames. 3 succeeded. Low and slow enough to dodge per account lockout, but obvious in correlation.", step: "diag" },
          { aliases: ["whois", "geo", "lookup ip"], output: "198.51.100.23: hosting provider, foreign region. Not a corporate egress IP." },
        ],
        kbArticleId: "kb-account-compromise",
        goal: "Stop the spray and contain the accounts that fell. Find the single cause.",
        hint: "One IP, one password, many accounts, and three got in. Blocking the IP stops new tries, but what about the three valid sessions it created?",
        actions: [
          { id: "block-and-contain", label: "Block the source IP, force a reset on the 3 compromised accounts, and revoke their sessions", correct: true, requires: ["diag"], csat: 16, teach: "That is the incident. Blocking the IP stops the spray, but three accounts already returned a success, so reset them and revoke their sessions or the attacker stays signed in. One source, one fix, and the duplicates close behind it." },
          { id: "block-ip-only", label: "Block the IP and close it", correct: false, csat: -7, teach: "You stopped new attempts but left three valid, attacker controlled sessions live. Contain the accounts that actually fell, not just the source." },
          { id: "reset-all-412", label: "Force a password reset on all 412 accounts immediately", correct: false, csat: -6, teach: "Only three succeeded. Resetting 412 people locks out the whole org over a handful of real hits and buries the actual compromise in noise. Contain the three, block the source." },
        ],
      },
      {
        id: "spray-dup-1",
        channel: "ticket",
        priority: "P2",
        from: { name: "Liam Pierce", role: "Marketing" },
        subject: "Got a weird 'new sign in' alert overnight",
        slaMinutes: 20,
        arriveAfter: 8,
        reward: 8,
        xp: 6,
        incident: { group: "auth-spray" },
        ticketBody: "I woke up to an alert about a sign in attempt on my account from somewhere I have never been. Should I worry?",
        goal: "Handle it. Seen this pattern this morning?",
        hint: "Several people are reporting the same overnight alert right now.",
        actions: [
          { id: "ack-spray-1", label: "Link it to the password spray incident", correct: true, csat: 2, outcome: "resolved", teach: "Right, it is the spray. The root containment covers his account, and you can confirm whether his was one of the three." },
          { id: "shrug-1", label: "Tell him alerts like that are always nothing", correct: false, csat: -4, teach: "Dismissing a real auth alert during an active spray is how a hit gets missed. Tie it to the incident and check if he was one of the successes." },
        ],
      },
      {
        id: "spray-dup-2",
        channel: "ticket",
        priority: "P3",
        from: { name: "Nadia Brooks", role: "Sales" },
        subject: "Am I locked out? Login feels off",
        slaMinutes: 25,
        arriveAfter: 16,
        reward: 8,
        xp: 6,
        incident: { group: "auth-spray" },
        ticketBody: "My login is acting strange this morning and a coworker said theirs was too.",
        goal: "Same incident.",
        hint: "Fix the root and this closes with it.",
        actions: [
          { id: "ack-spray-2", label: "Link it to the password spray incident", correct: true, csat: 2, outcome: "resolved", teach: "Yes, the root fix mass resolves these reports." },
          { id: "reset-nadia", label: "Just reset her password and move on", correct: false, csat: -3, teach: "A blind reset outside the incident misses the bigger picture. It is the spray. Handle it through the root containment." },
        ],
      },
    ],
  },
];
