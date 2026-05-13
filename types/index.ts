/**
 * Web shim — re-exports from @lionade/core/types.
 *
 * The canonical source of these types lives in packages/lionade-core/src/types/index.ts.
 * Both web and iOS import from there. This shim exists only so that existing
 * `import { User } from '@/types'` statements throughout the web codebase keep working.
 *
 * New code should import directly from '@lionade/core/types' for clarity.
 */
export * from "@lionade/core/types";
