"use client";

/**
 * VocabList — Tab C of /learn/vocab.
 *
 * Searchable + filterable list of every saved word. Each row shows the word,
 * its translation, the user's own definition (truncated), an accuracy badge
 * (correct / review_count), and a relative "next review" timestamp.
 *
 * Delete uses a confirm prompt (long-press is hard to discover on web; we
 * surface a small "Delete" action button next to each row instead).
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { MagnifyingGlass, Trash, ClockCounterClockwise } from "@phosphor-icons/react";
import { apiDelete, swrFetcher } from "@/lib/api-client";
import { toastError, toastSuccess } from "@/lib/toast";
import type { LangPair } from "./LanguageStreakPill";
import type { VocabWord } from "./ReviewQueue";

type FilterPair = "all" | LangPair;

const FILTER_LABEL: Record<FilterPair, string> = {
  all: "All",
  "en-es": "EN to ES",
  "es-en": "ES to EN",
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

export default function VocabList() {
  const { data, isLoading, mutate } = useSWR<{ words: VocabWord[] }>(
    "/api/vocab/words",
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<FilterPair>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const words = data?.words ?? [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return words.filter(w => {
      if (filter !== "all") {
        const pair = `${w.source_lang}-${w.target_lang}` as LangPair;
        if (pair !== filter) return false;
      }
      if (q.length === 0) return true;
      return (
        w.word.toLowerCase().includes(q) ||
        w.translation.toLowerCase().includes(q) ||
        w.user_definition.toLowerCase().includes(q)
      );
    });
  }, [words, query, filter]);

  const handleDelete = async (id: string, word: string) => {
    if (!window.confirm(`Delete "${word}" from your vocab? This can't be undone.`)) return;
    setDeletingId(id);
    try {
      const { ok, error } = await apiDelete(`/api/vocab/words/${id}`);
      if (!ok) {
        toastError(error ?? "Couldn't delete that word.");
        return;
      }
      toastSuccess("Word removed.");
      mutate();
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* Search + filter row */}
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
            placeholder="Search words, translations, or your definitions"
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-electric/60 focus:bg-white/[0.07] transition-colors"
            aria-label="Search vocab"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {(Object.keys(FILTER_LABEL) as FilterPair[]).map(key => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-full font-mono text-[10px] uppercase tracking-[0.2em] border transition-colors ${
                filter === key
                  ? "bg-electric text-navy border-electric"
                  : "bg-white/5 text-cream/65 border-white/10 hover:bg-white/10"
              }`}
            >
              {FILTER_LABEL[key]}
            </button>
          ))}
        </div>
      </div>

      {/* Result count */}
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
        {filtered.length} {filtered.length === 1 ? "word" : "words"}
      </p>

      {/* List */}
      {isLoading && !data ? (
        <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-cream/55">loading...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.03] backdrop-blur border border-white/[0.06] p-10 text-center">
          <p className="font-syne text-sm text-cream/65">
            {words.length === 0
              ? "No words yet. Head to the Add tab to lock in your first one."
              : "No words match that search."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(w => {
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
                        {w.word}
                      </p>
                      <span className="font-mono text-[9px] uppercase tracking-wider text-cream/45">
                        {w.source_lang} to {w.target_lang}
                      </span>
                    </div>
                    <p className="font-syne text-sm text-electric/90 mb-1">
                      {w.translation}
                    </p>
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
                      onClick={() => handleDelete(w.id, w.word)}
                      disabled={deletingId === w.id}
                      className="p-1.5 rounded-md text-cream/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
                      aria-label={`Delete ${w.word}`}
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
