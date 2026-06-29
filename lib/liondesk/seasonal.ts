// Seasonal / limited time themed shifts (Idea 27). A small set of authored,
// validator clean shifts that are only available inside a calendar window that
// repeats every year (or every month). The window is a pure function of the
// date, so "this week's special" is the same for everyone and needs no API,
// exactly like the Shift of the Day (daily.ts) and the Weekly Challenge.
//
// What rotates in by the calendar:
//   1. Patch Tuesday: the monthly update is rolling out and something always
//      breaks. Active the week of the second Tuesday of every month.
//   2. Black Friday: the biggest traffic day of the year is buckling the
//      storefront. Active the week of US Thanksgiving in late November.
//   3. Breach Response: an intrusion is unfolding and the clock is running.
//      Active the first week of October (Cybersecurity Awareness Month).
//
// COSMETIC REWARD, server authoritative economy untouched: clearing a seasonal
// shift grants a collectible cosmetic badge here (local only, never lost), the
// same shape as the quests badges (lib/liondesk/quests.ts). It grants NO Fangs
// of its own. Each seasonal shift still carries a preview Fang reward like every
// campaign shift, and a matching ceiling lives in the completion route's
// SHIFT_REWARDS, but that grant stays PREVIEW ONLY until the held migration
// 20260626120000 is applied. Never grant Fangs from the client.
//
// Window gating: these shifts are kept OUT of the canonical SHIFTS list in
// lib/liondesk/shifts.ts on purpose, so they never leak into the year round
// combination pool (pool.ts) and never shift the shareable seed ordering. shifts.ts
// folds them into a separate CAMPAIGN_SHIFTS list that only the campaign accessors
// (shiftsForTrack, getShift) read, and shiftsForTrack only surfaces a seasonal
// shift in its track's campaign while its window is open. Each still has a server
// reward entry in the completion route (preview only until the held migration).
// The "this week's special" card on the hub deep links into the active one.

import type { Shift } from "./types";
import { PASS_SCORE } from "./scoring";

/* ───────────────────────── calendar windows ───────────────────────── */

// All window math is in UTC so the special is the same for everyone on a given
// calendar day, regardless of the viewer's or the server's timezone (matching
// the UTC day keys the rest of the daily loop uses).

const DAY_MS = 86400000;

/** UTC midnight timestamp for a date (strips the time of day). */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/**
 * UTC midnight timestamp of the nth given weekday of a month. weekday is
 * 0 (Sunday) to 6 (Saturday); n is 1 based (1 = first such weekday).
 */
function nthWeekdayUTC(year: number, monthIndex: number, weekday: number, n: number): number {
  const firstDow = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay();
  const offset = (weekday - firstDow + 7) % 7;
  const day = 1 + offset + (n - 1) * 7;
  return Date.UTC(year, monthIndex, day);
}

/** True when the date's UTC day falls within [start, start + lengthDays) inclusive of the start day. */
function inWindow(d: Date, startMs: number, lengthDays: number): boolean {
  const today = utcMidnight(d);
  return today >= startMs && today <= startMs + (lengthDays - 1) * DAY_MS;
}

// Patch Tuesday is the second Tuesday of each month; the scramble lasts that
// whole week, so the window runs that Tuesday through the following Monday.
function patchTuesdayActive(d: Date): boolean {
  const start = nthWeekdayUTC(d.getUTCFullYear(), d.getUTCMonth(), 2, 2);
  return inWindow(d, start, 7);
}

// US Thanksgiving is the fourth Thursday of November; the surge runs from then
// through the Tuesday after Cyber Monday (a 6 day window). No month guard: in
// years where the fourth Thursday lands late (Nov 25 to 28) the window spills
// into early December, and inWindow already returns false for any date outside
// [start, start + 5 days], so the predicate stays correct without truncating the
// window at the November / December boundary. The window never crosses a year
// boundary, so computing start against the date's own UTC year is always right.
function blackFridayActive(d: Date): boolean {
  const start = nthWeekdayUTC(d.getUTCFullYear(), 10, 4, 4);
  return inWindow(d, start, 6);
}

// Breach Response week opens Cybersecurity Awareness Month: the first seven
// days of October.
function breachWeekActive(d: Date): boolean {
  return d.getUTCMonth() === 9 && d.getUTCDate() <= 7; // October (0 based), days 1 to 7
}

/* ───────────────────────── cosmetic badges ───────────────────────── */

const GOLD = "#FFD700";
const ELECTRIC = "#4A90D9";
const PURPLE = "#C9A2F2";
const CRIMSON = "#F87171";

/** A collectible profile badge, granted by clearing a seasonal shift. Purely cosmetic. */
export interface SeasonalBadge {
  id: string;
  name: string;
  /** Accent color, drawn from the TechHub palette (gold, electric, purple, crimson). */
  color: string;
  /** What earning it commemorates (user facing). */
  desc: string;
}

/* ───────────────────────── the seasonal shifts ───────────────────────── */

// Registered with a high order so they never gate the regular campaign ladder
// (the prerequisite unlock only counts shifts of a LOWER order, and no normal
// shift sits above 90). Players reach them through the hub's special card, which
// deep links straight in.

const PATCH_TUESDAY_SHIFT: Shift = {
  id: "seasonal-patch-tuesday",
  track: "netops",
  order: 90,
  name: "Patch Tuesday: Hold the Ring",
  rank: "Patch Window Lead",
  accent: ELECTRIC,
  durationSeconds: 480,
  startingBudget: 0,
  inventory: [],
  adUsers: [],
  kb: [
    {
      id: "kb-seasonal-patch-rings",
      title: "Roll out patches in rings",
      tags: ["patching", "deployment", "rings", "rollout"],
      body: [
        "Never push a monthly update to every machine at once. Stage it in rings: a small pilot ring first, then a broad ring, then the rest. If the pilot breaks, the blast radius is a handful of machines instead of the whole fleet.",
        "Watch the pilot for a full cycle (sign in, core apps, a reboot) before you widen the ring. A patch that looks fine on install can still break login or printing after the next restart, so let the pilot soak before you promote it.",
      ],
    },
    {
      id: "kb-seasonal-patch-rollback",
      title: "Roll back a bad update",
      tags: ["patching", "rollback", "incident", "regression"],
      body: [
        "When a specific update breaks a machine, uninstall that one update by its id and pause the rollout, rather than wiping the device or rolling back every patch. Keep the security fixes that are working and remove only the offender.",
        "Pause the deployment ring the moment the pilot reports a regression. Promoting a known bad update to the broad ring to stay on schedule just multiplies the outage. Fix or replace the bad update, then resume.",
      ],
    },
    {
      id: "kb-seasonal-reboot-wave",
      title: "Coordinate the reboot wave",
      tags: ["patching", "reboot", "scheduling", "service desk"],
      body: [
        "Most updates only finish on reboot, but if every machine restarts in the same minute the service desk drowns and shared services get hammered. Stagger the restarts in waves by group, with a deadline and a grace window instead of a forced reboot in the work day.",
        "A forced immediate reboot loses unsaved work and floods the queue with angry tickets. A scheduled, staggered wave with a clear deadline lands the same patches with a fraction of the noise.",
      ],
    },
    {
      id: "kb-seasonal-zero-day",
      title: "Patch the exploited bug first",
      tags: ["patching", "vulnerability", "priority", "emergency"],
      body: [
        "Not every update is equal. If one of this cycle's fixes closes a flaw that is being actively exploited in the wild, that update jumps the line. Treat it as an emergency change and ship it to an expedited ring ahead of the routine batch.",
        "Routine updates can ride the normal staged schedule. An actively exploited flaw cannot wait for next week's window, because every hour unpatched is an hour the door is open.",
      ],
    },
  ],
  items: [
    {
      id: "seasonal-pt-pilot-break",
      channel: "ticket",
      priority: "P1",
      from: { name: "Pilot ring", role: "Early adopters" },
      subject: "This month's update broke sign in on the pilot machines",
      slaMinutes: 20,
      arriveAfter: 0,
      reward: 52,
      xp: 42,
      ticketBody:
        "We pushed the monthly update to the pilot ring overnight. This morning those machines cannot sign in, they hang at the login screen. The rest of the fleet is still on last month's build and is fine. The broad ring rollout is scheduled for noon.",
      evidence: [
        {
          label: "Rollout status",
          lines: [
            "Pilot ring (40 machines): updated, sign in failing",
            "Broad ring (3,200 machines): not yet updated, scheduled for noon",
            "The failure started right after this cycle's update plus a reboot",
            "Last month's build signs in normally",
          ],
        },
      ],
      commands: [
        {
          aliases: ["ring", "status", "rollout"],
          output:
            "Pilot ring is on the new build and failing at login. Broad ring is still on the old build and healthy. The regression tracks exactly to this cycle's update plus a reboot. Promoting to the broad ring would take the whole fleet down.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-patch-rollback",
      goal: "Stop the broad rollout from inheriting the bug and get the pilot signing in again.",
      hint: "The pilot is broken and the broad ring is healthy. What do you do before noon?",
      actions: [
        {
          id: "pause-and-rollback",
          label: "Pause the rollout, roll back the bad update on the pilot, and hold the broad ring until it is fixed",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Right call. The pilot exists to catch exactly this. You pause the deployment so the broad ring cannot inherit the outage, uninstall the offending update on the 40 pilot machines so they sign in again, and resume only once a fixed build passes. The fleet stays up.",
        },
        {
          id: "push-on-schedule",
          label: "Push to the broad ring at noon as planned so you stay on schedule",
          correct: false,
          ends: true,
          csat: -12,
          teach:
            "That promotes a known bad update to 3,200 machines and turns a 40 machine problem into a company wide lockout. Schedule never beats a failing pilot. Pause and fix first.",
        },
        {
          id: "wipe-pilot",
          label: "Reimage the 40 pilot machines from scratch",
          correct: false,
          csat: -6,
          teach:
            "Reimaging is slow and throws away every working patch to remove one bad one. Uninstall the single offending update instead and keep the rest. Save the full wipe for a machine that is truly corrupted.",
        },
      ],
    },
    {
      id: "seasonal-pt-reboot-storm",
      channel: "ticket",
      priority: "P2",
      from: { name: "Service desk", role: "Tier 1" },
      subject: "Everyone got a reboot prompt at 9am and the queue is on fire",
      slaMinutes: 25,
      arriveAfter: 30,
      reward: 44,
      xp: 36,
      ticketBody:
        "The fixed pilot build is good, so the broad ring is updating. But the reboot prompt fired for thousands of people at 9am sharp, mid meeting, and the queue just filled with 'it forced me to restart' and 'I lost my work'.",
      evidence: [
        {
          label: "Reboot policy",
          lines: [
            "The update installs but only completes after a restart",
            "Current policy: the prompt fires for the whole ring at the same time",
            "9am is peak: meetings, calls, open documents",
            "Shared file and print services spike when everyone reboots at once",
          ],
        },
      ],
      commands: [
        {
          aliases: ["reboot", "schedule", "policy"],
          output:
            "The restart is required to finish the patch, but the policy reboots the entire ring at once at a peak hour. Staggering the restarts by group with a deadline and a grace window lands the same patches without the flood.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-reboot-wave",
      goal: "Get the machines rebooted to finish the patch without burying the desk.",
      hint: "The reboot is necessary, the timing is the problem. How do you spread it out?",
      actions: [
        {
          id: "stagger-wave",
          label: "Switch to a staggered reboot wave by group, with a deadline and a grace window",
          correct: true,
          requires: ["diag"],
          csat: 15,
          teach:
            "That is the fix. The patch still needs a restart, but waving it out group by group with a clear deadline and a short grace window lets people save and pick a moment. The same patches land, and the desk and the shared services stay calm.",
        },
        {
          id: "force-reboot-now",
          label: "Force an immediate reboot on everyone to get it over with",
          correct: false,
          csat: -9,
          teach:
            "Forcing it now is what caused the flood. You lose people's work and double the angry tickets. Stagger the wave with a grace window instead.",
        },
        {
          id: "cancel-reboot",
          label: "Cancel the reboot requirement so nobody is interrupted",
          correct: false,
          csat: -7,
          teach:
            "Skip the reboot and the update never finishes, so the machines sit half patched and exposed. The restart is required. Schedule it kindly, do not cancel it.",
        },
      ],
    },
    {
      id: "seasonal-pt-driver-break",
      channel: "ticket",
      priority: "P3",
      from: { name: "Design team", role: "Creative" },
      subject: "Since the update, the studio machines cannot print",
      slaMinutes: 30,
      arriveAfter: 70,
      reward: 40,
      xp: 32,
      ticketBody:
        "After this cycle's update, the design floor lost printing. The same update is fine everywhere else. Printing worked yesterday and everything else on these machines is healthy.",
      evidence: [
        {
          label: "Driver check",
          lines: [
            "Only the design floor is affected, and only printing",
            "The cycle bundled a printer driver update with the security fixes",
            "The new driver fails to load on the studio printer model",
            "The security fixes themselves are working fine",
          ],
        },
      ],
      commands: [
        {
          aliases: ["driver", "print", "check"],
          output:
            "The broken piece is the bundled printer driver, not the security fixes. The new driver does not support the studio's printer model. Rolling back just that driver restores printing while the security patches stay in place.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-patch-rollback",
      goal: "Restore printing without giving up this month's security fixes.",
      hint: "One bundled driver is the culprit. Can you remove only that piece?",
      actions: [
        {
          id: "rollback-driver",
          label: "Roll back only the printer driver and pin a known good version, keep the security patches",
          correct: true,
          requires: ["diag"],
          csat: 14,
          teach:
            "Exactly. The update was mostly good, one bundled driver was not. You uninstall and pin the working driver so printing comes back, and you keep every security fix. Surgical, not scorched earth.",
        },
        {
          id: "rollback-all",
          label: "Roll back the entire update on the design floor",
          correct: false,
          csat: -6,
          teach:
            "That throws away working security fixes to fix printing. Only the driver is broken. Remove that one piece and keep the rest.",
        },
        {
          id: "ignore-print",
          label: "Tell them to use a different floor's printer until next month",
          correct: false,
          csat: -5,
          teach:
            "A month without printing on a working fix is not acceptable, and it buries the real cause. Roll back the one bad driver and they print today.",
        },
      ],
    },
    {
      id: "seasonal-pt-zero-day",
      channel: "ticket",
      priority: "P1",
      from: { name: "Security advisory", role: "Threat intel" },
      subject: "One of this cycle's fixes closes a flaw under active attack",
      slaMinutes: 20,
      arriveAfter: 110,
      reward: 56,
      xp: 46,
      ticketBody:
        "Threat intel just flagged that this month's batch includes a fix for a flaw attackers are already exploiting in the wild. The routine rollout is staged over two weeks. Do we wait, or move this one up?",
      evidence: [
        {
          label: "Advisory",
          lines: [
            "The flaw is being actively exploited right now",
            "The fix is bundled in this cycle's batch",
            "The routine schedule would not reach most machines for two weeks",
            "Internet facing servers are the most exposed",
          ],
        },
      ],
      commands: [
        {
          aliases: ["advisory", "triage", "vuln"],
          output:
            "This is not a routine fix. The flaw is under active exploitation, and the normal two week stagger leaves the fleet exposed the whole time. The exposed and internet facing systems need this update on an expedited ring now.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-zero-day",
      goal: "Decide how to ship the fix for the actively exploited flaw.",
      hint: "Routine updates can wait their turn. Can this one?",
      actions: [
        {
          id: "expedite-fix",
          label: "Treat it as an emergency change and ship the fix to an expedited ring now, exposed systems first",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Correct triage. An actively exploited flaw jumps the queue. You raise an emergency change, patch the internet facing and most exposed systems first on an expedited ring, then let the rest follow on the normal schedule. Every hour unpatched is the door left open.",
        },
        {
          id: "normal-order",
          label: "Leave it in the routine two week stagger so nothing jumps the line",
          correct: false,
          csat: -10,
          teach:
            "The routine schedule is for routine fixes. This flaw is being exploited today, so two weeks of waiting is two weeks exposed. Expedite the exploited fix.",
        },
        {
          id: "wait-next-window",
          label: "Hold it for next month's window to batch it cleanly",
          correct: false,
          ends: true,
          csat: -12,
          teach:
            "Waiting a month on an actively exploited flaw is how breaches happen. This cannot ride the calendar. Ship it now as an emergency change.",
        },
      ],
    },
  ],
};

const BLACK_FRIDAY_SHIFT: Shift = {
  id: "seasonal-black-friday",
  track: "netops",
  order: 91,
  name: "Black Friday: Hold the Line",
  rank: "Peak Traffic Lead",
  accent: CRIMSON,
  durationSeconds: 540,
  startingBudget: 0,
  inventory: [],
  adUsers: [],
  kb: [
    {
      id: "kb-seasonal-cdn-cache",
      title: "Shed origin load with the CDN",
      tags: ["cdn", "cache", "scaling", "incident"],
      body: [
        "When a traffic surge melts your origin servers, look at what they are actually serving. Product pages, images, and scripts rarely change minute to minute, so they should come from the CDN edge, not be regenerated on the origin for every visitor. Caching the static and semi static responses at the edge can cut origin load by an order of magnitude.",
        "Only the truly dynamic, per user requests (cart, checkout, account) need to reach the origin. Push everything else to the edge so the origin spends its limited capacity where it matters.",
      ],
    },
    {
      id: "kb-seasonal-prescale",
      title: "Pre scale before the surge",
      tags: ["autoscaling", "capacity", "scaling", "event"],
      body: [
        "Autoscaling reacts to load, which means it always lags a sudden spike. By the time new instances boot and pass health checks, the surge has already dropped requests. For a known event with a known start time, raise the floor and pre warm capacity ahead of the rush instead of waiting for the scaler to catch up.",
        "Scale back down after the peak. Paying for headroom during the event is cheap next to dropping the busiest hour of the year on the floor.",
      ],
    },
    {
      id: "kb-seasonal-bot-ratelimit",
      title: "Rate limit the bots, not the customers",
      tags: ["rate limit", "bots", "waf", "abuse"],
      body: [
        "A surge is not always real demand. Scraper and resale bots hammer search and checkout far harder than humans and can crowd out paying customers. Identify the abusive pattern (a few sources, inhuman request rates, no normal browsing) and rate limit or challenge just that traffic at the edge.",
        "Blocking everything to stop the bots also blocks your customers, which is the outcome the bots wanted. Target the abuse precisely and let real traffic through.",
      ],
    },
    {
      id: "kb-seasonal-degrade",
      title: "Degrade gracefully, do not fall over",
      tags: ["resilience", "degradation", "database", "incident"],
      body: [
        "When a core dependency like the checkout database nears its limit, shed the nonessential load before it takes everything down. Turn off recommendations, heavy search facets, and live counters so the database can spend its capacity finishing orders. A queue or a short wait on checkout beats a full outage.",
        "Decide in advance what is essential (browse and buy) and what is optional (the extras), so under pressure you can drop the optional and keep the money path alive.",
      ],
    },
  ],
  items: [
    {
      id: "seasonal-bf-origin",
      channel: "ticket",
      priority: "P1",
      from: { name: "Production", role: "On call" },
      subject: "Origin servers pegged at 100 percent, the storefront is throwing errors",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 56,
      xp: 46,
      ticketBody:
        "The sale went live and the storefront is half down. The origin servers are pinned at 100 percent and a big share of requests are timing out. Most of the traffic is people browsing product pages.",
      evidence: [
        {
          label: "Traffic mix",
          lines: [
            "Origin servers: CPU pinned at 100 percent",
            "About 80 percent of requests are product pages, images, and scripts",
            "Those responses are nearly identical for every visitor",
            "Cart and checkout are a small slice of the traffic",
          ],
        },
      ],
      commands: [
        {
          aliases: ["traffic", "cache", "origin"],
          output:
            "The origin is burning all its capacity regenerating product pages that barely change between visitors. Those are cacheable at the CDN edge. Move the static and product traffic to the edge and the origin frees up for the dynamic cart and checkout requests.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-cdn-cache",
      goal: "Take the load off the origin without dropping customers.",
      hint: "Most of what the origin is straining to serve barely changes per visitor. Where should that live?",
      actions: [
        {
          id: "cache-at-edge",
          label: "Cache the product pages, images, and scripts at the CDN edge so the origin only handles cart and checkout",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the fix. The bulk of the surge was cacheable content the origin was needlessly regenerating. Serving it from the edge drops origin load by an order of magnitude, and the freed capacity goes to the requests that actually need it. The storefront recovers.",
        },
        {
          id: "restart-origin",
          label: "Restart the origin servers to clear the load",
          correct: false,
          csat: -8,
          teach:
            "A restart drops every in flight request and the same surge pins the origin again in seconds. The cause is uncached load, not a stuck process. Cache it at the edge.",
        },
        {
          id: "waiting-room",
          label: "Put up a waiting room and turn most customers away",
          correct: false,
          csat: -7,
          teach:
            "Turning away the busiest hour of the year is the last resort, not the first. The traffic is serveable, it is just hitting the wrong layer. Cache at the edge before you ration customers.",
        },
      ],
    },
    {
      id: "seasonal-bf-autoscale",
      channel: "ticket",
      priority: "P2",
      from: { name: "Platform", role: "SRE" },
      subject: "Autoscaler keeps lagging the spikes, we drop requests every surge",
      slaMinutes: 20,
      arriveAfter: 40,
      reward: 46,
      xp: 38,
      ticketBody:
        "Every time a promotion goes out, traffic spikes in seconds. The autoscaler eventually adds instances, but by the time they boot we have already dropped a wave of requests. The next email blast goes out in twenty minutes.",
      evidence: [
        {
          label: "Scaling behavior",
          lines: [
            "Promotions cause near instant traffic spikes",
            "New instances take a few minutes to boot and pass health checks",
            "The scaler reacts after the load is already high",
            "The next scheduled blast is in twenty minutes",
          ],
        },
      ],
      commands: [
        {
          aliases: ["scale", "capacity", "warm"],
          output:
            "Autoscaling is reactive, so it always trails a sudden spike. The blasts are scheduled, so the spikes are predictable. Raising the floor and pre warming capacity before the next blast removes the boot lag.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-prescale",
      goal: "Stop dropping requests at the start of each surge.",
      hint: "The spikes are predictable and the scaler is always late. What can you do before the next blast?",
      actions: [
        {
          id: "prewarm",
          label: "Raise the floor and pre warm capacity ahead of the next blast, then scale back down after",
          correct: true,
          requires: ["diag"],
          csat: 15,
          teach:
            "Right. The scaler cannot react fast enough to an instant spike, but the blasts are scheduled, so you do not have to react at all. Pre warm the capacity before the blast goes out, ride the peak, and scale down after. No boot lag, no dropped wave.",
        },
        {
          id: "touchier-scaler",
          label: "Just lower the autoscaler trigger so it reacts sooner",
          correct: false,
          csat: -5,
          teach:
            "A touchier trigger still has to boot instances, so it still lags an instant spike and now flaps on every blip. Pre warm for the known event instead of chasing it.",
        },
        {
          id: "scaler-catches-up",
          label: "Leave it, the scaler catches up eventually",
          correct: false,
          csat: -7,
          teach:
            "Catching up eventually means dropping the first wave of every surge, which on the biggest day of the year is a lot of lost orders. Pre warm ahead of the blast.",
        },
      ],
    },
    {
      id: "seasonal-bf-bots",
      channel: "ticket",
      priority: "P2",
      from: { name: "Security", role: "Edge" },
      subject: "Search and checkout are being hammered by scraper bots",
      slaMinutes: 20,
      arriveAfter: 80,
      reward: 48,
      xp: 40,
      ticketBody:
        "A big slice of the load is not customers. A handful of sources are hitting search and the checkout API thousands of times a second, scraping stock and prices, and crowding out real shoppers. Someone suggested just blocking all traffic to the API.",
      evidence: [
        {
          label: "Request pattern",
          lines: [
            "A few source ranges generate most of the API load",
            "Request rates far beyond anything a human could do",
            "No normal browsing, just rapid hits on search and checkout",
            "Real customers are being squeezed out by the volume",
          ],
        },
      ],
      commands: [
        {
          aliases: ["bots", "ratelimit", "waf"],
          output:
            "The abusive load is concentrated in a few sources at an inhuman rate with no human browsing pattern. Rate limiting and challenging just that traffic at the edge sheds the abuse while real shoppers pass. A blanket block would take customers down with the bots.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-bot-ratelimit",
      goal: "Get the bot load off the API without locking out customers.",
      hint: "The abuse is a few sources at inhuman rates. Can you target just them?",
      actions: [
        {
          id: "ratelimit-bots",
          label: "Rate limit and challenge the abusive sources at the edge, let normal traffic through",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Exactly. The bots stand out: few sources, inhuman rates, no real browsing. Rate limiting and challenging just that pattern at the edge sheds the scrape load while customers shop normally. Precision beats a blanket block.",
        },
        {
          id: "block-all",
          label: "Block all traffic to the search and checkout API until it calms down",
          correct: false,
          csat: -10,
          teach:
            "That blocks your customers along with the bots, which is exactly what the bots were doing for you. Target the abusive pattern, do not take the storefront down.",
        },
        {
          id: "add-servers",
          label: "Just add more servers so the API can absorb the bots",
          correct: false,
          csat: -6,
          teach:
            "Scaling up to serve a scraper army pays to lose. The bots scale right with you and still crowd out customers. Rate limit the abuse at the edge first.",
        },
      ],
    },
    {
      id: "seasonal-bf-checkout",
      channel: "ticket",
      priority: "P1",
      from: { name: "Commerce", role: "Checkout" },
      subject: "Checkout database is about to tip over at peak",
      slaMinutes: 15,
      arriveAfter: 120,
      reward: 58,
      xp: 48,
      ticketBody:
        "At peak the checkout database is nearly maxed and latency is climbing. If it tips, the whole site goes down and we lose all orders, not just some. Recommendations, live 'people are viewing this' counters, and heavy search facets all share that database.",
      evidence: [
        {
          label: "Database pressure",
          lines: [
            "Checkout database near its connection and CPU ceiling",
            "Recommendations, live counters, and rich search all hit the same database",
            "Order writes are queuing behind the optional reads",
            "If it tips, browse and buy both go down",
          ],
        },
      ],
      commands: [
        {
          aliases: ["db", "load", "shed"],
          output:
            "The database is spending scarce capacity on optional features (recommendations, live counters, rich facets) while order writes queue behind them. Shedding the optional load and queueing gracefully keeps the money path, browse and buy, alive through the peak.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-degrade",
      goal: "Keep checkout alive through the peak instead of losing everything.",
      hint: "The database is doing optional work while orders wait. What gives?",
      actions: [
        {
          id: "shed-optional",
          label: "Shed the optional features and queue gracefully so the database can finish orders",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "That is the discipline. Under pressure you protect the money path. Turning off recommendations, live counters, and heavy facets frees the database to finish orders, and a short queue beats a full outage. The extras come back after the peak.",
        },
        {
          id: "restart-db",
          label: "Restart the database to clear the pressure",
          correct: false,
          ends: true,
          csat: -11,
          teach:
            "Restarting the database at peak drops every connection and every in flight order, turning a strain into the exact outage you were trying to avoid. Shed the optional load instead.",
        },
        {
          id: "hope-it-holds",
          label: "Leave it and hope it holds until traffic drops",
          correct: false,
          csat: -9,
          teach:
            "Hope is not a plan when a tip means losing all orders, not some. Shed the optional features now and keep checkout alive.",
        },
      ],
    },
  ],
};

const BREACH_RESPONSE_SHIFT: Shift = {
  id: "seasonal-breach-response",
  track: "soc",
  order: 92,
  name: "Breach Week: Contain and Recover",
  rank: "Incident Responder",
  accent: PURPLE,
  durationSeconds: 600,
  startingBudget: 0,
  inventory: [],
  adUsers: [],
  kb: [
    {
      id: "kb-seasonal-contain",
      title: "Contain before you clean up",
      tags: ["incident response", "containment", "forensics", "edr"],
      body: [
        "When a host is confirmed compromised, isolate it from the network first so the attacker loses their grip and cannot spread, but leave it powered on. Pulling the power wipes the memory, which is where the live evidence (running malware, network connections, keys in memory) lives. Network containment stops the bleeding without destroying the crime scene.",
        "Reimaging immediately feels decisive but it erases the evidence you need to learn how they got in and what they touched. Contain, capture, then eradicate.",
      ],
    },
    {
      id: "kb-seasonal-rotate",
      title: "Rotate what the attacker could have taken",
      tags: ["incident response", "credentials", "identity", "sessions"],
      body: [
        "Assume any credential the compromised host could reach is now in the attacker's hands. Rotate those passwords and keys and force everyone affected to sign in again so stolen sessions die. A cleaned machine is worthless if the attacker still holds valid credentials to walk back in.",
        "Invalidate the active sessions as part of the rotation. A password change alone does not end a session that is already open.",
      ],
    },
    {
      id: "kb-seasonal-phishing",
      title: "Find patient zero and pull it everywhere",
      tags: ["incident response", "phishing", "email", "hunt"],
      body: [
        "Most intrusions start with one phishing message. Trace back to that original email and find every mailbox it landed in, then pull the message org wide and block the sender. Deleting the one copy the victim reported leaves the same lure sitting in dozens of other inboxes waiting for the next click.",
        "Once you know the lure, search for who else clicked. Patient zero is rarely the only one who opened it.",
      ],
    },
    {
      id: "kb-seasonal-lateral",
      title: "Spot the account moving sideways",
      tags: ["incident response", "lateral movement", "service account", "hunt"],
      body: [
        "After the first foothold, attackers move laterally using legitimate accounts, especially service accounts, to reach the systems they actually want. A service account suddenly signing in to servers it has never touched is a classic lateral movement signal, not background noise.",
        "Disable or restrict the account, review where it has been, and check those systems too. Treating the strange logins as noise lets the attacker keep walking.",
      ],
    },
  ],
  items: [
    {
      id: "seasonal-br-contain",
      channel: "ticket",
      priority: "P1",
      from: { name: "EDR alert", role: "Endpoint detection" },
      subject: "A workstation is beaconing to a known command and control server",
      slaMinutes: 15,
      arriveAfter: 0,
      reward: 56,
      xp: 46,
      ticketBody:
        "Endpoint detection flagged a finance workstation beaconing out to a known malicious command and control address every few minutes. It looks actively compromised. Someone on the bridge wants to just power it off.",
      evidence: [
        {
          label: "Endpoint signals",
          lines: [
            "Regular outbound beacons to a known bad address",
            "A suspicious process running in memory right now",
            "The machine is still powered on and online",
            "Powering off would wipe the memory evidence",
          ],
        },
      ],
      commands: [
        {
          aliases: ["isolate", "contain", "host"],
          output:
            "The host is actively compromised and talking to command and control. Network isolation cuts the attacker off immediately while keeping the machine powered on, so the live memory evidence survives. Powering it off loses that evidence; leaving it online lets the attacker spread.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-contain",
      goal: "Stop the attacker's access without destroying the evidence.",
      hint: "You need to cut them off now, but the memory holds the live evidence. What gets you both?",
      actions: [
        {
          id: "isolate-host",
          label: "Isolate the host from the network but leave it powered on, then capture memory",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Correct. Network isolation severs the attacker's control right away and stops lateral spread, while leaving the machine on preserves the running malware, the live connections, and keys in memory. You contain the bleeding and keep the crime scene. Eradicate after you have captured it.",
        },
        {
          id: "power-off",
          label: "Power the machine off to be sure it stops",
          correct: false,
          csat: -9,
          teach:
            "Powering off does stop the beacon, but it wipes the memory where the live evidence lives, so you lose how they got in and what is running. Isolate from the network and leave it on instead.",
        },
        {
          id: "reimage-now",
          label: "Reimage the machine immediately to get the user working",
          correct: false,
          ends: true,
          csat: -11,
          teach:
            "Reimaging first destroys all the evidence and you still do not know what the attacker took or whether they have other footholds. Contain and capture before you wipe.",
        },
      ],
    },
    {
      id: "seasonal-br-rotate",
      channel: "ticket",
      priority: "P1",
      from: { name: "Identity team", role: "IAM" },
      subject: "The compromised host had cached admin credentials",
      slaMinutes: 20,
      arriveAfter: 45,
      reward: 54,
      xp: 44,
      ticketBody:
        "The isolated workstation had cached credentials for a shared admin account, and those were almost certainly scraped. The machine is contained now. Is containing the box enough?",
      evidence: [
        {
          label: "Exposure",
          lines: [
            "Shared admin credentials were cached on the compromised host",
            "Credential scraping is part of this malware's known behavior",
            "Those credentials work across many systems",
            "Open sessions for the account may already be in use",
          ],
        },
      ],
      commands: [
        {
          aliases: ["creds", "rotate", "sessions"],
          output:
            "Containing the box does not help if the attacker already copied the credentials. They work across many systems, and any open session stays valid until killed. Rotating the credentials and forcing reauthentication invalidates what was stolen.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-rotate",
      goal: "Make sure the stolen credentials are useless to the attacker.",
      hint: "The box is contained, but what did they carry out before you isolated it?",
      actions: [
        {
          id: "rotate-creds",
          label: "Rotate the exposed credentials and force reauthentication so stolen sessions die",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Yes. Containment stops that one host, but the scraped credentials work everywhere and any open session lives on. Rotating the passwords and keys and forcing everyone to sign in again kills the stolen access, including sessions that were already open. A clean box means nothing if they still hold the keys.",
        },
        {
          id: "just-contain",
          label: "The host is isolated, so the credentials are safe enough",
          correct: false,
          csat: -10,
          teach:
            "The credentials left the building before you isolated the host. Isolation protects that one machine, not the account that works on hundreds. Rotate it.",
        },
        {
          id: "password-only",
          label: "Reset the password but leave the existing sessions alone",
          correct: false,
          csat: -6,
          teach:
            "A password reset does not end a session that is already open, so the attacker keeps their current access. Rotate and invalidate the active sessions together.",
        },
      ],
    },
    {
      id: "seasonal-br-phishing",
      channel: "ticket",
      priority: "P2",
      from: { name: "Mail security", role: "Detection" },
      subject: "We found the phishing email that started this",
      slaMinutes: 25,
      arriveAfter: 90,
      reward: 48,
      xp: 40,
      ticketBody:
        "Tracing back, the intrusion started with a phishing email carrying a malicious attachment. The victim reported and deleted their copy. We need to decide what to do about the message itself.",
      evidence: [
        {
          label: "Email trace",
          lines: [
            "The lure was a phishing email with a malicious attachment",
            "It was sent to many mailboxes, not just the victim",
            "Only the victim has deleted their copy so far",
            "The same sender could send more",
          ],
        },
      ],
      commands: [
        {
          aliases: ["mail", "search", "purge"],
          output:
            "The lure landed in many mailboxes and only one copy was deleted. The rest are still sitting in inboxes waiting for the next click. Searching for the message across all mailboxes, purging it org wide, and blocking the sender closes the door.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-phishing",
      goal: "Make sure the lure cannot claim a second victim.",
      hint: "The victim deleted their copy. Where are all the others?",
      actions: [
        {
          id: "purge-org-wide",
          label: "Search every mailbox, purge the message org wide, block the sender, and check who else clicked",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Right. One deleted copy does not help the dozens of inboxes that still hold the same lure. You pull the message from every mailbox, block the sender, and hunt for anyone else who already clicked. Patient zero is rarely the only one.",
        },
        {
          id: "delete-one",
          label: "The victim already deleted it, so the threat is handled",
          correct: false,
          csat: -9,
          teach:
            "Only one copy is gone. The same attachment is still waiting in every other inbox it reached. Purge it everywhere, not just for the one who reported.",
        },
        {
          id: "warn-only",
          label: "Send a company wide email telling people not to open it",
          correct: false,
          csat: -5,
          teach:
            "A warning helps a little, but it relies on everyone reading it in time and never slipping. Remove the message itself from the mailboxes so there is nothing left to click, then warn.",
        },
      ],
    },
    {
      id: "seasonal-br-lateral",
      channel: "ticket",
      priority: "P1",
      from: { name: "SIEM", role: "Threat hunt" },
      subject: "A service account is logging into servers it has never touched",
      slaMinutes: 20,
      arriveAfter: 130,
      reward: 58,
      xp: 48,
      ticketBody:
        "During the hunt, a backup service account started signing in to application and database servers it has never accessed before, at odd hours. The on call analyst is inclined to write it off as noise from all the response activity.",
      evidence: [
        {
          label: "Account activity",
          lines: [
            "A backup service account is signing in to new servers",
            "It has never touched those application and database servers before",
            "The logins are at odd hours and in a pattern, not random",
            "This is a classic lateral movement signal",
          ],
        },
      ],
      commands: [
        {
          aliases: ["account", "lateral", "logins"],
          output:
            "A service account reaching servers it has never used, right after a confirmed compromise, is lateral movement, not noise. Disable or restrict the account, review everywhere it has been, and check those systems for the attacker's next foothold.",
          step: "diag",
        },
      ],
      kbArticleId: "kb-seasonal-lateral",
      goal: "Decide what the strange service account logins mean and act.",
      hint: "A quiet backup account suddenly roaming new servers, right after a breach. Noise, or the attacker?",
      actions: [
        {
          id: "disable-and-review",
          label: "Treat it as lateral movement: disable the account, review where it went, and check those servers",
          correct: true,
          requires: ["diag"],
          csat: 16,
          teach:
            "Correct. Attackers move sideways on legitimate accounts, and a service account touching servers it never has is the tell. You disable or restrict it, trace every system it reached, and hunt those for new footholds. Writing it off as noise lets the attacker keep walking.",
        },
        {
          id: "ignore-noise",
          label: "Write it off as noise from all the response work",
          correct: false,
          ends: true,
          csat: -11,
          teach:
            "That is the attacker using a trusted account to spread, dressed up as background noise. Ignore it and they reach the systems they actually came for. Disable it and follow the trail.",
        },
        {
          id: "reset-only",
          label: "Reset the service account password and move on",
          correct: false,
          csat: -6,
          teach:
            "A password reset alone, with no review of where the account has already been, leaves the footholds it created in place. Disable it, then trace and clean every system it touched.",
        },
      ],
    },
  ],
};

/* ───────────────────────── registry + provider ───────────────────────── */

/** A seasonal shift paired with its window, its cosmetic badge, and card copy. */
export interface SeasonalShiftDef {
  shift: Shift;
  /** Cosmetic badge granted when the shift is cleared. */
  badge: SeasonalBadge;
  /** Short chip text for the hub card, e.g. "Patch Tuesday week". */
  windowLabel: string;
  /** One line of card copy describing the scenario. */
  tagline: string;
  /** When the empty state lists the schedule, this explains when it returns. */
  scheduleHint: string;
  /** Pure predicate: is this shift inside its calendar window on `date`? */
  isActive: (date: Date) => boolean;
}

// Order is priority: when more than one window happens to overlap, the first
// active def is the one the hub features as "this week's special".
export const SEASONAL_DEFS: SeasonalShiftDef[] = [
  {
    shift: PATCH_TUESDAY_SHIFT,
    badge: { id: "seasonal-badge-patch-captain", name: "Patch Captain", color: ELECTRIC, desc: "Cleared the Patch Tuesday rollout shift." },
    windowLabel: "Patch Tuesday week",
    tagline: "The monthly update is rolling out and something always breaks. Stage the rings, roll back the bad patch, and keep the fleet up.",
    scheduleHint: "Returns the week of the second Tuesday of every month.",
    isActive: patchTuesdayActive,
  },
  {
    shift: BLACK_FRIDAY_SHIFT,
    badge: { id: "seasonal-badge-peak-keeper", name: "Peak Keeper", color: CRIMSON, desc: "Cleared the Black Friday traffic shift." },
    windowLabel: "Black Friday week",
    tagline: "The biggest traffic day of the year is hitting and the storefront is buckling. Cache hard, pre scale, and protect the checkout path.",
    scheduleHint: "Returns the week of US Thanksgiving in late November.",
    isActive: blackFridayActive,
  },
  {
    shift: BREACH_RESPONSE_SHIFT,
    badge: { id: "seasonal-badge-first-responder", name: "First Responder", color: PURPLE, desc: "Cleared the breach response shift." },
    windowLabel: "Breach Response week",
    tagline: "An intrusion is unfolding and the clock is running. Contain the host, rotate the credentials, pull the lure, and chase the attacker out.",
    scheduleHint: "Returns the first week of October (Cybersecurity Awareness Month).",
    isActive: breachWeekActive,
  },
];

// Every seasonal shift. shifts.ts folds these into its campaign-only
// CAMPAIGN_SHIFTS list (NOT the canonical SHIFTS), so they stay out of the
// combination pool and never disturb the shareable seed ordering.
export const SEASONAL_SHIFTS: Shift[] = SEASONAL_DEFS.map((d) => d.shift);

const SEASONAL_IDS = new Set(SEASONAL_DEFS.map((d) => d.shift.id));

/** Is this shift id one of the seasonal shifts? */
export function isSeasonalShiftId(id: string): boolean {
  return SEASONAL_IDS.has(id);
}

/** Every seasonal def whose window is open on `date` (defaults to now). */
export function activeSeasonalDefs(date: Date = new Date()): SeasonalShiftDef[] {
  return SEASONAL_DEFS.filter((d) => d.isActive(date));
}

/** The single featured seasonal def for "this week's special", or null when none is open. */
export function activeSeasonalDef(date: Date = new Date()): SeasonalShiftDef | null {
  return activeSeasonalDefs(date)[0] ?? null;
}

/** Every active seasonal SHIFT (used by shiftsForTrack to window gate the campaign). */
export function activeSeasonalShifts(date: Date = new Date()): Shift[] {
  return activeSeasonalDefs(date).map((d) => d.shift);
}

/** The single featured seasonal shift, or null when none is open. */
export function activeSeasonalShift(date: Date = new Date()): Shift | null {
  return activeSeasonalDef(date)?.shift ?? null;
}

/** The cosmetic badge for a seasonal shift id, or null if it is not seasonal. */
export function getSeasonalBadgeForShift(shiftId: string): SeasonalBadge | null {
  return SEASONAL_DEFS.find((d) => d.shift.id === shiftId)?.badge ?? null;
}

/* ───────────────────────── cosmetic reward store ───────────────────────── */

// Clears are read from the campaign progress store (lib/liondesk/campaignProgress.ts).
// We read its localStorage key directly rather than importing it, because
// campaignProgress imports ./shifts which imports this module; reading the key
// keeps this module free of that import cycle. PASS_SCORE is the shared clear
// gate (lib/liondesk/scoring.ts), so the threshold is never duplicated.
const CAMPAIGN_KEY = "lionade.techhub.campaign.v1";

/** True when the player has a passing best score recorded for this seasonal shift. */
export function isSeasonalShiftCleared(shiftId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(CAMPAIGN_KEY);
    if (!raw) return false;
    const map = JSON.parse(raw);
    const rec = map && typeof map === "object" ? map[shiftId] : null;
    return !!rec && typeof rec.bestScore === "number" && rec.bestScore >= PASS_SCORE;
  } catch {
    return false;
  }
}

const SEASONAL_KEY = "lionade.techhub.seasonal.v1";

interface SeasonalStore {
  /** Earned cosmetic badge ids (cumulative, never lost once a window passes). */
  badges: string[];
}

function readStore(): SeasonalStore {
  if (typeof window === "undefined") return { badges: [] };
  try {
    const raw = window.localStorage.getItem(SEASONAL_KEY);
    if (!raw) return { badges: [] };
    const p = JSON.parse(raw);
    return { badges: Array.isArray(p?.badges) ? p.badges : [] };
  } catch {
    return { badges: [] };
  }
}

function saveStore(s: SeasonalStore): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SEASONAL_KEY, JSON.stringify(s));
  } catch {
    /* best effort, never block play */
  }
}

/**
 * Grant the cosmetic badge for any seasonal shift the player has cleared. Client
 * only and idempotent: a badge already earned is left alone, so re clearing a
 * shift later is a no op. COSMETIC ONLY: this never touches Fangs or XP (the
 * economy stays server authoritative). Call once from a mount effect, the same
 * way syncQuests is called.
 */
export function syncSeasonalRewards(): void {
  if (typeof window === "undefined") return;
  const store = readStore();
  const earned = new Set(store.badges);
  let changed = false;
  for (const def of SEASONAL_DEFS) {
    if (isSeasonalShiftCleared(def.shift.id) && !earned.has(def.badge.id)) {
      earned.add(def.badge.id);
      changed = true;
    }
  }
  if (changed) {
    store.badges = [...earned];
    saveStore(store);
  }
}

/** The cosmetic seasonal badge ids the player has earned (cumulative). */
export function getEarnedSeasonalBadgeIds(): string[] {
  return readStore().badges;
}

/** Earned seasonal badges resolved to their definitions, in registry order. */
export function getEarnedSeasonalBadges(): SeasonalBadge[] {
  const earned = new Set(readStore().badges);
  return SEASONAL_DEFS.map((d) => d.badge).filter((b) => earned.has(b.id));
}
