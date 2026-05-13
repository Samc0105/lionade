/**
 * Web shim — re-exports from @lionade/core/logic/levels.
 *
 * Canonical source: packages/lionade-core/src/logic/levels.ts.
 * Both web and iOS import from there.
 *
 * This shim keeps existing `import { LEVEL_TIERS } from '@/lib/levels'` working.
 * New code should import directly from '@lionade/core/logic/levels'.
 */
export * from "@lionade/core/logic/levels";
