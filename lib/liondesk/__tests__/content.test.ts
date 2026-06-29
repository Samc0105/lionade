// @ts-nocheck -- "vitest" is not yet a devDependency. tsconfig `include` is
// **/*.ts (with only node_modules excluded) and next.config.js does not set
// typescript.ignoreBuildErrors, so `next build` type-checks this file and would
// fail with TS2307 "Cannot find module 'vitest'". This pragma is build-time only:
// Vitest applies its own runtime transform, so the test still runs in full once
// vitest is installed. Remove this line when vitest lands in package.json.
//
// Content gate as a unit test. Asserts the authored TechHub / LionDesk content
// passes the validator with ZERO problems. If this fails, the failure message
// lists every offending location so the fix is obvious.
//
// Vitest may not be installed yet; this is authored to run as soon as it is
// (`vitest run`). It imports only the pure validator, no DB or network.

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
