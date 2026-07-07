"use client";

// Study Sets hub — my decks grid + the "Make me a study set" CTA.
//
// Data: GET /api/study-sets (owner-only list + per-deck due counts).
// FAIL-SOFT: while the HELD 20260702130000 migration is unapplied the API
// returns { sets: [], notReady: true } — we show honest copy and keep the
// generate CTA alive (generation is preview-only and works without tables).

import Link from "next/link";
import useSWR from "swr";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/lib/auth";
import { apiGet } from "@/lib/api-client";
import {
  Stack,
  Sparkle,
  ArrowRight,
  Cards,
  Target,
} from "@phosphor-icons/react";

const ORANGE = "#FB923C";

interface SetSummary {
  id: string;
  title: string;
  description: string | null;
  subject: string | null;
  card_count: number;
  dueCount: number;
  created_at: string;
  updated_at: string;
}

interface ListResponse {
  sets: SetSummary[];
  notReady?: boolean;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function StudySetsPage() {
  const { user } = useAuth();
  // Reduced motion: the local @media rules below disable the entrance
  // animation and the skeleton shimmer entirely.

  const { data, error, isLoading, mutate } = useSWR(
    user?.id ? `study-sets/${user.id}` : null,
    async () => {
      const res = await apiGet<ListResponse>("/api/study-sets");
      // THROW on failure (don't collapse to an empty deck list) so a failed
      // fetch can't masquerade as "No decks yet" — a user WITH saved decks would
      // otherwise think they vanished on any transient API blip.
      if (!res.ok) throw new Error(res.error ?? "Couldn't load your decks");
      return res.data ?? { sets: [], notReady: false };
    },
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const sets = data?.sets ?? [];
  const notReady = data?.notReady === true;
  const loading = data === undefined && isLoading;
  // Only surface the error state when we have NOTHING to show; keepPreviousData
  // means a revalidation error still leaves the last-good decks on screen.
  const loadError = !!error && data === undefined;

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(16px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) both; }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
        .skeleton-shimmer {
          background: linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 37%, rgba(255,255,255,0.04) 63%);
          background-size: 400% 100%;
          animation: skeleton-shimmer 1.4s ease-in-out infinite;
        }
        @keyframes skeleton-shimmer {
          0% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        @media (prefers-reduced-motion: reduce) {
          .skeleton-shimmer { animation: none; }
        }
      `}</style>

      <FeatureGate feature="learn">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <BackButton href="/learn" label="Learn" />

            {/* Header */}
            <header className="mb-6 flex items-center gap-3 animate-slide-up">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${ORANGE}18`, border: `1px solid ${ORANGE}40` }}
              >
                <Stack size={20} weight="duotone" color={ORANGE} aria-hidden="true" />
              </div>
              <div>
                <h1 className="font-bebas text-3xl sm:text-4xl text-cream tracking-[0.06em] leading-none">
                  Study Sets
                </h1>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55 mt-1">
                  paste anything · instant deck
                </p>
              </div>
            </header>

            {/* Honest degraded note while the HELD migration is unapplied */}
            {notReady && (
              <div
                className="mb-5 rounded-xl border px-4 py-3 animate-slide-up"
                style={{ background: "rgba(245,158,11,0.08)", borderColor: "rgba(245,158,11,0.3)" }}
              >
                <p className="font-syne text-sm text-amber-300/90">
                  Study sets are almost ready. You can generate and preview decks
                  right now, but saving them is waiting on a database update.
                </p>
              </div>
            )}

            {/* Big generate CTA */}
            <Link
              href="/learn/sets/new"
              className="fluid-card-hover press-feedback group block rounded-[10px] p-6 sm:p-7 mb-8 animate-slide-up"
              style={{
                background: `linear-gradient(110deg, ${ORANGE}14 0%, rgba(74,144,217,0.06) 60%, rgba(12,16,32,0.95) 100%)`,
                border: `1px solid ${ORANGE}38`,
                boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
              }}
            >
              <div className="flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] mb-2" style={{ color: ORANGE }}>
                    ninny builds it
                  </p>
                  <p className="font-bebas text-2xl sm:text-3xl text-cream tracking-wider leading-tight">
                    Make me a study set
                  </p>
                  <p className="text-cream/70 text-xs sm:text-sm mt-1.5">
                    Paste notes, a syllabus, or a topic. Ninny turns it into a deck of
                    flashcards and quiz questions you can trim before saving.
                  </p>
                </div>
                <div
                  className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center transition-transform duration-200 group-hover:translate-x-1"
                  style={{ background: `${ORANGE}1E`, border: `1px solid ${ORANGE}59` }}
                >
                  <Sparkle size={20} weight="duotone" color={ORANGE} aria-hidden="true" />
                </div>
              </div>
            </Link>

            {/* Deck grid */}
            <section className="animate-slide-up">
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-bebas text-sm text-cream tracking-[0.2em]">MY DECKS</h2>
                <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">
                  {loading ? (
                    <span className="skeleton-shimmer rounded h-3 w-16 inline-block align-middle" aria-hidden="true" />
                  ) : (
                    <>{sets.length} {sets.length === 1 ? "deck" : "decks"}</>
                  )}
                </p>
              </div>

              {loading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" aria-hidden="true">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="rounded-[10px] border border-white/[0.06] p-5">
                      <span className="skeleton-shimmer rounded h-4 w-2/3 block mb-3" />
                      <span className="skeleton-shimmer rounded h-3 w-1/3 block" />
                    </div>
                  ))}
                </div>
              ) : loadError ? (
                <div className="py-10 border-y border-white/[0.04] text-center">
                  <Cards size={28} weight="duotone" color={ORANGE} aria-hidden="true" className="mx-auto mb-3" />
                  <p className="text-cream/70 text-sm mb-1">Couldn&apos;t load your decks.</p>
                  <p className="text-cream/50 text-xs mb-4">Your decks are safe on the server.</p>
                  <button
                    onClick={() => mutate()}
                    className="font-bebas tracking-wider text-sm px-5 py-2 rounded-lg transition-colors"
                    style={{ background: `${ORANGE}20`, border: `1px solid ${ORANGE}55`, color: ORANGE }}
                  >
                    Try again
                  </button>
                </div>
              ) : sets.length === 0 ? (
                <div className="py-10 border-y border-white/[0.04] text-center">
                  <Cards size={28} weight="duotone" color={ORANGE} aria-hidden="true" className="mx-auto mb-3" />
                  <p className="text-cream/70 text-sm mb-1">No decks yet.</p>
                  <p className="text-cream/50 text-xs">
                    Paste anything into the generator above and Ninny does the rest.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {sets.map((s) => (
                    <Link
                      key={s.id}
                      href={`/learn/sets/${s.id}`}
                      className="press-feedback group rounded-[10px] border p-5 transition-colors hover:bg-white/[0.03]"
                      style={{ borderColor: "rgba(255,255,255,0.07)" }}
                      aria-label={`${s.title}, ${s.card_count} card${s.card_count === 1 ? "" : "s"}${s.dueCount > 0 ? `, ${s.dueCount} due for review` : ""}`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="font-syne font-semibold text-sm text-cream leading-snug line-clamp-2">
                          {s.title}
                        </p>
                        {s.dueCount > 0 && (
                          <span
                            className="flex-shrink-0 inline-flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded"
                            style={{ background: `${ORANGE}1A`, color: ORANGE, border: `1px solid ${ORANGE}40` }}
                          >
                            <Target size={9} weight="fill" aria-hidden="true" />
                            {s.dueCount} due
                          </span>
                        )}
                      </div>
                      {s.description && (
                        <p className="text-cream/55 text-xs leading-relaxed line-clamp-2 mb-3">
                          {s.description}
                        </p>
                      )}
                      <div className="flex items-center gap-2 font-mono text-[10px] text-cream/50">
                        <span className="tabular-nums">{s.card_count} card{s.card_count === 1 ? "" : "s"}</span>
                        {s.subject && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="truncate">{s.subject}</span>
                          </>
                        )}
                        <span className="ml-auto">{timeAgo(s.updated_at)}</span>
                        <ArrowRight
                          size={12}
                          weight="regular"
                          aria-hidden="true"
                          className="text-cream/40 group-hover:translate-x-0.5 transition-transform"
                        />
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </div>
        </div>
      </FeatureGate>
    </ProtectedRoute>
  );
}
