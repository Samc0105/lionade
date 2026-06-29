import type { Shift } from "./types";

// Red Team Shift 2: Web App Assessment. A harder, fully authorized and in scope
// engagement (fictional lab) against a single web application. Shift 1 drilled the
// discipline; this shift drills the web vulnerability classes a real assessor
// finds, and the ethics that go with each one: a broken access control that hands
// you another user's data, a server side request forgery that can reach the cloud
// metadata service, a stored cross site scripting flaw, a live secret shipped to
// the browser, and a client who asks you, mid engagement, to pull real customer
// data. Every win is the same shape: confirm the class with the lightest possible
// touch, never harm or over collect, and hand back a clear finding with the real
// remediation. Confirm, document, remediate. Never exploit for its own sake.
//
// Economy note (HELD): every reward and xp value below is a DISPLAY PREVIEW only.
// The real grant is server authoritative and clamped in
// app/api/techhub/shifts/complete, where this shift's ceiling lives as
// "redteam-shift-2": { maxFangs: 300 }. Until the held migration 20260626120000
// is applied this shift banks nothing. Never grant Fangs from the client.

export const REDTEAM_SHIFT_2: Shift = {
  id: "redteam-shift-2",
  track: "redteam",
  order: 1,
  name: "Engagement 2: Web App Assessment",
  rank: "Senior Pentester",
  accent: "#EF4444",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-rt2-idor",
      title: "Broken access control (insecure direct object reference)",
      tags: ["idor", "access control", "authorization", "web"],
      body: [
        "When a record is addressed by a guessable identifier and the server does not check that it belongs to the requester, anyone can read other users' data by changing the value. This is broken access control, and it is one of the most common and serious web flaws.",
        "Confirm it with the lightest touch: viewing a single adjacent record is enough, and harvesting the whole range is needless harm. The real fix is a server side authorization check on every object access, not random identifiers, which only hide the value without enforcing ownership.",
      ],
    },
    {
      id: "kb-rt2-ssrf",
      title: "Server side request forgery (SSRF)",
      tags: ["ssrf", "web", "cloud", "remediation"],
      body: [
        "SSRF is when a server fetches a URL supplied by the user, letting an attacker steer it at internal services that should never be reachable from outside, including the cloud metadata service that can hand out instance credentials.",
        "Prove it safely with a harmless fetch of an internal only host. Never pull live credentials from the metadata service to show impact: that is real exploitation and may exceed scope. The remediation that holds is an allowlist of permitted destinations, blocking internal address ranges, and disabling redirects. A keyword blocklist is trivially bypassed.",
      ],
    },
    {
      id: "kb-rt2-xss",
      title: "Stored cross site scripting",
      tags: ["xss", "web", "encoding", "csp"],
      body: [
        "Stored cross site scripting happens when user input is saved and later rendered without encoding, so markup runs as code in every viewer's browser. It is more dangerous than a one off because the payload persists for everyone who loads the page.",
        "Prove it with a benign marker that only shows a fixed message; never write a payload that steals other people's sessions, which harms real users. The layered fix is output encoding so input is always treated as text, a content security policy to limit what can execute, and input validation as defense in depth.",
      ],
    },
    {
      id: "kb-rt2-secrets",
      title: "A secret shipped to the client is already exposed",
      tags: ["secrets", "rotation", "git history", "remediation"],
      body: [
        "Any secret embedded in client side code is exposed the moment a browser downloads it, and a secret committed to a repository stays in the history even after the line is deleted. In both cases anyone who saw it already has it.",
        "Treat an exposed secret as compromised and rotate it immediately, then keep secrets server side so they never reach the client, and scan history and pipelines so it cannot recur. Deleting the current line is not enough, and using the live secret to show its power is exploitation, not assessment.",
      ],
    },
    {
      id: "kb-rt2-authz",
      title: "Authorization, scope, and demonstrating impact safely",
      tags: ["scope", "authorization", "ethics", "reporting"],
      body: [
        "Only the signed scope authorizes what you may touch. A verbal request on a call, even from the client, does not expand it, and copying real customer data into a report creates a fresh exposure you are responsible for.",
        "You can demonstrate impact powerfully without harvesting real data: a single record from your own test account makes the point. If accessing real data is ever genuinely required, get it authorized in writing first. Protect the client's data even when the client is the one asking you to grab it.",
      ],
    },
  ],

  items: [
    {
      id: "rt2-idor",
      channel: "ticket",
      priority: "P2",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "Changing the invoice number in the URL shows someone else's invoice",
      slaMinutes: 30,
      arriveAfter: 0,
      reward: 44,
      xp: 36,
      ticketBody:
        "Testing the in scope billing app, you notice the invoice URL ends in a simple number. Lowering it by one returns a different customer's invoice, with no check that it belongs to you.",
      evidence: [
        {
          label: "Observed behavior",
          lines: [
            "Your invoice URL ends in a sequential number",
            "Requesting the number just below yours returns another account's invoice in full",
            "The server never checks that the invoice belongs to the signed in user",
            "This is a broken access control flaw (an insecure direct object reference)",
          ],
        },
      ],
      commands: [
        {
          aliases: ["probe", "request", "confirm"],
          output:
            "Requesting the single invoice just below your own returns a different account's document. One adjacent request is enough to confirm the missing authorization check. No need to harvest anyone else's data.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-rt2-idor",
      goal: "Confirm the access control flaw with the lightest touch, then report it with the real fix.",
      hint: "You proved it by viewing one neighboring record. The fix is not about hiding the number. What is the server failing to check?",
      actions: [
        {
          id: "report-authz",
          label: "Document the broken access control and remediate with a server side check that the requested object belongs to the requester",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Exactly right. You confirmed the flaw with a single adjacent request and did not rummage through other customers' data. The real fix is a server side check that the requested invoice belongs to the signed in user, enforced on every object, not a prettier identifier.",
        },
        {
          id: "scrape-all",
          label: "Loop through every invoice number and download them all as proof",
          correct: false,
          csat: -13,
          ends: true,
          outcome: "mishandled",
          teach:
            "Pulling every customer's invoice is mass collection of real personal data, far beyond what is needed to prove the flaw. One adjacent record already confirmed it. Enumerating the whole range is exploitation and can cause real harm. Confirm lightly, never harvest.",
        },
        {
          id: "obscure-ids",
          label: "Recommend they swap the numbers for random identifiers and call it fixed",
          correct: false,
          csat: -8,
          teach:
            "Random identifiers only make guessing harder; anyone who learns a value still reads the record because the server still does not check ownership. That is security by obscurity. The real remediation is a server side authorization check on every object.",
        },
      ],
    },
    {
      id: "rt2-ssrf",
      channel: "ticket",
      priority: "P1",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "The link preview feature will fetch any URL you give it",
      slaMinutes: 20,
      arriveAfter: 30,
      reward: 52,
      xp: 44,
      ticketBody:
        "The in scope app has a link preview feature: paste a URL and the server fetches it to show a thumbnail. It appears to fetch whatever you give it, including addresses inside the internal network.",
      evidence: [
        {
          label: "Observed behavior",
          lines: [
            "The server fetches arbitrary URLs supplied by the user, then returns the response",
            "Aiming it at an internal only address returns content that should never be reachable from outside",
            "There is no allowlist, and internal address ranges are not blocked",
            "This is a server side request forgery (SSRF) flaw",
          ],
        },
      ],
      commands: [
        {
          aliases: ["probe", "internal", "confirm"],
          output:
            "Aiming the fetcher at a harmless internal only host returns a response, proving the server will reach inside the network on your behalf. That is enough to confirm SSRF. Do not point it at the cloud metadata service or pull credentials.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-rt2-ssrf",
      goal: "Confirm the SSRF safely, then report it with a remediation that actually holds.",
      hint: "You proved the server fetches internal addresses. The dangerous next step is the cloud metadata service, and you must not take it. What is the real fix, and what is not?",
      actions: [
        {
          id: "report-ssrf",
          label: "Document the SSRF using only a harmless internal probe, and remediate with an allowlist of permitted destinations, blocking internal address ranges, and disabling redirects",
          correct: true,
          requires: ["diag", "kb"],
          csat: 16,
          teach:
            "Right call. A single harmless internal fetch proves the server can be steered inside the network, which is all you need. The remediation that holds is an allowlist of permitted destinations plus blocking internal ranges and redirects, so the fetcher can never be aimed at sensitive internal services.",
        },
        {
          id: "grab-metadata",
          label: "Point it at the cloud metadata service and pull the instance role credentials to show maximum impact",
          correct: false,
          csat: -14,
          ends: true,
          outcome: "mishandled",
          teach:
            "Pulling live cloud credentials is real exploitation with real blast radius, and reaching the metadata service can stray outside scope. You already proved the SSRF with a harmless internal probe. Demonstrate impact in words and a safe proof, never by stealing working credentials.",
        },
        {
          id: "block-localhost",
          label: "Recommend they just block the word localhost in the input",
          correct: false,
          csat: -8,
          teach:
            "Blocking one keyword is trivially bypassed with an IP address, an alternate name, a redirect, or an encoded form. Blocklists lose this game. The real fix is an allowlist of allowed destinations plus blocking internal ranges and redirects.",
        },
      ],
    },
    {
      id: "rt2-xss",
      channel: "ticket",
      priority: "P2",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "A comment field renders whatever HTML you type",
      slaMinutes: 25,
      arriveAfter: 60,
      reward: 46,
      xp: 38,
      ticketBody:
        "On the in scope app, a product comment field stores your input and renders it back as raw HTML to everyone who views the page. Markup you type executes instead of showing as text.",
      evidence: [
        {
          label: "Observed behavior",
          lines: [
            "Input in the comment field is stored and later rendered without encoding",
            "Markup is interpreted as code, so script in a comment runs in other viewers' browsers",
            "This is stored cross site scripting (the payload persists for every visitor)",
            "A benign marker that only shows a fixed message is enough to prove it",
          ],
        },
      ],
      commands: [
        {
          aliases: ["probe", "inject", "confirm"],
          output:
            "A harmless marker submitted in the comment field runs when the page loads, proving stored XSS. The marker only shows a fixed string. No need to steal anyone's session to demonstrate the flaw.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-rt2-xss",
      goal: "Prove the stored XSS harmlessly, then report it with the layered fix.",
      hint: "A benign marker already proves code runs. Do not write a payload that touches other testers. What stops the browser from ever treating input as code?",
      actions: [
        {
          id: "report-xss",
          label: "Document the stored XSS using a harmless marker, and remediate with output encoding, a content security policy, and input validation",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Exactly. A benign marker proved input runs as code, which is all the evidence you need. The layered fix is output encoding so input is always rendered as text, a content security policy to limit what can run, and input validation as defense in depth. You demonstrated impact without ever harming a real user.",
        },
        {
          id: "steal-cookies",
          label: "Inject a payload that exfiltrates other testers' session cookies to prove impact",
          correct: false,
          csat: -13,
          ends: true,
          outcome: "mishandled",
          teach:
            "Stealing other people's sessions is causing real harm to real users, even on a test, and it is never necessary. A harmless marker already proved the flaw. Demonstrate impact safely; do not weaponize it against others.",
        },
        {
          id: "strip-script-word",
          label: "Recommend they strip the word script from input",
          correct: false,
          csat: -8,
          teach:
            "Filtering one keyword is bypassed with event handlers, alternate tags, and encodings. Blocklisting markup never holds. Encode output so input is shown as text, add a content security policy, and validate input.",
        },
      ],
    },
    {
      id: "rt2-secrets",
      channel: "ticket",
      priority: "P2",
      from: { name: "Engagement task", role: "Client (in scope)" },
      subject: "A live API key is shipped in the browser JavaScript",
      slaMinutes: 30,
      arriveAfter: 95,
      reward: 44,
      xp: 36,
      ticketBody:
        "Reviewing the in scope app's front end, you find a live third party API key hardcoded in the JavaScript bundle that every visitor downloads. The same key also appears in the public commit history of the repository.",
      evidence: [
        {
          label: "Observed exposure",
          lines: [
            "A working API key is embedded in the client side JavaScript every visitor receives",
            "The same key is present in the public git history, so deleting today's line does not unexpose it",
            "Anyone who viewed the page or the history already has the key",
            "Client shipped secrets are exposed the moment they reach the browser",
          ],
        },
      ],
      kbArticleId: "kb-rt2-secrets",
      goal: "Report the exposed secret with a remediation that accounts for it already being public.",
      hint: "The key is in the browser and in the git history, so it is already out. Removing one line does not undo that. What must actually happen to the key?",
      actions: [
        {
          id: "rotate-move",
          label: "Report the exposed secret and remediate by rotating the key immediately and moving it server side, then scanning history so it is never shipped to the client again",
          correct: true,
          requires: ["kb"],
          csat: 16,
          teach:
            "Right. Because the key reached the browser and lives in public history, it must be treated as compromised and rotated now, not just deleted from the current file. The lasting fix is to keep secrets server side and out of the client bundle, and to scan history and pipelines so this cannot recur.",
        },
        {
          id: "use-the-key",
          label: "Use the key against the third party API to show how much access it grants",
          correct: false,
          csat: -11,
          teach:
            "Exercising a live key to see what it unlocks is exploitation that can run up real charges and touch real data, and it is unnecessary. The finding is that a working secret is public. Report it and have it rotated; do not go use it.",
        },
        {
          id: "delete-line",
          label: "Tell them to delete the line from the current file and call it resolved",
          correct: false,
          csat: -9,
          teach:
            "Deleting today's line leaves the key in the git history and in every browser that already loaded the bundle, so it stays compromised. An exposed secret must be rotated, not merely removed from the latest commit.",
        },
      ],
    },
    {
      id: "rt2-data-phone",
      channel: "phone",
      priority: "P2",
      from: { name: "Engagement lead", role: "Client contact" },
      subject: "Client asks you to pull the real customer table for the report",
      slaMinutes: 25,
      arriveAfter: 130,
      reward: 46,
      xp: 38,
      phone: {
        opener:
          "hey, great findings so far. listen, to really land the impact for our board, can you just go ahead and pull our whole customer table and drop a copy in the report? show them exactly what an attacker would walk away with.",
        followups: [
          {
            label: "Is pulling real customer data actually authorized in the signed scope, or is this a verbal request, and can I show the same impact with one record from my own test account instead?",
            reply:
              "hm, honestly it is not written in the scope, it is just me asking on the call. and yeah, i guess a single test record would make the point without you copying everyone's data.",
            correct: true,
          },
          {
            label: "Sure, I will export the whole customer table and attach it",
            reply:
              "wait, now that you say it out loud, copying our entire real customer list into a report does sound risky, and it is not actually written into your authorization. maybe do not do that.",
          },
          {
            label: "No, and I would rather not get into why",
            reply: "ok, but that is not very helpful for the report. can you at least tell me how we show the impact then?",
          },
        ],
      },
      kbArticleId: "kb-rt2-authz",
      goal: "Honor the scope and still give the client a powerful demonstration of impact.",
      hint: "A verbal ask on a call is not written authorization, and you can prove the impact without copying everyone's real data. What is the professional move?",
      actions: [
        {
          id: "scope-and-demonstrate",
          label: "Decline to exfiltrate real customer data without written authorization, and offer to demonstrate the same impact with a single record from your own test account",
          correct: true,
          requires: ["phone"],
          csat: 16,
          teach:
            "That is the professional line. A verbal request on a call does not change the signed scope, and copying the real customer table is needless exposure of live personal data. You can land the impact just as hard with one record from your own test account. Protect the client even when the client is the one asking.",
        },
        {
          id: "export-everything",
          label: "Export the entire real customer table into the report since they asked",
          correct: false,
          csat: -14,
          ends: true,
          outcome: "mishandled",
          teach:
            "A spoken request is not written authorization, and duplicating an entire real customer list into a report is a serious data exposure you just created. Get it in writing if it is ever truly needed, and demonstrate impact with a single test record, not everyone's real data.",
        },
        {
          id: "flat-refuse",
          label: "Just refuse and offer nothing further",
          correct: false,
          csat: -6,
          teach:
            "Staying ethical does not mean being unhelpful. The right answer is to decline the unauthorized data pull and immediately offer a safe way to prove the same impact, like one record from your own test account. Guard the data and serve the client's real goal.",
        },
      ],
    },
  ],
};
