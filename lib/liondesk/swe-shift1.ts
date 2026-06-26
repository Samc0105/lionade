import type { Shift } from "./types";

// SWE Shift 1: on-call. The pager is the queue. Pages and tickets land; you read
// the stack trace, the query log, the deploy timeline, and decide. Surfaces:
// case queue, the terminal (logs/queries), and the KB. No stockroom or admin.
// Teaches the on-call instincts: fix the root not the symptom, stop the bleeding
// before you debug, and know when it's not even your code.

export const SWE_SHIFT_1: Shift = {
  id: "swe-shift-1",
  track: "swe",
  order: 0,
  name: "On-Call: The Pager's Buzzing",
  rank: "Junior Engineer",
  accent: "#FFD700",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-stack-trace",
      title: "Read a stack trace to the line",
      tags: ["error", "500", "stack trace", "null"],
      body: [
        "A stack trace names the exact file and line that threw. Start there, not at the top of the request.",
        "A 'cannot read property of undefined' means something upstream was optional and you accessed it without a guard. Fix the missing guard at the source, do not wrap the whole thing in a try/catch that hides it.",
      ],
    },
    {
      id: "kb-n-plus-one",
      title: "Spot and fix an N+1 query",
      tags: ["performance", "n+1", "query", "slow"],
      body: [
        "If a request runs one query to fetch a list, then one more query per row, that is an N+1. Fifty rows means fifty-one queries.",
        "Fix it by batching: a join, or a single 'where id in (...)' prefetch. A cache or a bigger database only hides it.",
      ],
    },
    {
      id: "kb-rollback",
      title: "Rollback discipline under an incident",
      tags: ["deploy", "rollback", "incident", "oncall"],
      body: [
        "When errors spike right after a deploy, the fastest safe move is to roll back to the last known-good release. Stop the bleeding first, debug after.",
        "Hotfixing forward under fire ships another untested change into a fire. Roll back, confirm recovery, then investigate calmly.",
      ],
    },
    {
      id: "kb-upstream",
      title: "Is it us or an upstream dependency?",
      tags: ["upstream", "third party", "outage", "triage"],
      body: [
        "Before you touch your own code, check whether a dependency you call is down. If their status page is red and you did not deploy, it is not your bug.",
        "Post a status update, open a ticket with the provider, and put up graceful degradation. Do not thrash your codebase chasing someone else's outage.",
      ],
    },
  ],

  items: [
    {
      id: "swe-null-500",
      channel: "ticket",
      priority: "P1",
      from: { name: "PagerDuty", role: "alert" },
      subject: "GET /api/orders/:id throwing 500s",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 45,
      xp: 36,
      ticketBody: "Error rate on the orders endpoint just spiked. Customers can't open guest orders. Stack trace attached.",
      evidence: [
        { label: "Stack trace", lines: ["TypeError: Cannot read properties of undefined (reading 'street')", "  at orders.service.ts:42", "  order.customer.address.street", "Only fails for GUEST orders (no saved address)."] },
      ],
      commands: [
        { aliases: ["logs", "trace", "stack"], output: "orders.service.ts:42  order.customer.address.street  -> address is undefined for guest orders. No null guard.", step: "diag" },
        { aliases: ["repro", "test"], output: "Reproduces only when customer has no saved address (guest checkout). Logged-in users with an address are fine." },
      ],
      kbArticleId: "kb-stack-trace",
      goal: "Stop the 500s. Find the line and fix the cause.",
      hint: "The trace points at one line. Guest orders have no address. What's missing before you read .street?",
      actions: [
        { id: "null-guard", label: "Guard the optional access (order.customer.address?.street ?? default)", correct: true, requires: ["diag"], csat: 14, teach: "Exactly. Guest orders have no address, so reading .street blew up. A null guard at the source fixes it cleanly. That's the real bug, not a symptom." },
        { id: "swallow", label: "Wrap the handler in try/catch and return an empty 200", correct: false, csat: -7, teach: "Now the error is hidden and guests silently get broken data. Swallowing exceptions turns a loud bug into a quiet one. Fix the missing guard." },
        { id: "scale-up", label: "Scale up to more instances", correct: false, csat: -8, teach: "It's a null reference, not load. More servers just throw the same exception in parallel. Read the trace and fix the line." },
      ],
    },
    {
      id: "swe-ci-offbyone",
      channel: "ticket",
      priority: "P2",
      from: { name: "CI bot", role: "build pipeline" },
      subject: "main is red: 1 test failing",
      slaMinutes: 30,
      arriveAfter: 25,
      reward: 36,
      xp: 28,
      ticketBody: "The build is blocked. One unit test for sumRange is failing and nobody can merge.",
      evidence: [
        { label: "Failing test", lines: ["sumRange(1, 10) expected 55, received 45", "impl: for (let i = start; i < end; i++) total += i", "loop stops at 9, never adds 10"] },
      ],
      kbArticleId: "kb-stack-trace",
      goal: "Get main green the right way.",
      hint: "Expected 55, got 45. The difference is exactly the last number. Look at the loop bound.",
      actions: [
        { id: "fix-bound", label: "Fix the loop boundary to include the end (i <= end)", correct: true, csat: 12, teach: "Right. Classic off-by-one: the loop stopped one short and never added the final value. Fix the code, and the test that caught it stays honest." },
        { id: "edit-test", label: "Change the test to expect 45", correct: false, csat: -10, teach: "Never edit a test to match a bug. The test was correct; the code was wrong. You'd be shipping the off-by-one to every caller of sumRange." },
        { id: "skip-test", label: "Mark the test as skipped so CI goes green", correct: false, csat: -8, teach: "Now the bug is live and the safety net is off. A skipped test is a bug with the alarm disabled." },
      ],
    },
    {
      id: "swe-n-plus-one",
      channel: "ticket",
      priority: "P2",
      from: { name: "Dana (PM)", role: "Product" },
      subject: "The feed page takes 5 seconds to load",
      slaMinutes: 45,
      arriveAfter: 55,
      reward: 42,
      xp: 34,
      ticketBody: "Users are complaining the feed is super slow. It was fine last month. Can you look?",
      evidence: [
        { label: "Query log, GET /api/feed", lines: ["1x  SELECT * FROM posts LIMIT 50", "50x SELECT * FROM users WHERE id = ?   (one per post author)", "p95 latency: 5.1s", "DB CPU is low, it's the round trips"] },
      ],
      commands: [
        { aliases: ["query log", "queries", "explain"], output: "1 query for 50 posts, then 50 separate queries for each author. 51 round trips. Textbook N+1.", step: "diag" },
        { aliases: ["db cpu", "metrics"], output: "Database CPU 12%, memory fine. The slowness is round-trip count, not resource pressure." },
      ],
      kbArticleId: "kb-n-plus-one",
      goal: "Make the feed fast. Find why it's slow first.",
      hint: "One query for the list, then one per row. What's that pattern called, and how do you collapse it?",
      actions: [
        { id: "batch-query", label: "Batch the author lookups (join or a single WHERE id IN (...))", correct: true, requires: ["diag"], csat: 14, teach: "That's the fix. The N+1 made 51 round trips; a join or one batched IN query makes it 1 or 2. The endpoint drops from seconds to milliseconds." },
        { id: "add-cache", label: "Put a cache in front of the endpoint", correct: false, csat: -6, teach: "A cache hides the N+1 until it goes stale or misses, then the 5 seconds is back and now you have cache bugs too. Fix the query." },
        { id: "bigger-db", label: "Upgrade to a bigger database instance", correct: false, csat: -7, teach: "DB CPU was 12%. It's not resource-bound, it's round-trip-bound. A bigger box makes 51 trips just as slowly and costs more." },
      ],
    },
    {
      id: "swe-bad-deploy",
      channel: "ticket",
      priority: "P1",
      from: { name: "PagerDuty", role: "alert" },
      subject: "Error rate 18% after the 14:02 deploy",
      slaMinutes: 10,
      arriveAfter: 90,
      reward: 50,
      xp: 42,
      ticketBody: "Right after release v2.8.0 shipped, errors jumped from 0.2% to 18% and latency doubled. Everyone's pinging you.",
      evidence: [
        { label: "Timeline", lines: ["14:02  deploy v2.8.0 (added a migration + a new flag)", "14:05  error rate 0.2% -> 18%, p95 doubled", "14:06  still climbing", "last known good: v2.7.4"] },
      ],
      commands: [
        { aliases: ["timeline", "deploys", "correlate"], output: "Spike starts at 14:05, three minutes after the 14:02 deploy of v2.8.0. Strong correlation. Last known good was v2.7.4.", step: "diag" },
        { aliases: ["diff", "changelog"], output: "v2.8.0 added a DB migration and a feature flag. Either could be the cause, but you're on fire right now." },
      ],
      kbArticleId: "kb-rollback",
      goal: "You're on fire. Do the right thing first.",
      hint: "The deploy and the spike line up. Under an active incident, what stops the bleeding fastest and most safely?",
      actions: [
        { id: "rollback", label: "Roll back to the last known-good release (v2.7.4) and disable the new flag", correct: true, requires: ["diag"], csat: 16, teach: "Correct on-call instinct. Roll back to known-good to stop the bleeding immediately, confirm recovery, then root-cause the migration or flag calmly. Stop the fire before you study it." },
        { id: "hotfix-forward", label: "Write a hotfix and deploy forward", correct: false, csat: -8, teach: "You'd ship another untested change into an active incident. Forward fixes under fire often make it worse. Roll back first, debug after." },
        { id: "restart-pods", label: "Restart all the pods and hope it clears", correct: false, csat: -6, teach: "The bad code is still the bad code after a restart. Hope is not a rollback. Revert to the known-good release." },
      ],
    },
    {
      id: "swe-upstream",
      channel: "ticket",
      priority: "P2",
      from: { name: "Support", role: "Customer Success" },
      subject: "Payments are failing for everyone",
      slaMinutes: 20,
      arriveAfter: 130,
      reward: 40,
      xp: 32,
      ticketBody: "A flood of customers say checkout fails at the payment step. We didn't deploy anything today. What's going on?",
      evidence: [
        { label: "What we see", lines: ["Our code unchanged for 2 days (no deploy)", "All failures are at the call to the payment provider", "provider status page: MAJOR OUTAGE (their API down)", "Our other endpoints are healthy"] },
      ],
      commands: [
        { aliases: ["status", "deps", "check provider"], output: "Payment provider API returning 503s. Their status page shows a major outage. Our services are otherwise healthy and we did not deploy.", step: "diag" },
      ],
      kbArticleId: "kb-upstream",
      goal: "Figure out whose problem this is, then act accordingly.",
      hint: "You didn't deploy, your other endpoints are fine, and every failure is at one external call. Is this your bug?",
      actions: [
        { id: "confirm-upstream", label: "Confirm it's the provider's outage, post a status update, and open a ticket with them", correct: true, requires: ["diag"], csat: 14, teach: "Right read. It's an upstream outage, not your code. Communicate clearly, degrade gracefully, and track it with the provider. Thrashing your own codebase would waste the incident chasing a bug you don't have." },
        { id: "rollback-ours", label: "Roll back our last deploy to be safe", correct: false, csat: -7, teach: "You didn't deploy today, and the failures are all at the provider call. Rolling back your healthy code changes nothing and erodes trust in your incident judgment." },
        { id: "page-everyone", label: "Page the whole engineering org", correct: false, csat: -4, teach: "A known third-party outage doesn't need the whole org. Confirm the cause, communicate, and engage the provider. Save the all-hands for a real internal fire." },
      ],
    },
  ],
};
