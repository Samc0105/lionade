#!/usr/bin/env npx tsx
// Alias-shadowing gate for the TechHub terminal scenarios.
//
// The bug class: HelpDeskSim matches typed commands against every command's
// aliases. If two commands inside one scenario carry canon-equal aliases (or
// an alias collides with a reserved built-in), the LATER command's alias is
// unreachable — the matcher hands the input to the earlier command. In the
// worst case that pays out a resolve for a rookie-trap command, or makes a
// gated investigation step impossible to confirm.
//
// This script ports the terminal's exact matching semantics from
// components/helpdesk/HelpDeskSim.tsx:
//   canon():  lowercase, collapse every run of non-alphanumerics to a single
//             space, trim
//   pass 1:   exact canon-equal alias anywhere in the command list wins,
//             FIRST command in list order
//   pass 2:   (only when no exact match) longest alias that prefixes the
//             input at a word boundary wins
// plus the built-ins ("help", "hint", "clear") the terminal intercepts before
// matching. It then simulates typing every alias of every command; if the
// alias does not resolve to its own command, that's a collision and the
// script exits 1 listing every one.
//
// Data sources: the hand-built starters in lib/helpdesk/scenarios.ts and the
// authored set in lib/helpdesk/scenarios.generated.json (imported merged via
// SCENARIOS, with the generated file read separately for source attribution).
//
// Run: npm run check:scenarios   (or: npx tsx scripts/check-scenario-aliases.mjs)

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "../lib/helpdesk/scenarios";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Which scenario ids come from the generated JSON (for "fix it here" hints).
const generatedPath = path.join(__dirname, "..", "lib", "helpdesk", "scenarios.generated.json");
const generatedIds = new Set(
  JSON.parse(readFileSync(generatedPath, "utf8")).map((s) => s.id),
);

// run() in HelpDeskSim.tsx intercepts these before any command matching, so a
// command alias that canonicalizes to one of them can never fire.
const BUILT_INS = new Set(["help", "hint", "clear"]);

/** Port of canon() from HelpDeskSim.tsx. Keep byte-identical semantics. */
function canon(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Port of the two-pass matcher from HelpDeskSim.tsx run(). Returns the index
 * of the command the terminal would execute for canonical input `nc`, or -1.
 */
function matchIndex(commands, nc) {
  // Pass 1: an exact alias match anywhere in the list wins — first in order.
  for (let i = 0; i < commands.length; i++) {
    if (commands[i].aliases.some((a) => canon(a) === nc)) return i;
  }
  // Pass 2: longest alias that prefixes the input at a word boundary.
  let best = -1;
  let bestLen = -1;
  for (let i = 0; i < commands.length; i++) {
    for (const a of commands[i].aliases) {
      const ca = canon(a);
      if (nc.startsWith(ca + " ") && ca.length > bestLen) {
        bestLen = ca.length;
        best = i;
      }
    }
  }
  return best;
}

const label = (cmd) => `"${cmd.aliases[0] ?? "(no aliases)"}"`;

const collisions = [];
let scenarioCount = 0;
let aliasCount = 0;

for (const scenario of SCENARIOS) {
  scenarioCount += 1;
  const source = generatedIds.has(scenario.id)
    ? "lib/helpdesk/scenarios.generated.json"
    : "lib/helpdesk/scenarios.ts";

  scenario.commands.forEach((cmd, i) => {
    for (const alias of cmd.aliases) {
      aliasCount += 1;
      const nc = canon(alias);

      if (nc === "") {
        collisions.push(
          `${scenario.id} (${source}): command #${i} ${label(cmd)} has alias "${alias}" that canonicalizes to an empty string — it can never be typed.`,
        );
        continue;
      }
      if (BUILT_INS.has(nc)) {
        collisions.push(
          `${scenario.id} (${source}): command #${i} ${label(cmd)} alias "${alias}" collides with the reserved built-in \`${nc}\` — the terminal intercepts it before matching.`,
        );
        continue;
      }

      const winner = matchIndex(scenario.commands, nc);
      if (winner !== i) {
        const w = scenario.commands[winner];
        collisions.push(
          `${scenario.id} (${source}): command #${i} ${label(cmd)} alias "${alias}" is shadowed — typing it resolves to command #${winner} ${label(w)} instead.`,
        );
      }
    }
  });
}

if (collisions.length > 0) {
  console.error(
    `Scenario alias check: ${collisions.length} collision${collisions.length === 1 ? "" : "s"} found (checked ${aliasCount} aliases across ${scenarioCount} scenarios).\n`,
  );
  for (const c of collisions) console.error(`  ✗ ${c}`);
  console.error(
    "\nFix by renaming/removing the shadowed alias (or the earlier duplicate) so every alias reaches its own command.",
  );
  process.exit(1);
}

console.log(
  `Scenario alias check: OK. ${aliasCount} aliases across ${scenarioCount} scenarios, every one reaches its own command.`,
);
