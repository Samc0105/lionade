/**
 * Vocab Word Banks API — banks, words, SM-2 reviews, streaks, and the
 * public Discover/clone surface (V3A).
 *
 * Wraps the platform-neutral routes:
 *   GET    /api/vocab/banks                 → { banks: VocabBank[] }
 *   POST   /api/vocab/banks                 → { bank: VocabBank }
 *   PATCH  /api/vocab/banks/[id]            → { bank: VocabBank }
 *   DELETE /api/vocab/banks/[id]            → { ok: true }
 *   GET    /api/vocab/words?bank_id&due&limit&offset → { words, total }
 *   POST   /api/vocab/words                 → { word, coinsAwarded, streak, balance }
 *   PATCH  /api/vocab/words/[id]            → { ok, self_confidence }
 *   DELETE /api/vocab/words/[id]            → { ok: true }
 *   POST   /api/vocab/review/[id]           → { word, coinsAwarded }
 *   POST   /api/vocab/translate             → { translation, cached }
 *   POST   /api/vocab/define                → { definition, source, cached }
 *   GET    /api/vocab/streak                → { streaks: BankStreak[] }
 *   GET    /api/vocab/banks/discover        → { banks: PublicBankSummary[] }
 *   GET    /api/vocab/banks/[id]/preview    → { bank, words }
 *   POST   /api/vocab/banks/[id]/clone      → { bankId, coinsAwarded }
 *
 * Shapes are typed against the live route handlers (app/api/vocab/*) and
 * mirror components/Vocab/types.ts where that file exists. NOTE: the streak
 * shape here is the SERVER truth (camelCase `bankId`/`bankName` per
 * app/api/vocab/streak/route.ts) — web's BankStreakPill currently declares
 * snake_case fields that do not match the route.
 */

import type { ApiClient, ApiResult } from "./http.js";

// ─────────────────────────────────────────────────────────────────────────────
// Domain types
// ─────────────────────────────────────────────────────────────────────────────

export type VocabBankKind = "language" | "general";

/** What `vocab_words.definition_source` can store (lib/vocab-banks.ts). */
export type VocabDefinitionSource = "mymemory" | "wikipedia" | "ai" | "manual";

/**
 * A word bank row, as returned by every /api/vocab/banks* endpoint
 * (server selects `*` from vocab_banks). Mirrors lib/vocab-banks.ts BankRow
 * + the client-side VocabBank in components/Vocab/CreateBankModal.tsx.
 */
export interface VocabBank {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  kind: VocabBankKind;
  /** 'en' | 'es' on language banks; null on general banks. */
  source_lang: string | null;
  target_lang: string | null;
  color: string;
  icon: string;
  created_at: string;
  // V3A — public/clone fields (nullable when migration applied to existing rows).
  is_public?: boolean;
  published_at?: string | null;
  clone_count?: number;
  parent_bank_id?: string | null;
  parent_user_id?: string | null;
  /** Username of the original author for cloned banks — only present on joined responses. */
  parent_username?: string | null;
}

/**
 * A vocab word/card row (server selects `*` from vocab_words).
 * Language banks: `word` + `translation`. General banks: `word` holds the
 * term and `translation` / `term_definition` hold the canonical definition.
 */
export interface VocabWord {
  id: string;
  user_id?: string;
  bank_id: string;
  /** Source-language word (language banks) or the canonical term (general banks). */
  word?: string;
  term?: string;
  /** Target-language translation — language banks only. */
  translation?: string;
  /** Reference definition — general banks (mirrors `translation` for V2 rows). */
  term_definition?: string;
  source_lang?: string | null;
  target_lang?: string | null;
  /** Active-recall: the user's own explanation. Null when not provided. */
  user_definition: string | null;
  definition_source?: VocabDefinitionSource;
  ease_factor?: number;
  review_count: number;
  correct_count: number;
  last_reviewed_at?: string | null;
  next_review_at: string;
  created_at?: string;
  updated_at?: string;
  /** User-set confidence override. null = auto-derive from accuracy. */
  self_confidence?: VocabSelfConfidence;
}

export type VocabSelfConfidence = "confident" | "shaky" | "struggling" | null;

/**
 * Per-bank streak row from GET /api/vocab/streak. Server-true camelCase
 * shape (app/api/vocab/streak/route.ts).
 */
export interface BankStreak {
  bankId: string;
  bankName: string;
  count: number;
  /** YYYY-MM-DD of the last day the streak advanced, or null. */
  lastDay: string | null;
  maxStreak: number;
}

/** Streak delta returned inline by POST /api/vocab/words (advance_vocab_streak RPC). */
export interface AddWordStreak {
  bankId: string;
  count: number;
  lastDay: string | null;
  bumped: boolean;
}

export interface BankAuthor {
  id: string;
  username: string | null;
  avatar_url: string | null;
}

/**
 * What the Discover surface gets per bank. Shape comes from
 * GET /api/vocab/banks/discover. Mirrors components/Vocab/types.ts.
 */
export interface PublicBankSummary {
  id: string;
  name: string;
  kind: VocabBankKind;
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

// ─────────────────────────────────────────────────────────────────────────────
// Payloads
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateBankPayload {
  /** 1..50 chars after trim. */
  name: string;
  kind: VocabBankKind;
  /** Required + must differ from target_lang when kind='language'. Omit for general. */
  source_lang?: string | null;
  target_lang?: string | null;
  /** #RGB or #RRGGBB. Server defaults on omit/malformed. */
  color?: string;
  /** Emoji or short token. Server defaults per kind. */
  icon?: string;
}

/** PATCH /api/vocab/banks/[id]. kind + language pair are frozen at create. */
export interface PatchBankPayload {
  name?: string;
  color?: string;
  icon?: string;
  /** Publish toggle (V3A). Publishing enforces the profanity check + public-bank cap. */
  is_public?: boolean;
}

/** Language-bank variant of POST /api/vocab/words. Stored with definition_source='mymemory'. */
export interface AddWordLanguagePayload {
  bank_id: string;
  word: string;
  translation: string;
  /** Must match the bank's stored pair. */
  source_lang: string;
  target_lang: string;
  user_definition?: string;
}

/** General-bank variant of POST /api/vocab/words. */
export interface AddWordGeneralPayload {
  bank_id: string;
  term: string;
  /** Canonical definition from Wikipedia/AI/manual. */
  term_definition: string;
  definition_source: Exclude<VocabDefinitionSource, "mymemory">;
  user_definition?: string;
}

export type AddWordPayload = AddWordLanguagePayload | AddWordGeneralPayload;

export interface AddWordResponse {
  word: VocabWord;
  coinsAwarded: number;
  streak: AddWordStreak | null;
  balance: number | null;
}

export interface ListWordsParams {
  /** Filter to a single owned bank. */
  bankId?: string;
  /** Only return cards where next_review_at <= now(). */
  due?: boolean;
  /** Default 50, max 200. */
  limit?: number;
  /** Default 0. */
  offset?: number;
}

export interface DiscoverParams {
  /** 'cloned' is an alias for 'top' server-side. Default 'top'. */
  sort?: DiscoverSort;
  /** Omit (or 'all') for no kind filter. */
  kind?: DiscoverKind;
  /** "<source>-<target>" e.g. "es-en". Only honored when kind='language'. */
  lang?: string;
  /** 1..50, default 20. */
  limit?: number;
  offset?: number;
}

export interface TranslateResponse {
  translation: string;
  cached: boolean;
}

export interface DefineResponse {
  definition: string;
  source: "wikipedia" | "ai";
  cached: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Methods
// ─────────────────────────────────────────────────────────────────────────────

export const vocabAPI = {
  /** GET /api/vocab/banks — the user's banks, most-recently-active first. */
  listBanks(client: ApiClient): Promise<ApiResult<{ banks: VocabBank[] }>> {
    return client.get<{ banks: VocabBank[] }>("/api/vocab/banks");
  },

  /** POST /api/vocab/banks — create a bank. 409 when no unique slug could be picked. */
  createBank(
    client: ApiClient,
    payload: CreateBankPayload,
  ): Promise<ApiResult<{ bank: VocabBank }>> {
    return client.post<{ bank: VocabBank }>("/api/vocab/banks", payload);
  },

  /** PATCH /api/vocab/banks/[id] — edit name/color/icon and toggle is_public. */
  patchBank(
    client: ApiClient,
    bankId: string,
    payload: PatchBankPayload,
  ): Promise<ApiResult<{ bank: VocabBank }>> {
    return client.patch<{ bank: VocabBank }>(
      `/api/vocab/banks/${bankId}`,
      payload,
    );
  },

  /** DELETE /api/vocab/banks/[id] — cascades to the bank's words + streaks. */
  deleteBank(
    client: ApiClient,
    bankId: string,
  ): Promise<ApiResult<{ ok: true }>> {
    return client.delete<{ ok: true }>(`/api/vocab/banks/${bankId}`);
  },

  /** GET /api/vocab/words — list cards, optionally due-only / bank-scoped / paged. */
  listWords(
    client: ApiClient,
    params: ListWordsParams = {},
  ): Promise<ApiResult<{ words: VocabWord[]; total: number }>> {
    const qs = new URLSearchParams();
    if (params.bankId) qs.set("bank_id", params.bankId);
    if (params.due) qs.set("due", "true");
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return client.get<{ words: VocabWord[]; total: number }>(
      `/api/vocab/words${suffix}`,
    );
  },

  /**
   * POST /api/vocab/words — save a new card. Payload variant must match the
   * bank's kind (language vs general). 409 on duplicate word in the bank.
   * Grants Fangs (+5 base, +10 with user_definition) and advances the
   * per-bank streak.
   */
  addWord(
    client: ApiClient,
    payload: AddWordPayload,
  ): Promise<ApiResult<AddWordResponse>> {
    return client.post<AddWordResponse>("/api/vocab/words", payload);
  },

  /** PATCH /api/vocab/words/[id] — set the self_confidence override (or null to clear). */
  patchWord(
    client: ApiClient,
    wordId: string,
    selfConfidence: VocabSelfConfidence,
  ): Promise<ApiResult<{ ok: true; self_confidence: VocabSelfConfidence }>> {
    return client.patch<{ ok: true; self_confidence: VocabSelfConfidence }>(
      `/api/vocab/words/${wordId}`,
      { self_confidence: selfConfidence },
    );
  },

  /** DELETE /api/vocab/words/[id] — hard-delete a card. */
  deleteWord(
    client: ApiClient,
    wordId: string,
  ): Promise<ApiResult<{ ok: true }>> {
    return client.delete<{ ok: true }>(`/api/vocab/words/${wordId}`);
  },

  /**
   * POST /api/vocab/review/[id] — submit an SM-2 review. Server advances the
   * schedule and grants +2 Fangs (multiplier-aware) on correct. 409 on a
   * concurrent-review conflict — safe to retry.
   */
  reviewWord(
    client: ApiClient,
    wordId: string,
    correct: boolean,
  ): Promise<ApiResult<{ word: VocabWord; coinsAwarded: number }>> {
    return client.post<{ word: VocabWord; coinsAwarded: number }>(
      `/api/vocab/review/${wordId}`,
      { correct },
    );
  },

  /**
   * POST /api/vocab/translate — language banks only. Proxies MyMemory with a
   * server-side cache. 503 when the upstream is unavailable.
   */
  translate(
    client: ApiClient,
    payload: { word: string; source: string; target: string; bank_id: string },
  ): Promise<ApiResult<TranslateResponse>> {
    return client.post<TranslateResponse>("/api/vocab/translate", payload);
  },

  /**
   * POST /api/vocab/define — general banks only. Wikipedia → AI cascade with
   * a global cache. 404 on a total miss (UI should offer manual definition).
   */
  define(
    client: ApiClient,
    payload: { term: string; bank_id: string },
  ): Promise<ApiResult<DefineResponse>> {
    return client.post<DefineResponse>("/api/vocab/define", payload);
  },

  /** GET /api/vocab/streak — all per-bank streaks, highest count first. */
  getStreaks(
    client: ApiClient,
  ): Promise<ApiResult<{ streaks: BankStreak[] }>> {
    return client.get<{ streaks: BankStreak[] }>("/api/vocab/streak");
  },

  /** GET /api/vocab/banks/discover — browse public banks (V3A). */
  discoverBanks(
    client: ApiClient,
    params: DiscoverParams = {},
  ): Promise<ApiResult<{ banks: PublicBankSummary[] }>> {
    const qs = new URLSearchParams();
    if (params.sort) qs.set("sort", params.sort);
    if (params.kind && params.kind !== "all") qs.set("kind", params.kind);
    if (params.lang) qs.set("lang", params.lang);
    if (params.limit !== undefined) qs.set("limit", String(params.limit));
    if (params.offset !== undefined) qs.set("offset", String(params.offset));
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    return client.get<{ banks: PublicBankSummary[] }>(
      `/api/vocab/banks/discover${suffix}`,
    );
  },

  /**
   * GET /api/vocab/banks/[id]/preview — public bank metadata + first N words
   * (n clamped 1..20, default 5). Private banks 404 (no existence leak).
   */
  previewBank(
    client: ApiClient,
    bankId: string,
    n?: number,
  ): Promise<ApiResult<{ bank: VocabBank; words: VocabWord[] }>> {
    const suffix = n !== undefined ? `?n=${n}` : "";
    return client.get<{ bank: VocabBank; words: VocabWord[] }>(
      `/api/vocab/banks/${bankId}/preview${suffix}`,
    );
  },

  /**
   * POST /api/vocab/banks/[id]/clone — deep-copy a public bank into the
   * caller's library. +25 Fangs (multiplier-aware). 400 on self-clone,
   * 403 when the bank went private, 404 when it doesn't exist.
   */
  cloneBank(
    client: ApiClient,
    bankId: string,
  ): Promise<ApiResult<{ bankId: string; coinsAwarded: number }>> {
    return client.post<{ bankId: string; coinsAwarded: number }>(
      `/api/vocab/banks/${bankId}/clone`,
      {},
    );
  },

  /**
   * Convenience wrapper for the publish toggle — PATCH { is_public } on the
   * bank. Same endpoint + response as patchBank.
   */
  publishBank(
    client: ApiClient,
    bankId: string,
    isPublic: boolean,
  ): Promise<ApiResult<{ bank: VocabBank }>> {
    return client.patch<{ bank: VocabBank }>(`/api/vocab/banks/${bankId}`, {
      is_public: isPublic,
    });
  },
} as const;
