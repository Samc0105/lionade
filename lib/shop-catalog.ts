/**
 * Web shim — re-exports from @lionade/core/constants/shop-catalog.
 *
 * Canonical source: packages/lionade-core/src/constants/shop-catalog.ts.
 * Both web and iOS import from there.
 *
 * This shim keeps existing `import { SHOP_ITEMS } from '@/lib/shop-catalog'` working.
 * New code should import directly from '@lionade/core/constants/shop-catalog'.
 */
export * from "@lionade/core/constants/shop-catalog";
