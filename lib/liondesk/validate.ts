// LionDesk / TechHub content validator.
//
// A pure, READ-ONLY audit of the authored shift content. It imports the same
// data the game ships (SHIFTS, TUTORIAL_SHIFT, the combination POOL, and the
// INCIDENT_GROUPS) and returns a flat list of problems. It grants nothing,
// writes nothing, and touches no database or economy: the only side effect is
// reading source files off disk to cross-check the server reward table.
//
// Why this exists: bad content used to ship silently. The em-dash that slipped
// into user copy, or a campaign shift whose id has no server reward entry (a
// silent 400 on completion), are exactly the class of bug this catches at build
// time instead of in production. Run it with `npm run validate:shifts` (or as a
// Vitest assertion) and it must report ZERO problems before content lands.
//
// Read-only by construction: every export below either inspects in-memory
// content or reads a source file; none mutate state.

import fs from "fs";
import path from "path";

import { SHIFTS } from "./shifts";
import { TUTORIAL_SHIFT } from "./tutorial";
import { POOL, MASTER_KB, INCIDENT_GROUPS } from "./pool";
import type { Shift, ShiftItem, KbArticle } from "./types";

/** One thing wrong with the content. `where` is a human path to the offender. */
export interface ContentProblem {
  /** Stable machine code for the category (greppable, stable across messages). */
  code:
    | "missing-reward"
    | "no-correct-action"
    | "unsatisfiable-requires"
    | "kb-not-in-union"
    | "reveal-target-missing"
    | "chain-target-invalid"
    | "forbidden-dash"
    | "forbidden-currency"
    | "reward-table-unreadable";
  /** Where the problem lives, e.g. "soc-shift-2/soc-shift-2-noisy-rule". */
  where: string;
  /** Human-readable explanation of the violation. */
  message: string;
}

export interface ValidateOptions {
  /**
   * The set of shift ids the server `complete` route will accept (the keys of
   * SHIFT_REWARDS). Injectable for tests; when omitted it is parsed from the
   * route source on disk via {@link getRewardShiftIds}.
   */
  rewardShiftIds?: Set<string>;
}

/* ───────────────────────── unicode / copy rules ───────────────────────── */

// Reject the four "real" dashes only: U+2012 figure dash, U+2013 en dash,
// U+2014 em dash, U+2015 horizontal bar. The plain hyphen-minus (U+002D) and the
// hyphen / non-breaking hyphen (U+2010 / U+2011) are allowed: ids and copy like
// "HP-ACCT-2" or "scan-to-email" are fine. Use commas, periods, parentheses, or
// "to" instead of a dash in prose.
const FORBIDDEN_DASH = /[‒–—―]/;

// Currency must read as "Fangs" only, never coins / points / tokens. A naive
// word ban is wrong here: this is a cybersecurity sim, so "session token", "API
// token", "reset token", and "points at" are legitimate, frequent, and correct
// English. We flag the words only when they are used as a UNIT OF CURRENCY, the
// same shape the forbidden copy would take:
//   - the word "coin"/"coins" at all (Fangs fully replaced coins; it has no
//     legitimate use in this content),
//   - a number sitting against a unit ("50 points", "+30 tokens", "gems: 5"),
//   - a unit sitting next to a reward/economy verb ("earned ... tokens",
//     "spend your points", "points ... balance").
// This catches the real "we shipped coins instead of Fangs" regression while
// leaving the security vocabulary alone.
const CURRENCY_UNIT = "(?:coins?|points?|tokens?|gems?)";
const FORBIDDEN_CURRENCY: { label: string; re: RegExp }[] = [
  { label: "the word \"coin\" (use Fangs)", re: /\bcoins?\b/i },
  {
    label: "a number used with a currency unit (use Fangs)",
    re: new RegExp(`(?:[+\\-]?\\d[\\d,]*\\s*${CURRENCY_UNIT})|(?:${CURRENCY_UNIT}\\s*[:=]?\\s*[+\\-]?\\d)`, "i"),
  },
  {
    label: "a currency unit used in a reward/economy context (use Fangs)",
    re: new RegExp(
      `(?:earn(?:ed|s)?|reward(?:ed|s)?|balance|wallet|spend|spent|payout|claim(?:ed)?|deposit|cash(?:ed)?\\s*out)\\W+(?:\\w+\\W+){0,3}?${CURRENCY_UNIT}\\b` +
        `|${CURRENCY_UNIT}\\b\\W+(?:\\w+\\W+){0,3}?(?:earn(?:ed|s)?|reward(?:ed|s)?|balance|wallet|spend|spent|payout)`,
      "i",
    ),
  },
];

/* ───────────────────────── server reward table ───────────────────────── */

// The reward ceilings (SHIFT_REWARDS) live as a private const in the completion
// route. It is not exported, and importing the route would drag in next/server
// + the Supabase admin client, so we read its keys straight from the source.
// This is intentional: parsing the actual route file means the validator checks
// what the server WILL accept, not a copy that could drift.
const REWARD_ROUTE_REL = "app/api/techhub/shifts/complete/route.ts";

function locateRouteSource(): string | null {
  // Walk up from the current working directory so this resolves whether it runs
  // from the repo root (npm scripts, Vitest) or a nested cwd.
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    const candidate = path.join(dir, REWARD_ROUTE_REL);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** Parse the keys of the SHIFT_REWARDS object literal out of the route source. */
export function getRewardShiftIds(): Set<string> {
  const file = locateRouteSource();
  if (!file) throw new Error(`validate: could not locate ${REWARD_ROUTE_REL} from ${process.cwd()}`);
  const src = fs.readFileSync(file, "utf8");

  const marker = src.indexOf("SHIFT_REWARDS");
  if (marker === -1) throw new Error("validate: SHIFT_REWARDS not found in completion route");
  // The type annotation (Record<string, { maxFangs: number }>) contains a brace
  // too, so anchor on the assignment first, then take the literal that follows.
  const eq = src.indexOf("=", marker);
  const open = eq === -1 ? -1 : src.indexOf("{", eq);
  if (open === -1) throw new Error("validate: could not find SHIFT_REWARDS object literal");

  let depth = 0;
  let close = -1;
  for (let i = open; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close === -1) throw new Error("validate: unbalanced SHIFT_REWARDS object literal");

  const block = src.slice(open, close + 1);
  const ids = new Set<string>();
  // Keys are quoted shift ids ("helpdesk-shift-1":). The values ({ maxFangs: N })
  // hold no quoted strings, so quoted-key matching pulls exactly the shift ids.
  const keyRe = /"([^"]+)"\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = keyRe.exec(block)) !== null) ids.add(m[1]);
  return ids;
}

/* ───────────────────────── item traversal ───────────────────────── */

/** Yield every item under a list, recursing into inline chained follow-ups. */
function* walkItems(items: ShiftItem[], basePath: string): Generator<{ item: ShiftItem; where: string }> {
  for (const item of items) {
    const where = `${basePath}/${item.id ?? "<no-id>"}`;
    yield { item, where };
    if (item.chainOnResolve) yield* walkItems([item.chainOnResolve], `${where}~onResolve`);
    if (item.chainOnFail) yield* walkItems([item.chainOnFail], `${where}~onFail`);
  }
}

/** Every item id reachable in a shift, counting flattened chain follow-ups. */
function collectItemIds(items: ShiftItem[], into: Set<string>): Set<string> {
  for (const item of items) {
    if (item.id) into.add(item.id);
    if (item.chainOnResolve) collectItemIds([item.chainOnResolve], into);
    if (item.chainOnFail) collectItemIds([item.chainOnFail], into);
  }
  return into;
}

/** The investigation steps an item can actually grant the player. */
function providableSteps(item: ShiftItem): Set<string> {
  const steps = new Set<string>();
  for (const cmd of item.commands ?? []) if (cmd.step) steps.add(cmd.step);
  if (item.part) steps.add("part");
  if (item.ad) steps.add("ad");
  if (item.phone?.followups?.some((f) => f.correct)) steps.add("phone");
  return steps;
}

/**
 * Can a `requires` key ever be satisfied on this item? Mirrors the engine: the
 * "kb" gate is met by reading the item's kbArticleId; every other key is a step
 * set by a command, by shipping a part, by an admin action, or by asking the
 * right phone question.
 */
function requirementSatisfiable(item: ShiftItem, key: string, steps: Set<string>): boolean {
  if (key === "kb") return Boolean(item.kbArticleId);
  return steps.has(key);
}

/* ───────────────────────── copy scanning ───────────────────────── */

/** Collect every USER-FACING string on an item (never ids, skus, or aliases). */
function userFacingStrings(item: ShiftItem): string[] {
  const out: string[] = [];
  const push = (s?: string) => {
    if (typeof s === "string" && s.length) out.push(s);
  };
  push(item.subject);
  push(item.goal);
  push(item.hint);
  push(item.ticketBody);
  push(item.asset);
  push(item.from?.name);
  push(item.from?.role);
  push(item.email?.body);
  push(item.phone?.opener);
  for (const f of item.phone?.followups ?? []) {
    push(f.label);
    push(f.reply);
  }
  for (const ev of item.evidence ?? []) {
    push(ev.label);
    for (const line of ev.lines ?? []) push(line);
  }
  for (const cmd of item.commands ?? []) push(cmd.output);
  for (const a of item.actions ?? []) {
    push(a.label);
    push(a.detail);
    push(a.teach);
  }
  return out;
}

function kbStrings(kb: KbArticle): string[] {
  return [kb.title, ...(kb.body ?? [])].filter((s): s is string => typeof s === "string" && s.length > 0);
}

function scanCopy(strings: string[], where: string, out: ContentProblem[]): void {
  for (const text of strings) {
    if (FORBIDDEN_DASH.test(text)) {
      out.push({
        code: "forbidden-dash",
        where,
        message: `Forbidden dash (U+2012..U+2015) in user-facing copy: "${snippet(text)}". Use a comma, period, parentheses, or "to".`,
      });
    }
    for (const rule of FORBIDDEN_CURRENCY) {
      if (rule.re.test(text)) {
        out.push({
          code: "forbidden-currency",
          where,
          message: `Currency must read as Fangs, found ${rule.label}: "${snippet(text)}".`,
        });
      }
    }
  }
}

function snippet(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}...` : flat;
}

/* ───────────────────────── the validator ───────────────────────── */

/** Validate all authored LionDesk content. Returns [] when everything is clean. */
export function validateContent(opts: ValidateOptions = {}): ContentProblem[] {
  const problems: ContentProblem[] = [];

  // The union of every KB article id the content can resolve against. MASTER_KB
  // already unions all shift KB plus pool-extra inline articles; the shift / tutorial
  // ids are folded in too so the set is exhaustive.
  const kbUnion = new Set<string>(MASTER_KB.map((k) => k.id));
  for (const s of SHIFTS) for (const k of s.kb) kbUnion.add(k.id);
  for (const k of TUTORIAL_SHIFT.kb) kbUnion.add(k.id);

  // 1) Every CAMPAIGN shift (everything in SHIFTS) must have a server reward
  //    entry, or completing it 400s silently and grants nothing. The tutorial
  //    and generated surprise shifts are practice and intentionally excluded.
  let rewardIds: Set<string> | null = null;
  try {
    rewardIds = opts.rewardShiftIds ?? getRewardShiftIds();
  } catch (err) {
    problems.push({
      code: "reward-table-unreadable",
      where: REWARD_ROUTE_REL,
      message: `Could not read SHIFT_REWARDS: ${(err as Error).message}`,
    });
  }
  if (rewardIds) {
    for (const shift of SHIFTS) {
      if (!rewardIds.has(shift.id)) {
        problems.push({
          code: "missing-reward",
          where: shift.id,
          message: `Campaign shift "${shift.id}" has no SHIFT_REWARDS entry in ${REWARD_ROUTE_REL}; its completion would return a silent 400 and grant nothing.`,
        });
      }
    }
  }

  // 2) Per-item assertions across every authored source.
  const sources: { items: ShiftItem[]; base: string }[] = [
    ...SHIFTS.map((s) => ({ items: s.items, base: s.id })),
    { items: TUTORIAL_SHIFT.items, base: TUTORIAL_SHIFT.id },
    { items: POOL.map((p) => p.item), base: "pool" },
    ...INCIDENT_GROUPS.map((g) => ({ items: g.items, base: `incident:${g.group}` })),
  ];

  for (const src of sources) {
    for (const { item, where } of walkItems(src.items, src.base)) {
      const actions = item.actions ?? [];

      // at least one correct action, or the item is unwinnable.
      if (!actions.some((a) => a.correct)) {
        problems.push({ code: "no-correct-action", where, message: "No action is marked correct, so the item can never be resolved." });
      }

      // every requires (on actions and on commands) must be satisfiable here.
      const steps = providableSteps(item);
      for (const a of actions) {
        for (const key of a.requires ?? []) {
          if (!requirementSatisfiable(item, key, steps)) {
            problems.push({
              code: "unsatisfiable-requires",
              where,
              message: `Action "${a.id}" requires step "${key}", but nothing on this item can grant it.`,
            });
          }
        }
      }
      for (const cmd of item.commands ?? []) {
        for (const key of cmd.requires ?? []) {
          if (!requirementSatisfiable(item, key, steps)) {
            problems.push({
              code: "unsatisfiable-requires",
              where,
              message: `Command "${cmd.aliases?.[0] ?? "?"}" requires step "${key}", but nothing on this item can grant it.`,
            });
          }
        }
      }

      // kbArticleId must resolve in the KB union.
      if (item.kbArticleId && !kbUnion.has(item.kbArticleId)) {
        problems.push({
          code: "kb-not-in-union",
          where,
          message: `kbArticleId "${item.kbArticleId}" does not resolve to any known KB article.`,
        });
      }

      // chain targets must be well-formed items.
      for (const [field, chained] of [
        ["chainOnResolve", item.chainOnResolve],
        ["chainOnFail", item.chainOnFail],
      ] as const) {
        if (chained && (!chained.id || !(chained.actions?.length))) {
          problems.push({
            code: "chain-target-invalid",
            where,
            message: `${field} is malformed (missing id or actions).`,
          });
        }
      }
    }
  }

  // 3) Reveal targets: any follow-up gated by revealedBy must point at an item
  //    that exists in the same shift (counting flattened chain follow-ups).
  const revealSources: { items: ShiftItem[]; base: string }[] = [
    ...SHIFTS.map((s) => ({ items: s.items, base: s.id })),
    { items: TUTORIAL_SHIFT.items, base: TUTORIAL_SHIFT.id },
  ];
  for (const src of revealSources) {
    const ids = collectItemIds(src.items, new Set<string>());
    for (const { item, where } of walkItems(src.items, src.base)) {
      if (item.revealedBy && !ids.has(item.revealedBy.itemId)) {
        problems.push({
          code: "reveal-target-missing",
          where,
          message: `revealedBy.itemId "${item.revealedBy.itemId}" does not exist in this shift.`,
        });
      }
    }
  }

  // 4) Unicode + currency scan over every user-facing string.
  for (const shift of [...SHIFTS, TUTORIAL_SHIFT] as Shift[]) {
    scanCopy([shift.name, shift.rank], `${shift.id}#chrome`, problems);
    for (const mod of shift.modifiers ?? []) scanCopy([mod.label, mod.desc], `${shift.id}#modifier:${mod.id}`, problems);
    for (const kb of shift.kb) scanCopy(kbStrings(kb), `${shift.id}#kb:${kb.id}`, problems);
  }
  for (const kb of MASTER_KB) scanCopy(kbStrings(kb), `kb:${kb.id}`, problems);
  for (const src of sources) {
    for (const { item, where } of walkItems(src.items, src.base)) {
      scanCopy(userFacingStrings(item), where, problems);
    }
  }

  return problems;
}
