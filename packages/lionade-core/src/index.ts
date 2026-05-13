/**
 * @lionade/core — main entry.
 *
 * Prefer subpath imports (e.g. '@lionade/core/types', '@lionade/core/logic/levels')
 * for tree-shaking and to keep platform-boundary violations visible in code review.
 *
 * This file re-exports the most-used surface from each subdirectory for convenience.
 */
export * from "./types/index.js";
