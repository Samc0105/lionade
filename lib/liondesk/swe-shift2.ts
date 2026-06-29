import type { Shift } from "./types";

// SWE Shift 2: Cascading Failure. A harder on call rotation. Shift 1 taught the
// basics: read the trace, stop the bleeding, know when it is not your code. This
// one is the distributed systems chapter, where the bug is rarely one bad line
// and the wrong reflex makes the fire bigger: a slow memory leak that no rollback
// fixes, a database deadlock under load, retries that double charge customers, a
// cache stampede that takes the whole site down, and a feature flag that does more
// damage than any deploy. The lessons: find the real cause, fix it at the source,
// and choose the smallest safe lever.
//
// Economy note (HELD): every reward and xp value below is a DISPLAY PREVIEW only.
// The real grant is server authoritative and clamped in
// app/api/techhub/shifts/complete, where this shift's ceiling lives as
// "swe-shift-2": { maxFangs: 300 }. Until the held migration 20260626120000 is
// applied this shift banks nothing. Never grant Fangs from the client.

export const SWE_SHIFT_2: Shift = {
  id: "swe-shift-2",
  track: "swe",
  order: 1,
  name: "On-Call 2: Cascading Failure",
  rank: "Software Engineer II",
  accent: "#FFD700",
  durationSeconds: 600,
  startingBudget: 0,

  inventory: [],
  adUsers: [],

  kb: [
    {
      id: "kb-swe2-oom",
      title: "A memory leak is not a load problem or a bad deploy",
      tags: ["memory", "leak", "oom", "oncall"],
      body: [
        "If memory climbs in a straight line and never plateaus, and a restart resets it only for the climb to start again, you have a leak: something is allocated and never released. A common culprit is an in memory cache or map that grows without bound because nothing evicts old entries.",
        "Raising the memory limit only lengthens the time between crashes, and rolling back does nothing when no recent deploy introduced it. The real fix is to bound the growing structure with a maximum size and an expiry so old entries fall out. A rolling restart is a stopgap, never the cure.",
      ],
    },
    {
      id: "kb-swe2-deadlock",
      title: "Break a database deadlock with consistent lock ordering",
      tags: ["database", "deadlock", "locks", "concurrency"],
      body: [
        "A deadlock happens when two transactions each hold a row the other needs and neither can proceed, so the database kills one to break the cycle. It usually shows up only under load, when the paths overlap, and the database CPU stays low because the work is blocking, not computing.",
        "A cycle is impossible if every transaction acquires its locks in the same order. Align all code paths to take the same rows in the same sequence, and keep transactions short so locks are held briefly. Raising the statement timeout or buying a bigger database does not remove the cycle.",
      ],
    },
    {
      id: "kb-swe2-idem",
      title: "Make retries safe with idempotency",
      tags: ["idempotency", "retries", "payments", "reliability"],
      body: [
        "When a response is slow, clients retry. If the operation is not idempotent, each retry repeats the side effect, which is how one checkout becomes two or three real charges during a provider slowdown.",
        "Attach an idempotency key to the request so the server or the provider recognizes a retry as the same operation and performs it only once. Then reconcile and refund any duplicates already created. Turning off retries trades duplicates for lost work on every dropped response; making the operation idempotent keeps retries safe, which is what you want on a flaky network.",
      ],
    },
    {
      id: "kb-swe2-herd",
      title: "Tame a cache stampede (thundering herd)",
      tags: ["cache", "stampede", "thundering herd", "performance"],
      body: [
        "When a cache empties or many keys expire at once, every request misses in the same instant and stampedes the backing store with identical expensive queries. The site slows to a crawl even though real traffic is normal.",
        "Coalesce duplicate misses so a single request recomputes a key while the others wait for that result, and add jitter to expiry times so keys do not all lapse together. Restarting leaves the cache empty and invites the same herd, and scaling the database just runs the redundant work faster. Remove the duplicate work instead.",
      ],
    },
    {
      id: "kb-swe2-config",
      title: "A feature flag is the smallest safe lever",
      tags: ["feature flag", "config", "rollback", "incident"],
      body: [
        "When a single feature flag flip causes an error spike, the fastest safe fix is to flip it back off. It is configuration, not code, so the change reverts in seconds with nothing to build or deploy.",
        "Reaching for a full redeploy is slower and would often leave the flag on when the service returns, so the errors continue. Revert the exact change that caused the incident, confirm recovery, then investigate the new path calmly off the critical path.",
      ],
    },
  ],

  items: [
    {
      id: "swe2-memory-leak",
      channel: "ticket",
      priority: "P1",
      from: { name: "PagerDuty", role: "alert" },
      subject: "checkout-service restarting every few hours (OOMKilled)",
      slaMinutes: 20,
      arriveAfter: 0,
      reward: 50,
      xp: 42,
      ticketBody:
        "checkout-service keeps getting OOMKilled and restarting every few hours. Memory climbs steadily from each fresh start until the limit is hit. There has been no deploy in eight days.",
      evidence: [
        {
          label: "Memory and heap",
          lines: [
            "Memory rises in a straight line after every restart and never plateaus",
            "Heap dump: one in memory map of cart sessions grows without bound, nothing is ever evicted",
            "No deploy in eight days, so this is not a new release",
            "Raising the limit only makes each cycle longer before it crashes",
          ],
        },
      ],
      commands: [
        {
          aliases: ["heap", "profile", "dump"],
          output:
            "The heap is dominated by a cart session map that only ever grows. Entries are added on each visit and never removed or expired. This is a classic unbounded growth leak, not load and not a bad deploy.",
          step: "diag",
        },
        {
          aliases: ["deploys", "timeline"],
          output:
            "The last deploy was eight days ago, and the crashes started today and are speeding up. There is nothing to roll back to. The growth is the cause.",
        },
      ],
      kbArticleId: "kb-swe2-oom",
      goal: "Stop the crash loop by fixing what is actually leaking.",
      hint: "Memory only ever climbs and never plateaus, and nobody deployed. A bigger limit just delays the same crash. What is growing without bound?",
      actions: [
        {
          id: "bound-cache",
          label: "Bound the cart session map (add a size limit and expiry so old entries are evicted) and ship the fix",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Right cause, right fix. The leak is an in memory map that grows forever. Giving it a maximum size and an expiry lets old entries fall out, so memory plateaus instead of climbing into the limit. A rolling restart can buy a little time, but only bounding the structure ends the crash loop.",
        },
        {
          id: "raise-limit",
          label: "Raise the memory limit and move on",
          correct: false,
          csat: -8,
          teach:
            "A higher limit just means it takes longer to fill before the same OOM kill. The map still grows without bound. You bought a few hours and changed nothing about the cause. Bound the structure.",
        },
        {
          id: "rollback-blind",
          label: "Roll back to the previous release",
          correct: false,
          csat: -7,
          teach:
            "There is nothing to roll back to: the last deploy was eight days ago and the crashes started today. The on call reflex to roll back is right after a bad deploy, but this leak predates any release. Read the heap and fix the unbounded growth.",
        },
      ],
    },
    {
      id: "swe2-deadlock",
      channel: "ticket",
      priority: "P1",
      from: { name: "PagerDuty", role: "alert" },
      subject: "Orders API timing out, the database shows lock waits",
      slaMinutes: 15,
      arriveAfter: 30,
      reward: 50,
      xp: 42,
      ticketBody:
        "Under the lunchtime peak the orders API starts timing out and the database log fills with deadlock messages. Off peak it is completely fine. The database CPU is low the whole time.",
      evidence: [
        {
          label: "Database diagnostics",
          lines: [
            "Deadlock log: two transactions each hold a row the other wants, then one is killed",
            "Order code locks the orders row then the inventory row; the restock job locks inventory then orders",
            "The opposite lock order is what lets them deadlock when they overlap at peak",
            "Database CPU is low: this is lock contention, not resource pressure",
          ],
        },
      ],
      commands: [
        {
          aliases: ["deadlock", "locks", "diagnose"],
          output:
            "Two code paths take the same two locks in opposite orders. At peak they interleave, each grabs one lock, each waits on the other, and the database kills one to break the cycle. The fix is a consistent lock order, not more hardware.",
          step: "diag",
        },
        {
          aliases: ["cpu", "metrics"],
          output:
            "The database CPU sits low even during the timeouts. The bottleneck is transactions blocking on each other, not a starved machine.",
        },
      ],
      kbArticleId: "kb-swe2-deadlock",
      goal: "Stop the deadlocks at the cause.",
      hint: "Two paths grab the same two rows in opposite orders. What makes a deadlock impossible no matter how they interleave?",
      actions: [
        {
          id: "lock-order",
          label: "Make both code paths acquire the locks in the same consistent order, and keep the transactions short",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the fix. A deadlock needs a cycle, and a cycle is impossible when every transaction takes its locks in the same order. Align both paths (orders then inventory, everywhere) and shorten the transactions so they hold locks briefly. No more cycle, no more deadlock.",
        },
        {
          id: "raise-timeout",
          label: "Increase the database statement timeout so the queries do not time out",
          correct: false,
          csat: -8,
          teach:
            "A longer timeout just makes users wait longer before the same failure, and the database still kills one side of every deadlock to break the cycle. You hid the symptom and slowed everyone down. Fix the lock ordering.",
        },
        {
          id: "bigger-db",
          label: "Scale the database up to a bigger instance",
          correct: false,
          csat: -7,
          teach:
            "The CPU was low, so this was never resource bound. A bigger box deadlocks just as readily because the two paths still take their locks in opposite orders. Align the lock order instead of paying for hardware that does not help.",
        },
      ],
    },
    {
      id: "swe2-dupe-charges",
      channel: "ticket",
      priority: "P1",
      from: { name: "Support", role: "Customer Success" },
      incident: { group: "swe2-retry", root: true },
      subject: "Customers report being charged two or three times for one order",
      slaMinutes: 15,
      arriveAfter: 60,
      reward: 55,
      xp: 46,
      ticketBody:
        "A wave of customers say a single checkout charged their card more than once. It started when the payment provider got slow this morning. The charge requests are succeeding, just more than once each.",
      evidence: [
        {
          label: "Request trace",
          lines: [
            "The provider got slow, so the client timed out and automatically retried the same charge",
            "Each retry created a brand new charge because the request carried no idempotency key",
            "Provider logs show two or three identical charges, seconds apart, for one order",
            "The slowdown turned every retry into another real charge",
          ],
        },
      ],
      commands: [
        {
          aliases: ["trace", "requests", "diagnose"],
          output:
            "One slow response, the client retries, and with no idempotency key the provider treats each retry as a fresh charge. Same card, same amount, seconds apart. The retries are duplicating real charges.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-swe2-idem",
      goal: "Stop the duplicate charges and make the operation safe to retry.",
      hint: "A slow response made the client retry, and each retry charged again. What makes retrying the exact same request harmless?",
      actions: [
        {
          id: "idempotency-key",
          label: "Add an idempotency key so a retried charge is recognized as the same one, then reconcile and refund the duplicates",
          correct: true,
          requires: ["diag", "kb"],
          csat: 16,
          teach:
            "Correct. An idempotency key lets the provider see a retry as the same charge and ignore the repeat, so a slow response can never multiply into many charges. Then you reconcile the existing duplicates and refund them. Now retries are safe, which is exactly what you want when the network is flaky.",
        },
        {
          id: "disable-retries",
          label: "Turn off all client retries so nothing repeats",
          correct: false,
          csat: -9,
          teach:
            "Kill retries and a single dropped response now loses a legitimate charge instead of duplicating one. Retries exist because networks blip. The real fix is to make the charge idempotent so retrying is safe, not to remove resilience.",
        },
        {
          id: "manual-refund-forever",
          label: "Have support manually refund the duplicates as they come in",
          correct: false,
          csat: -10,
          teach:
            "Refunding by hand treats the symptom forever while every flaky moment creates new duplicate charges and angry customers. Fix the cause with an idempotency key, then clean up the backlog once.",
        },
      ],
    },
    {
      id: "swe2-retry-dup",
      channel: "ticket",
      priority: "P2",
      from: { name: "Maria", role: "Billing support" },
      incident: { group: "swe2-retry" },
      subject: "Another customer double billed on one purchase",
      slaMinutes: 25,
      arriveAfter: 66,
      reward: 8,
      xp: 6,
      ticketBody: "Yet another ticket: the customer says one order, two charges. Same story as the others coming in this morning.",
      goal: "Same root as the others?",
      hint: "Lots of one order, many charges reports landing at once. They share a cause.",
      actions: [
        {
          id: "link-retry",
          label: "Link it to the duplicate charge incident",
          correct: true,
          csat: 2,
          outcome: "resolved",
          teach: "Yes. It is the same retry without idempotency problem. The root fix plus the reconcile and refund covers this customer too.",
        },
        {
          id: "refund-only-this",
          label: "Just refund this one and close it",
          correct: false,
          csat: -4,
          teach:
            "Refunding this single customer leaves the cause running, so the next slow moment makes more duplicates. Tie it to the incident so the real fix lands once for everyone.",
        },
      ],
    },
    {
      id: "swe2-cache-stampede",
      channel: "ticket",
      priority: "P1",
      from: { name: "PagerDuty", role: "alert" },
      subject: "Site slow to a crawl right after the cache was cleared",
      slaMinutes: 15,
      arriveAfter: 100,
      reward: 50,
      xp: 42,
      ticketBody:
        "Someone cleared the cache during a routine change and the whole site immediately slowed to a crawl. Every page is timing out. The database is pinned even though traffic is normal for the time of day.",
      evidence: [
        {
          label: "What is happening",
          lines: [
            "The moment the cache emptied, every request became a cache miss at once",
            "All those misses hit the database in the same instant (a thundering herd)",
            "Identical expensive queries are running thousands of times in parallel for the same keys",
            "Traffic itself is normal; the database is pinned by the simultaneous misses",
          ],
        },
      ],
      commands: [
        {
          aliases: ["cache", "queries", "diagnose"],
          output:
            "The cache went empty, so every request missed at the same time and stampeded the database with the same few expensive queries. This is a cache stampede, a thundering herd, not a traffic spike.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-swe2-herd",
      goal: "Calm the stampede so the cache can refill without crushing the database.",
      hint: "Every request missed at the exact same moment and piled onto the database. How do you stop a thousand identical misses from all recomputing the same value at once?",
      actions: [
        {
          id: "coalesce-jitter",
          label: "Coalesce duplicate misses so one request recomputes a key while the rest wait, and stagger expiries with jittered timeouts so they never all lapse together",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the cure. Request coalescing means only one caller recomputes a missing key and everyone else reuses that result, so the database sees one query instead of thousands. Jittered expiries spread future refreshes out so the herd never forms again. The cache refills smoothly under control.",
        },
        {
          id: "just-restart",
          label: "Restart the app servers and hope the cache warms up",
          correct: false,
          csat: -8,
          teach:
            "A restart leaves the cache empty, so the instant traffic returns every request misses again and stampedes the database exactly as before. You cannot restart your way out of a herd. Coalesce the misses and jitter the expiries.",
        },
        {
          id: "scale-db",
          label: "Scale the database up to absorb the load",
          correct: false,
          csat: -7,
          teach:
            "Traffic was normal; the database is drowning in thousands of identical misses, not real demand. A bigger database just runs the same redundant queries a bit faster and still buckles. Stop the duplicate work with coalescing.",
        },
      ],
    },
    {
      id: "swe2-flag-phone",
      channel: "phone",
      priority: "P2",
      from: { name: "Teammate on call", role: "Engineer" },
      subject: "Teammate flipped a feature flag and the error rate jumped",
      slaMinutes: 20,
      arriveAfter: 140,
      reward: 44,
      xp: 36,
      phone: {
        opener:
          "hey, so i turned on the new pricing flag like five minutes ago and now we are seeing about a third of requests erroring. should i kick off a full redeploy to fix it?",
        followups: [
          {
            label: "Before we redeploy, did anything change besides the flag, and can we just switch the flag back off right now?",
            reply:
              "no, the flag was the only change, nothing was deployed. and yeah, i can toggle it off in the dashboard instantly if you think that is the move.",
            correct: true,
          },
          {
            label: "Yes, start a full redeploy of the service",
            reply:
              "ok but a redeploy takes like fifteen minutes and the flag would still be on when it comes back up, right? that does not sound like it fixes it.",
          },
          {
            label: "Just wait and see if the errors settle on their own",
            reply: "they are not settling, about a third of requests are still failing. i do not think this clears up by itself.",
          },
        ],
      },
      kbArticleId: "kb-swe2-config",
      goal: "Find the smallest safe lever and pull it.",
      hint: "Only one thing changed, and it can be undone instantly without shipping anything. What is faster and safer than a redeploy?",
      actions: [
        {
          id: "toggle-flag-off",
          label: "Turn the feature flag back off to instantly revert the change, confirm the errors clear, then debug the flag path calmly",
          correct: true,
          requires: ["phone"],
          csat: 16,
          teach:
            "Exactly. The flag was the only change and it is config, not code, so flipping it off reverts the bad behavior in seconds with nothing to build or deploy. Confirm recovery, then dig into why the new path errored, off the critical path. Smallest safe lever first.",
        },
        {
          id: "full-redeploy",
          label: "Kick off a full redeploy of the service",
          correct: false,
          csat: -8,
          teach:
            "A redeploy takes many minutes and the flag would still be on when it comes back, so the errors continue. You reached for the biggest, slowest lever when a one click config toggle undoes the exact change that caused this. Flip the flag off.",
        },
        {
          id: "wait-and-see",
          label: "Wait to see if the error rate settles",
          correct: false,
          csat: -9,
          teach:
            "About a third of requests are failing right now and the cause (the flag) is still on, so waiting just extends the outage. When you know the single change that broke it and it is instantly reversible, revert first and investigate after.",
        },
      ],
    },
  ],
};
