"use client";

import { useEffect, useMemo, useState } from "react";
import { BookOpen, MagnifyingGlass, CaretRight, CaretDown, X } from "@phosphor-icons/react";
import { MASTER_KB, POOL, INCIDENT_GROUPS } from "@/lib/liondesk/pool";
import { conceptForItem, conceptLabel, CONCEPTS, DEFAULT_CONCEPT } from "@/lib/liondesk/concepts";
import { getTrack } from "@/lib/helpdesk/tracks";
import type { Track } from "@/lib/helpdesk/types";
import type { KbArticle, ShiftItem } from "@/lib/liondesk/types";

// ── static, build time KB index (no localStorage, no server reads) ──────────
//
// Every pooled ticket (standalone + incident) that sends a player to read a KB
// article is reverse indexed, so each article inherits the concept (resolved via
// conceptForItem, the same mapping the rest of TechHub uses) and the track of the
// tickets that reference it. This is the "which concept/track it relates to"
// data the browser groups by. It is pure and deterministic: it is identical on
// the server and the client, so there is nothing here that can flash a zero.

interface KbRef { concepts: Set<string>; tracks: Set<Track> }

const KB_REFS = new Map<string, KbRef>();
function indexItem(item: ShiftItem, track: Track) {
  const id = item.kbArticleId;
  if (!id) return;
  let ref = KB_REFS.get(id);
  if (!ref) {
    ref = { concepts: new Set<string>(), tracks: new Set<Track>() };
    KB_REFS.set(id, ref);
  }
  ref.concepts.add(conceptForItem(item));
  ref.tracks.add(track);
}
for (const entry of POOL) indexItem(entry.item, entry.track);
for (const group of INCIDENT_GROUPS) {
  for (const item of group.items) indexItem(item, group.track);
}

// Concept display order (most specific first, General Support last) so a primary
// concept can be picked deterministically for any article that maps to several.
const CONCEPT_RANK = new Map<string, number>(CONCEPTS.map((c, i) => [c.id, i]));
function rankConcept(id: string): number {
  const r = CONCEPT_RANK.get(id);
  return r === undefined ? CONCEPTS.length : r;
}

interface KbMeta {
  article: KbArticle;
  /** Primary concept id: the most specific concept this article relates to. */
  primary: string;
  /** All related concept ids, ordered most specific first. */
  conceptIds: string[];
  /** Related track ids. */
  tracks: Track[];
  /** Precomputed lowercased haystack for the text filter. */
  search: string;
}

const KB_META: KbMeta[] = MASTER_KB.map((article) => {
  const ref = KB_REFS.get(article.id);
  const conceptIds =
    ref && ref.concepts.size > 0
      ? Array.from(ref.concepts).sort((a, b) => rankConcept(a) - rankConcept(b))
      : [DEFAULT_CONCEPT];
  const tracks = ref ? Array.from(ref.tracks) : [];
  const primary = conceptIds[0] ?? DEFAULT_CONCEPT;
  const trackNames = tracks.map((t) => getTrack(t)?.name ?? "").join(" ");
  const search = [
    article.title,
    article.tags.join(" "),
    article.body.join(" "),
    conceptIds.map(conceptLabel).join(" "),
    trackNames,
  ]
    .join(" ")
    .toLowerCase();
  return { article, primary, conceptIds, tracks, search };
});

// Group by primary concept, in concept display order, dropping empty groups.
const GROUPS = CONCEPTS.map((def) => ({
  def,
  metas: KB_META.filter((m) => m.primary === def.id),
})).filter((g) => g.metas.length > 0);

export default function KbBrowser() {
  // All article data above is static module data, so it never flashes a zero.
  // The mounted flag still follows the TechHub mount discipline: it keeps the
  // initial server and client paint identical (a light skeleton) and renders the
  // interactive, filtered list only once hydrated.
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [activeConcept, setActiveConcept] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => setMounted(true), []);

  const { visibleGroups, totalMatches } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const groups = GROUPS.filter((g) => activeConcept === "all" || g.def.id === activeConcept)
      .map((g) => ({
        def: g.def,
        metas: needle ? g.metas.filter((m) => m.search.includes(needle)) : g.metas,
      }))
      .filter((g) => g.metas.length > 0);
    const total = groups.reduce((n, g) => n + g.metas.length, 0);
    return { visibleGroups: groups, totalMatches: total };
  }, [query, activeConcept]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filters = [
    { id: "all", label: "All", count: KB_META.length },
    ...GROUPS.map((g) => ({ id: g.def.id, label: g.def.label, count: g.metas.length })),
  ];

  return (
    <div className="space-y-5">
      {/* Intro */}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{
          background: "linear-gradient(135deg, rgba(74,144,217,0.14) 0%, rgba(168,85,247,0.07) 55%, rgba(12,16,32,0.95) 100%)",
          border: "1px solid rgba(74,144,217,0.28)",
        }}
      >
        <div className="flex items-center gap-2">
          <BookOpen size={18} weight="fill" color="#4A90D9" aria-hidden="true" />
          <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">THE KNOWLEDGE BASE</h2>
        </div>
        <p className="text-cream/60 text-[12px] mt-1.5 leading-relaxed">
          Every article you can read on the desk, gathered in one place and grouped by the support concept it relates to.
          Search by title, body, tag, concept, or track, then open any article to study it. No clock, no pressure.
        </p>
      </div>

      {/* Controls: text filter + concept filter chips */}
      <div className="space-y-3">
        <div className="relative">
          <MagnifyingGlass size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-cream/40" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search the knowledge base"
            aria-label="Search knowledge base articles"
            className="w-full rounded-xl bg-white/[0.04] border border-white/10 pl-9 pr-9 py-2.5 text-sm text-cream placeholder:text-cream/35 focus:outline-none focus:border-[#4A90D9]/50 transition-colors"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-lg text-cream/45 hover:text-cream hover:bg-white/[0.06] transition-colors"
            >
              <X size={14} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {filters.map((c) => {
            const active = activeConcept === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setActiveConcept(c.id)}
                aria-pressed={active}
                className="font-mono text-[10px] px-2.5 py-1 min-h-[32px] rounded-full transition-colors"
                style={{
                  background: active ? "rgba(74,144,217,0.18)" : "rgba(255,255,255,0.03)",
                  color: active ? "#9DC3F0" : "rgba(238,244,255,0.55)",
                  border: `1px solid ${active ? "rgba(74,144,217,0.5)" : "rgba(255,255,255,0.1)"}`,
                }}
              >
                {c.label} ({c.count})
              </button>
            );
          })}
        </div>

        <p className="font-mono text-[10px] tabular-nums text-cream/45">
          {mounted ? `${totalMatches} of ${KB_META.length} articles` : `…/${KB_META.length} articles`}
        </p>
      </div>

      {/* Results */}
      {!mounted ? (
        <div className="space-y-3" aria-hidden="true">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
              <div className="h-3.5 w-2/3 rounded bg-white/10 motion-safe:animate-pulse" />
              <div className="flex gap-1.5 mt-2.5">
                <span className="h-3 w-16 rounded bg-white/10 motion-safe:animate-pulse" />
                <span className="h-3 w-12 rounded bg-white/10 motion-safe:animate-pulse" />
              </div>
            </div>
          ))}
        </div>
      ) : totalMatches === 0 ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] p-8 text-center">
          <MagnifyingGlass size={28} weight="regular" className="mx-auto mb-3 text-cream/40" aria-hidden="true" />
          <p className="text-cream/70 text-sm">No articles match your search.</p>
          <p className="text-cream/45 text-xs mt-1">Try a different word, or clear the filter to see all {KB_META.length} articles.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {visibleGroups.map((g) => (
            <section key={g.def.id}>
              <div className="flex items-baseline justify-between gap-2 mb-0.5">
                <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">{g.def.label}</h2>
                <span className="font-mono text-[10px] tabular-nums text-cream/45 flex-shrink-0">
                  {g.metas.length} {g.metas.length === 1 ? "article" : "articles"}
                </span>
              </div>
              <p className="text-cream/50 text-[11px]">{g.def.blurb}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-cream/35 mt-1 mb-2.5">builds toward {g.def.cert}</p>

              <div className="space-y-2">
                {g.metas.map((meta) => {
                  const open = expanded.has(meta.article.id);
                  const bodyId = `kb-article-${meta.article.id}`;
                  return (
                    <div key={meta.article.id} className="rounded-xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
                      <button
                        type="button"
                        onClick={() => toggle(meta.article.id)}
                        aria-expanded={open}
                        aria-controls={bodyId}
                        className="w-full text-left flex items-start gap-2.5 p-3 min-h-[44px] rounded-xl hover:bg-white/[0.03] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4A90D9]/50"
                      >
                        <span className="flex-shrink-0 mt-0.5 text-cream/40" aria-hidden="true">
                          {open ? <CaretDown size={15} weight="bold" /> : <CaretRight size={15} weight="bold" />}
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block font-syne font-semibold text-[13px] text-cream">{meta.article.title}</span>
                          <span className="flex flex-wrap gap-1.5 mt-1.5">
                            {meta.tracks.map((t) => {
                              const td = getTrack(t);
                              const color = td?.color ?? "#4A90D9";
                              return (
                                <span
                                  key={t}
                                  className="inline-flex items-center font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                  style={{ color, background: `${color}1a`, border: `1px solid ${color}40` }}
                                >
                                  {td?.name ?? t}
                                </span>
                              );
                            })}
                            {meta.conceptIds.slice(1).map((cid) => (
                              <span
                                key={cid}
                                className="inline-flex items-center font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded"
                                style={{ color: "#C9A2F2", background: "rgba(168,85,247,0.12)", border: "1px solid rgba(168,85,247,0.34)" }}
                              >
                                {conceptLabel(cid)}
                              </span>
                            ))}
                            {meta.article.tags.map((tag, i) => (
                              <span
                                key={`${meta.article.id}-tag-${i}`}
                                className="inline-flex items-center font-mono text-[9px] tracking-wide px-1.5 py-0.5 rounded text-cream/45 bg-white/[0.04] border border-white/[0.08]"
                              >
                                {tag}
                              </span>
                            ))}
                          </span>
                        </span>
                      </button>

                      {/* Always rendered so aria-controls always resolves to a real
                          element; visibility is toggled via the native hidden attribute. */}
                      <div id={bodyId} hidden={!open} className="px-3 pb-3 pt-2.5 space-y-2 border-t border-white/[0.06]">
                        {meta.article.body.map((para, i) => (
                          <p key={i} className="text-cream/70 text-[13px] leading-relaxed">{para}</p>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}

      <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
        A read only study reference drawn from the same articles the shifts use. It grants nothing (the economy stays server authoritative).
      </p>
    </div>
  );
}
