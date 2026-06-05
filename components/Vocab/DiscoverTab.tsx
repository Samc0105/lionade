"use client";

/**
 * DiscoverTab — Tab D of /learn/vocab (Word Banks V3A).
 *
 * Browse PUBLIC banks other Lionade users have shared. Card grid pulls from
 * GET /api/vocab/banks/discover?sort=...&kind=... — server already filters to
 * `is_public = true` and excludes the viewer's own banks (no infinite-clone
 * loops). Click a card → opens BankPreviewModal which handles the actual
 * clone.
 *
 * V3A scope (intentionally small):
 *  - Sort: top (by clone_count) / new (by published_at) / cloned (by
 *    clone_count again, kept distinct in case backend swaps the meaning)
 *  - Kind filter: All / General / Language
 *  - 20 banks per page, offset-based pagination (Load more)
 *
 * Empty state nudges the user to be the first publisher. Loading state is a
 * skeleton grid so the page doesn't pop.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import {
  BookOpen,
  GlobeHemisphereWest,
  ArrowsClockwise,
} from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import { swrFetcher } from "@/lib/api-client";
import BankPreviewModal from "./BankPreviewModal";
import type { DiscoverKind, DiscoverSort, PublicBankSummary } from "./types";

interface DiscoverResponse {
  banks: PublicBankSummary[];
}

const SORTS: { id: DiscoverSort; label: string }[] = [
  { id: "top", label: "Top" },
  { id: "new", label: "New" },
  { id: "cloned", label: "Most cloned" },
];

const KINDS: { id: DiscoverKind; label: string; emoji: string }[] = [
  { id: "all", label: "All", emoji: "✦" },
  { id: "general", label: "General", emoji: "📚" },
  { id: "language", label: "Language", emoji: "🌍" },
];

const PAGE_SIZE = 20;

interface Props {
  /** Called after a successful clone so the parent can refetch the user's bank list. */
  onCloned?: () => void;
}

export default function DiscoverTab({ onCloned }: Props) {
  const { user } = useAuth();
  const viewerId = user?.id ?? null;
  const [sort, setSort] = useState<DiscoverSort>("top");
  const [kindFilter, setKindFilter] = useState<DiscoverKind>("all");
  const [selectedBank, setSelectedBank] = useState<PublicBankSummary | null>(null);

  // Reset offset when filters change. Offset-based pagination via "Load more".
  const [offset, setOffset] = useState(0);
  useEffect(() => {
    setOffset(0);
  }, [sort, kindFilter]);

  // Build SWR key including filters + offset so each combination caches
  // independently. `keepPreviousData` keeps the grid populated through
  // filter swaps instead of flashing to empty.
  const swrKey = useMemo(() => {
    const params = new URLSearchParams();
    params.set("sort", sort);
    params.set("limit", String(PAGE_SIZE));
    params.set("offset", String(offset));
    if (kindFilter !== "all") params.set("kind", kindFilter);
    return `/api/vocab/banks/discover?${params.toString()}`;
  }, [sort, kindFilter, offset]);

  const { data, error, isLoading, mutate } = useSWR<DiscoverResponse>(
    swrKey,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const banks = data?.banks ?? [];
  const hasMore = banks.length === PAGE_SIZE;

  const handleCardClick = useCallback((bank: PublicBankSummary) => {
    setSelectedBank(bank);
  }, []);

  const handlePreviewClose = useCallback(() => {
    setSelectedBank(null);
  }, []);

  const handleCloned = useCallback(() => {
    onCloned?.();
    // After a clone, the Discover list itself doesn't change (clone_count
    // increments but the bank stays public). Still revalidate so the bumped
    // count surfaces on next view.
    mutate();
  }, [mutate, onCloned]);

  return (
    <div className="space-y-5">
      {/* Filter bar — kind chips + sort segmented control */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Kind chips */}
        <div className="flex gap-1.5 flex-wrap" role="group" aria-label="Filter by bank kind">
          {KINDS.map(k => {
            const isActive = kindFilter === k.id;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => setKindFilter(k.id)}
                aria-pressed={isActive}
                className={`press-feedback inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border font-syne text-xs font-bold transition-colors ${
                  isActive
                    ? "bg-electric/15 border-electric/50 text-cream"
                    : "bg-white/5 border-white/10 text-cream/70 hover:bg-white/10 hover:text-cream"
                }`}
              >
                <span aria-hidden="true">{k.emoji}</span>
                {k.label}
              </button>
            );
          })}
        </div>

        {/* Sort segmented control */}
        <div
          className="inline-flex rounded-full border border-white/10 bg-white/5 p-1"
          role="group"
          aria-label="Sort discover results"
        >
          {SORTS.map(s => {
            const isActive = sort === s.id;
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => setSort(s.id)}
                aria-pressed={isActive}
                className={`press-feedback px-3 py-1.5 rounded-full font-syne text-[11px] font-bold transition-colors ${
                  isActive
                    ? "bg-electric text-navy"
                    : "text-cream/70 hover:text-cream"
                }`}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Body */}
      {isLoading && banks.length === 0 ? (
        <DiscoverSkeleton />
      ) : error ? (
        <ErrorState onRetry={() => mutate()} />
      ) : banks.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {banks.map((bank, idx) => (
              <DiscoverCard
                key={bank.id}
                bank={bank}
                viewerId={viewerId}
                onClick={() => handleCardClick(bank)}
                index={idx}
              />
            ))}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-3">
              <button
                type="button"
                onClick={() => setOffset(prev => prev + PAGE_SIZE)}
                className="press-feedback inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
              >
                Load more
              </button>
            </div>
          )}
        </>
      )}

      {/* Preview modal — driven by the selected bank summary */}
      <BankPreviewModal
        summary={selectedBank}
        open={selectedBank !== null}
        onClose={handlePreviewClose}
        onCloned={handleCloned}
      />
    </div>
  );
}

/* ── Discover card ───────────────────────────────────────────────────── */

function DiscoverCard({
  bank,
  viewerId,
  onClick,
  index,
}: {
  bank: PublicBankSummary;
  viewerId: string | null;
  onClick: () => void;
  index: number;
}) {
  // Bucket C 2026-06-05 — closes the publish→see-it-published loop. Owner
  // sees their own bank in Discover with a "Yours" chip so they can verify
  // it landed without having to ask another user. Clone-from-self is still
  // blocked at the clone endpoint, so the chip is purely informational.
  const isYours = !!viewerId && bank.author.id === viewerId;
  const KindIcon = bank.kind === "language" ? GlobeHemisphereWest : BookOpen;
  const kindLabel = bank.kind === "language"
    ? `${(bank.source_lang ?? "?").toUpperCase()}/${(bank.target_lang ?? "?").toUpperCase()}`
    : "General";

  // Stable avatar fallback so cards don't flash a different identicon between
  // sort changes (same author seed → same image).
  const avatarUrl = bank.author.avatar_url
    ?? `https://api.dicebear.com/7.x/identicon/svg?seed=${encodeURIComponent(bank.author.username ?? bank.author.id)}`;

  return (
    <button
      type="button"
      onClick={onClick}
      className="press-feedback fluid-card-hover relative overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur p-4 pl-5 text-left transition-colors hover:bg-white/[0.07] hover:border-white/20 animate-slide-up"
      style={{ animationDelay: `${Math.min(index, 8) * 0.03}s` }}
      aria-label={`Preview ${bank.name} by ${bank.author.username ?? "anonymous"}`}
    >
      {/* Left-edge color stripe */}
      <div
        aria-hidden="true"
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{ background: bank.color }}
      />

      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0"
          style={{ background: `${bank.color}1F`, border: `1px solid ${bank.color}55` }}
        >
          {bank.icon}
        </span>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <p className="font-bebas text-lg tracking-wider text-cream leading-tight line-clamp-2">
              {bank.name}
            </p>
            <div className="shrink-0 inline-flex items-center gap-1.5">
              {isYours && (
                <span
                  className="inline-flex items-center px-1.5 py-0.5 rounded-md font-mono text-[9px] uppercase tracking-wider text-electric bg-electric/15 border border-electric/40"
                  title="This is your published bank"
                >
                  Yours
                </span>
              )}
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-white/5 border border-white/10 font-mono text-[9px] uppercase tracking-wider text-cream/70">
                <KindIcon size={9} weight="bold" aria-hidden="true" />
                {kindLabel}
              </span>
            </div>
          </div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/55">
            <span className="text-cream/80 tabular-nums">{bank.word_count}</span> words
            <span className="mx-1.5 text-cream/30">·</span>
            cloned <span className="text-cream/80 tabular-nums">{bank.clone_count}</span>{" "}
            {bank.clone_count === 1 ? "time" : "times"}
          </p>
        </div>
      </div>

      {/* Author attribution — bottom-right */}
      <div className="flex items-center justify-end gap-1.5 mt-3">
        <img
          src={avatarUrl}
          alt=""
          className="w-5 h-5 rounded-full object-cover bg-white/10"
          loading="lazy"
        />
        <span className="font-syne text-[11px] text-cream/65 truncate max-w-[60%]">
          {bank.author.username ?? "anonymous"}
        </span>
      </div>
    </button>
  );
}

/* ── States ──────────────────────────────────────────────────────────── */

function DiscoverSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {Array.from({ length: 4 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 h-[110px] animate-pulse"
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-7 sm:p-9 text-center animate-slide-up">
      <p className="font-bebas text-xl tracking-wider text-cream mb-2">
        No public banks yet
      </p>
      <p className="font-syne text-sm text-cream/65 max-w-sm mx-auto">
        Be the first to share one. Open the menu on any of your banks and toggle it public.
      </p>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
      <p className="font-syne text-sm text-red-300 mb-3">
        Couldn't load Discover. Network hiccup, probably.
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
      >
        <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}
