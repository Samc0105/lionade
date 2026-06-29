#!/usr/bin/env npx tsx
// Content gate for TechHub / LionDesk. Audits the authored shift content and
// exits non-zero if anything is wrong, so bad copy (forbidden dashes, currency
// that is not Fangs) or broken data (unsatisfiable steps, dangling KB refs,
// campaign shifts with no server reward entry) can never ship silently.
//
// Run: npm run validate:shifts   (or: npx tsx scripts/validate-shifts.ts)

import { validateContent, type ContentProblem } from "../lib/liondesk/validate";

function main() {
  const problems: ContentProblem[] = validateContent();

  if (problems.length === 0) {
    console.log("LionDesk content: OK. Zero problems.");
    return;
  }

  // Group by problem code so the report reads top-down by category.
  const byCode = new Map<string, ContentProblem[]>();
  for (const p of problems) {
    const list = byCode.get(p.code) ?? [];
    list.push(p);
    byCode.set(p.code, list);
  }

  console.error(`LionDesk content: ${problems.length} problem${problems.length === 1 ? "" : "s"} found.\n`);
  for (const [code, list] of byCode) {
    console.error(`[${code}] (${list.length})`);
    for (const p of list) console.error(`  - ${p.where}: ${p.message}`);
    console.error("");
  }
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error("Fatal error running the content validator:", err);
  process.exit(1);
}
