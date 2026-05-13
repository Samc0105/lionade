/**
 * Web shim — re-exports from @lionade/core/logic/mastery-bkt.
 *
 * Canonical source: packages/lionade-core/src/logic/mastery-bkt.ts.
 * Both web and iOS import from there.
 *
 * This shim keeps existing `import { updateBKT } from '@/lib/mastery'` working.
 * New code should import directly from '@lionade/core/logic/mastery-bkt'.
 */
export * from "@lionade/core/logic/mastery-bkt";
