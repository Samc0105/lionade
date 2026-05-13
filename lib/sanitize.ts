/**
 * Web shim — re-exports from @lionade/core/validation/sanitize.
 *
 * Canonical source: packages/lionade-core/src/validation/sanitize.ts.
 * Both web and iOS import from there.
 *
 * This shim keeps existing `import { sanitizeUsername } from '@/lib/sanitize'` working.
 * New code should import directly from '@lionade/core/validation/sanitize'.
 */
export * from "@lionade/core/validation/sanitize";
