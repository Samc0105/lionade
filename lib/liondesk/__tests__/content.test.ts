// Content gate as a unit test. Asserts the authored TechHub / LionDesk content
// passes the validator with ZERO problems. If this fails, the failure message
// lists every offending location so the fix is obvious. It imports only the pure
// validator (no DB, no network), so it runs under Vitest (`npm test`) and the
// build never type-checks it (tsconfig excludes this directory).

import { describe, expect, it } from "vitest";

import { validateContent, type ContentProblem } from "../validate";

function format(problems: ContentProblem[]): string {
  if (problems.length === 0) return "";
  return "\n" + problems.map((p) => `  [${p.code}] ${p.where}: ${p.message}`).join("\n");
}

describe("LionDesk / TechHub authored content", () => {
  it("has zero content problems", () => {
    const problems = validateContent();
    expect(problems, `Expected clean content but found ${problems.length} problem(s):${format(problems)}`).toEqual([]);
  });
});
