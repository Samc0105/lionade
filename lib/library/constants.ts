/**
 * Community Study-Set Library — shared server/client constants.
 *
 * The library layers on the study_sets/study_set_cards tables (HELD migration
 * 20260702130000, built by dev-database) plus the library addendum (HELD
 * 20260702140000: is_public/published_at/clone_count/cloned_from columns +
 * library_reports). Everything here must stay import-safe from BOTH client
 * components and API routes — no next/server, no supabase imports.
 */

/** The only legal tip sizes. Enforced server-side AND by the DB-less route check. */
export const TIP_AMOUNTS = [25, 50, 100] as const;
export type TipAmount = (typeof TIP_AMOUNTS)[number];

/** Max set_tip_sent ledger rows per user per UTC day. */
export const MAX_TIPS_PER_DAY = 3;

/** Open reports from this many DISTINCT users auto-unpublishes a set. */
export const REPORT_AUTO_UNPUBLISH_THRESHOLD = 3;

/** Report reason length cap (chars). Mirrors the DB CHECK in the addendum. */
export const MAX_REPORT_REASON_LENGTH = 280;

/** Max reports a single user can file per UTC day (any set, any status). */
export const MAX_REPORTS_PER_DAY = 3;

/**
 * Minimum account age (days) before a user may report. Three fresh throwaway
 * accounts hitting the auto-unpublish threshold is the obvious brigade vector;
 * a 7 day floor makes that meaningfully more expensive.
 */
export const MIN_REPORTER_ACCOUNT_AGE_DAYS = 7;

/** Browse pagination: both the default and the hard max per request. */
export const LIBRARY_MAX_LIMIT = 30;

/**
 * Moderation chunking for publish: moderateText truncates input at 4000 chars,
 * so we chunk below that. MAX_MODERATION_CHUNKS caps total moderated text
 * (input-size cap BEFORE any outbound call) — beyond it, publish is refused.
 */
export const MODERATION_CHUNK_CHARS = 3500;
export const MAX_MODERATION_CHUNKS = 40;

/**
 * Table names from 20260702130000_study_sets.sql (dev-database's schema —
 * single source of truth). NOTE the card table is `study_cards`, not
 * `study_set_cards`.
 */
export const STUDY_SETS_TABLE = "study_sets";
export const STUDY_SET_CARDS_TABLE = "study_cards";
export const LIBRARY_REPORTS_TABLE = "library_reports";

/**
 * The browse response item — GET /api/library returns { sets: LibrarySetSummary[] }.
 * Lives here (not in the route file) because route files may only export HTTP
 * handlers, and the /library page consumes this shape too.
 */
export interface LibrarySetSummary {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  cardCount: number;
  cloneCount: number;
  publishedAt: string | null;
  isMine: boolean;
  clonedByMe: boolean;
  owner: { id: string; username: string | null; avatarUrl: string | null };
}
