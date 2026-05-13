# @lionade/core

Shared business logic, types, API client, prompts, validation, and constants for Lionade web (Next.js) and iOS (Expo + React Native).

**This package is platform-agnostic.** No React, no React Native, no Next.js, no Expo, no DOM globals, no `node:*` modules. Enforced by ESLint (`.eslintrc.cjs`) and TypeScript (`tsconfig.json` with `lib: ["ES2022"]`, no DOM types).

---

## Why this exists

Before lionade-core, the iOS app at `~/Desktop/lionade-ios` duplicated business logic from the web app — level math, BKT mastery progression, quiz scoring, Fangs reward calculations. Every change had to be made twice and parity drift was constant.

This package is the source of truth. Both apps import from it. Logic exists in exactly one place.

See [`LIONADE_WORKFLOW.md`](../../LIONADE_WORKFLOW.md) and [`IOS_PARITY.md`](../../IOS_PARITY.md) at the repo root for the workflow context.

---

## Package layout

```
src/
├── types/      User, Subject, Question, QuizResult, Badge, supabase DB rows
├── constants/  Subjects, shop catalog, mission pool, plan tiers
├── logic/      Levels, BKT mastery, Fangs reward math, streak rules, spin RNG (pure)
├── api/        DI'd HTTP client — createApiClient({ baseUrl, getToken, fetch })
├── prompts/    Ninny prompt templates
├── validation/ sanitize, zod schemas, payload clamps
└── hooks/      Platform-agnostic data derivations (NOT React hooks)
```

---

## Importing

Use subpath imports — never the bare package root — so violations of platform boundaries surface in code review:

```ts
import type { User, Subject } from '@lionade/core/types';
import { LEVEL_TIERS, getLevelProgress } from '@lionade/core/logic/levels';
import { createApiClient } from '@lionade/core/api';
import { sanitizeUsername } from '@lionade/core/validation/sanitize';
```

---

## Adding new code — checklist

- [ ] No React / RN / Next / Expo / DOM / `node:*` imports
- [ ] Pure functions where possible (DI any I/O)
- [ ] Types exported from `src/types/`
- [ ] Constants exported from `src/constants/`
- [ ] If touching DB shape, regenerate `src/types/supabase.ts`
- [ ] `npm run typecheck` passes
- [ ] Document the export in this README

---

## Consumed by

- **Web** (`/Users/samc/Desktop/lionade`) via npm workspaces + `transpilePackages` in `next.config.js`
- **iOS** (`/Users/samc/Desktop/lionade-ios`) via `"@lionade/core": "file:../lionade/packages/lionade-core"` in `package.json` + `metro.config.js` `watchFolders`

---

*Migration status: tracked in `/PARITY_SPRINT_LOG.md` at the repo root.*
