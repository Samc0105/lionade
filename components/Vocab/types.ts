/**
 * Vocab Word Banks — client-side shared types.
 *
 * Mirrors the server-trusted shape from `lib/vocab-banks.ts` (BankAuthor +
 * PublicBankSummary) without dragging server-only helpers into the client
 * bundle. Keep these in lock-step with the server interface; the API responses
 * are the source of truth at runtime.
 */

export interface BankAuthor {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

/**
 * What the Discover surface gets per bank. Shape comes from
 * GET /api/vocab/banks/discover.
 */
export interface PublicBankSummary {
  id: string;
  name: string;
  kind: "language" | "general";
  color: string;
  icon: string;
  source_lang: string | null;
  target_lang: string | null;
  clone_count: number;
  published_at: string | null;
  word_count: number;
  author: BankAuthor;
}

export type DiscoverSort = "top" | "new" | "cloned";
export type DiscoverKind = "all" | "general" | "language";
