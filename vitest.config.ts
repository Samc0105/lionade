// Vitest config for the LionDesk / TechHub test suite.
//
// The engine (lib/liondesk/engine.ts), the scoring module, and the content
// validator are pure TypeScript (no React, no DOM), so the fast Node environment
// is all they need. A future test that renders a component can opt into jsdom on
// a per file basis with a "// @vitest-environment jsdom" docblock; there is no
// reason to pay for jsdom on the whole suite.
//
// The "@/..." path alias from tsconfig.json is mirrored here so imports resolve
// under Vitest exactly like they do in the Next.js build. content.test.ts pulls
// the validator, which transitively imports "@/lib/helpdesk/types", so without
// this alias the suite would fail to resolve that module. No extra plugin needed.

import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)));

export default defineConfig({
  resolve: {
    alias: {
      "@": repoRoot,
    },
  },
  test: {
    environment: "node",
  },
});
