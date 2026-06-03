"use client";

/**
 * VocabList — Tab C of /learn/vocab.
 *
 * Searchable + sortable list of saved entries in the ACTIVE bank.
 * Each row shows the word/term, its translation/term_definition, the user's
 * own definition (truncated), an accuracy badge, and a relative "next review"
 * timestamp.
 *
 * The new sort dropdown ("recently added / most reviewed / lowest accuracy")
 * gives Sam a no-friction way to surface struggling terms without leaving the
 * page. Filtering by language pair (the old top filter) is no longer needed
 * because the list itself is already bank-scoped.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { MagnifyingGlass, Trash, ClockCounterClockwise } from "@phosphor-icons/react";
import { apiDelete, swrFetcher } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import type { VocabBank } from "./CreateBankModal";
import type { VocabWord } from "./ReviewQueue";

type Sort = "recent" | "most_reviewed" | "lowest_accuracy";

const SORT_LABEL: Record<Sort, string> = {
  recent: "Recently added",
  most_reviewed: "Most reviewed",
  lowest_accuracy: "Lowest accuracy",
};

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `in ${days}d`;
}

interface Props {
  bank: VocabBank;
}

export default function VocabList({ bank }: Props) {
  const { data, isLoading, mutate } = useSWR<{ words: VocabWord[] }>(
    `/api/vocab/words?bank_id=${encodeURIComponent(bank.id)}`,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const words = data?.words ?? [];
  const isLanguageBank = bank.kind === "language";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = words.filter(w => {
      if (q.length === 0) return true;
      const front = (w.word ?? w.term ?? "").toLowerCase();
      const back = (w.translation ?? w.term_definition ?? "").toLowerCase();
      const self = w.user_definition.toLowerCase();
      return front.includes(q) || back.includes(q) || self.includes(q);
    });
    // Apply sort. We never mutate `words` — we sort a copy.
    const sorted = [...list];
    if (sort === "most_reviewed") {
      sorted.sort((a, b) => b.review_count - a.review_count);
    } else if (sort === "lowest_accuracy") {
      sorted.sort((a, b) => {
        const accA = a.review_count > 0 ? a.correct_count / a.review_count : 1; // unreviewed → bottom
        const accB = b.review_count > 0 ? b.correct_count / b.review_count : 1;
        return accA - accB;
      });
    }
    // "recent" relies on the server's default ordering (created_at desc).
    return sorted;
  }, [words, query, sort]);

  const handleDelete = async (id: string, label: string) => {
    if (!window.confirm(`Delete "${label}" from ${bank.name}? This can't be undone.`)) return;
    setDeletingId(id);
    try {
      const { ok, error } = await apiDelete(`/api/vocab/words/${id}`);
      if (!ok) {
        toastError(error ?? "Couldn't delete that entry.");
        return;
      }
      toastSuccess("Entry removed.");
      mutate();
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search + sort row */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1 min-w-0">
          <MagnifyingGlass
            size={14}
            weight="bold"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/45"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={`Search ${bank.name}`}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-electric/60 focus:bg-white/[0.07] transition-colors"
            aria-label="Search bank"
          />
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-cream/75 text-xs font-syne">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">sort</span>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as Sort)}
            className="bg-transparent text-cream font-syne text-sm focus:outline-none cursor-pointer"
            aria-label="Sort vocab list"
          >
            {(Object.keys(SORT_LABEL) as Sort[]).map(k => (
              <option key={k} value={k} className="bg-navy text-cream">{SORT_LABEL[k]}</option>
            ))}
          </select>
        </label>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
        {filtered.length} {filtered.length === 1 ? "entry" : "entries"} in {bank.name}
      </p>

      {isLoading && !data ? (
        <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-cream/55">loading...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.03] backdrop-blur border border-white/[0.06] p-10 text-center">
          <p className="font-syne text-sm text-cream/65">
            {words.length === 0
              ? `No entries in ${bank.name} yet. Head to the Add tab to lock in your first one.`
              : "Nothing matches that search."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(w => {
            const front = w.word ?? w.term ?? "";
            const back = w.translation ?? w.term_definition ?? "";
            const accuracy = w.review_count > 0
              ? Math.round((w.correct_count / w.review_count) * 100)
              : null;
            const accColor =
              accuracy === null ? "rgba(238,244,255,0.45)"
                : accuracy >= 80 ? "#22C55E"
                : accuracy >= 60 ? "#FFD700"
                : "#F97316";
            return (
              <li
                key={w.id}
                className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 px-4 py-3 hover:bg-white/[0.07] transition-colors"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                      <p className="font-bebas text-lg tracking-wider text-cream leading-none">
                        {front}
                      </p>
                      {isLanguageBank && w.source_lang && w.target_lang && (
                        <span className="font-mono text-[9px] uppercase tracking-wider text-cream/45">
                          {w.source_lang} to {w.target_lang}
                        </span>
                      )}
                    </div>
                    {back && (
                      <p className={isLanguageBank
                        ? "font-syne text-sm text-electric/90 mb-1"
                        : "font-syne text-xs text-electric/85 mb-1 line-clamp-2"}
                      >
                        {back}
                      </p>
                    )}
                    {w.user_definition && (
                      <p className="font-syne text-xs text-cream/55 italic line-clamp-2">
                        &ldquo;{w.user_definition}&rdquo;
                      </p>
                    )}
                    <div className="mt-2 flex items-center gap-3 font-mono text-[9px] uppercase tracking-wider text-cream/45">
                      <span className="inline-flex items-center gap-1">
                        <ClockCounterClockwise size={10} weight="bold" aria-hidden="true" />
                        {timeUntil(w.next_review_at)}
                      </span>
                      <span>·</span>
                      <span>{w.review_count} review{w.review_count === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                  <div className="flex-shrink-0 flex flex-col items-end gap-2">
                    {accuracy !== null && (
                      <div
                        className="px-2 py-0.5 rounded-full font-bebas text-sm tabular-nums tracking-wider"
                        style={{
                          background: `${accColor}18`,
                          color: accColor,
                          border: `1px solid ${accColor}40`,
                        }}
                      >
                        {accuracy}%
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDelete(w.id, front)}
                      disabled={deletingId === w.id}
                      className="p-1.5 rounded-md text-cream/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
                      aria-label={`Delete ${front}`}
                    >
                      <Trash size={14} weight="bold" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
