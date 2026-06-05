"use client";

/**
 * VocabList — Tab C of /learn/vocab.
 *
 * Redesigned as an Excel-style dense list with:
 * - Inline add-row pinned at top (rapid-fire add via Enter)
 * - Confidence dots (click to cycle: confident → shaky → struggling → auto)
 * - 2px left-edge stripe + row background wash tinted by confidence
 * - Magnifier popover for quick lookup (translate/define, cached per word)
 * - Filter chips: All / Locked in / Shaky / Struggling / New
 * - Desktop: CSS grid layout; Mobile: stacked cards
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { MagnifyingGlass, Trash, ClockCounterClockwise } from "@phosphor-icons/react";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import ConfirmModal from "@/components/ConfirmModal";
import { toastError, toastSuccess } from "@/lib/toast";
import type { VocabBank } from "./CreateBankModal";
import type { VocabWord } from "./ReviewQueue";

type Sort = "recent" | "most_reviewed" | "lowest_accuracy";
type ConfidenceFilter = "all" | "confident" | "shaky" | "struggling" | "new";
type DerivedConfidence = "confident" | "shaky" | "struggling" | "new";

const SORT_LABEL: Record<Sort, string> = {
  recent: "Recently added",
  most_reviewed: "Most reviewed",
  lowest_accuracy: "Lowest accuracy",
};

const FILTER_LABELS: Record<ConfidenceFilter, string> = {
  all: "All",
  confident: "Locked in",
  shaky: "Shaky",
  struggling: "Struggling",
  new: "New",
};

const CONFIDENCE_COLORS = {
  confident: "#22C55E",
  shaky: "#FFD700",
  struggling: "#F97316",
  new: "rgba(238,244,255,0.45)",
} as const;

function getConfidenceWash(conf: DerivedConfidence): string {
  const hex = CONFIDENCE_COLORS[conf];
  if (conf === "new") return "rgba(238,244,255,0.03)";
  return `${hex}14`; // ~8% alpha in hex
}

function deriveConfidence(w: VocabWord): DerivedConfidence {
  if (w.self_confidence) return w.self_confidence;
  if (w.review_count === 0) return "new";
  const accuracy = (w.correct_count / w.review_count) * 100;
  if (accuracy >= 80) return "confident";
  if (accuracy >= 60) return "shaky";
  return "struggling";
}

function timeUntil(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff <= 0) return "due now";
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `in ${hrs}h`;
  return `in ${Math.floor(hrs / 24)}d`;
}

function getAccuracyColor(w: VocabWord): string {
  if (w.review_count === 0) return "rgba(238,244,255,0.45)";
  const acc = (w.correct_count / w.review_count) * 100;
  return acc >= 80 ? "#22C55E" : acc >= 60 ? "#FFD700" : "#F97316";
}

interface Props {
  bank: VocabBank;
}

interface LookupResult {
  text: string | null;
  error?: string;
  loading?: boolean;
}

export default function VocabList({ bank }: Props) {
  const { data, isLoading, mutate } = useSWR<{ words: VocabWord[] }>(
    `/api/vocab/words?bank_id=${encodeURIComponent(bank.id)}`,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>("recent");
  const [confidenceFilter, setConfidenceFilter] = useState<ConfidenceFilter>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; label: string } | null>(null);
  const [lookupCache, setLookupCache] = useState<Map<string, LookupResult>>(new Map());
  const [activePopover, setActivePopover] = useState<string | null>(null);
  const cycleRevRef = useRef(0);

  const words = data?.words ?? [];
  const isLanguageBank = bank.kind === "language";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = words.filter((w) => {
      if (q.length > 0) {
        const front = (w.word ?? w.term ?? "").toLowerCase();
        const back = (w.translation ?? w.term_definition ?? "").toLowerCase();
        const self = w.user_definition.toLowerCase();
        if (!front.includes(q) && !back.includes(q) && !self.includes(q)) return false;
      }
      if (confidenceFilter !== "all") {
        const derived = deriveConfidence(w);
        if (derived !== confidenceFilter) return false;
      }
      return true;
    });
    const sorted = [...list];
    if (sort === "most_reviewed") {
      sorted.sort((a, b) => b.review_count - a.review_count);
    } else if (sort === "lowest_accuracy") {
      sorted.sort((a, b) => {
        const accA = a.review_count > 0 ? a.correct_count / a.review_count : 1;
        const accB = b.review_count > 0 ? b.correct_count / b.review_count : 1;
        return accA - accB;
      });
    }
    return sorted;
  }, [words, query, sort, confidenceFilter]);

  const handleDelete = (id: string, label: string) => {
    setPendingDelete({ id, label });
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const { id } = pendingDelete;
    setDeletingId(id);
    try {
      const { ok, error } = await apiDelete(`/api/vocab/words/${id}`);
      if (!ok) {
        toastError(error ?? "Couldn't delete that entry.");
        throw new Error(error ?? "delete failed");
      }
      toastSuccess("Entry removed.");
      setPendingDelete(null);
      mutate();
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.includes("delete failed")) {
        toastError(e instanceof Error ? e.message : "Delete failed.");
      }
      throw e instanceof Error ? e : new Error("Delete failed.");
    } finally {
      setDeletingId(null);
    }
  };

  const handleConfidenceCycle = useCallback(
    async (w: VocabWord) => {
      const myRev = ++cycleRevRef.current;

      const cycle: Array<VocabWord["self_confidence"]> = ["confident", "shaky", "struggling", null];
      const currentIdx = cycle.indexOf(w.self_confidence ?? null);
      const nextVal = cycle[(currentIdx + 1) % cycle.length];

      const prevWords = data?.words ?? [];
      const optimistic = prevWords.map((word) =>
        word.id === w.id ? { ...word, self_confidence: nextVal } : word,
      );
      mutate({ words: optimistic }, false);

      const toastMsg =
        nextVal === "confident"
          ? "Marked as locked in"
          : nextVal === "shaky"
            ? "Marked as shaky"
            : nextVal === "struggling"
              ? "Marked as struggling"
              : "Confidence reset to auto";

      try {
        const { ok } = await apiPatch(`/api/vocab/words/${w.id}`, { self_confidence: nextVal });
        if (!ok) {
          if (myRev !== cycleRevRef.current) return;
          mutate({ words: prevWords }, false);
          toastError("Couldn't save. Try again.");
          return;
        }
        toastSuccess(toastMsg);
      } catch {
        if (myRev !== cycleRevRef.current) return;
        mutate({ words: prevWords }, false);
        toastError("Couldn't save. Try again.");
      }
    },
    [data, mutate],
  );

  const fetchLookup = useCallback(
    async (w: VocabWord) => {
      if (lookupCache.has(w.id) && !lookupCache.get(w.id)?.loading) return;

      setLookupCache((prev) => new Map(prev).set(w.id, { text: null, loading: true }));

      try {
        if (isLanguageBank) {
          const { ok, data: res } = await apiPost<{ translation: string }>("/api/vocab/translate", {
            word: w.word ?? w.term ?? "",
            source: w.source_lang,
            target: w.target_lang,
            bank_id: bank.id,
          });
          if (ok && res) {
            setLookupCache((prev) => new Map(prev).set(w.id, { text: res.translation }));
          } else {
            setLookupCache((prev) => new Map(prev).set(w.id, { text: null, error: "Lookup failed. Try again." }));
          }
        } else {
          const { ok, data: res } = await apiPost<{ definition: string }>("/api/vocab/define", {
            term: w.word ?? w.term ?? "",
            bank_id: bank.id,
          });
          if (ok && res) {
            setLookupCache((prev) => new Map(prev).set(w.id, { text: res.definition }));
          } else {
            setLookupCache((prev) => new Map(prev).set(w.id, { text: null, error: "Lookup failed. Try again." }));
          }
        }
      } catch {
        setLookupCache((prev) => new Map(prev).set(w.id, { text: null, error: "Lookup failed. Try again." }));
      }
    },
    [lookupCache, isLanguageBank, bank.id],
  );

  const handleMagnifierClick = useCallback(
    (w: VocabWord) => {
      if (activePopover === w.id) {
        setActivePopover(null);
      } else {
        setActivePopover(w.id);
        fetchLookup(w);
      }
    },
    [activePopover, fetchLookup],
  );

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActivePopover(null);
    };
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-popover]") && !target.closest("[data-magnifier]")) {
        setActivePopover(null);
      }
    };
    document.addEventListener("keydown", handleEsc);
    document.addEventListener("click", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.removeEventListener("click", handleClickOutside);
    };
  }, []);

  const filterCounts = useMemo(() => {
    const counts: Record<ConfidenceFilter, number> = { all: words.length, confident: 0, shaky: 0, struggling: 0, new: 0 };
    words.forEach((w) => {
      const d = deriveConfidence(w);
      counts[d]++;
    });
    return counts;
  }, [words]);

  const emptyMessage = useMemo(() => {
    if (words.length === 0) return "No entries yet. Add your first one above.";
    if (query.trim().length > 0) return "Nothing matches that search.";
    if (confidenceFilter === "confident") return "Nothing locked in yet. Keep reviewing.";
    if (confidenceFilter === "shaky") return "No shaky terms right now.";
    if (confidenceFilter === "struggling") return "Nothing struggling. Nice.";
    if (confidenceFilter === "new") return "No unreviewed terms.";
    return "No entries match the current filters.";
  }, [words.length, query, confidenceFilter]);

  return (
    <div className="space-y-4">
      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(FILTER_LABELS) as ConfidenceFilter[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setConfidenceFilter(key)}
            className={`px-3 py-1.5 rounded-full font-mono text-[10px] uppercase tracking-[0.15em] transition-colors border ${
              confidenceFilter === key
                ? "bg-electric/20 border-electric/50 text-electric"
                : "bg-white/5 border-white/10 text-cream/60 hover:bg-white/10"
            }`}
          >
            {FILTER_LABELS[key]}
            {key !== "all" && (
              <span className="ml-1.5 text-cream/40">{filterCounts[key]}</span>
            )}
          </button>
        ))}
      </div>

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
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${bank.name}`}
            className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-electric/60 focus:bg-white/[0.07] transition-colors"
            aria-label="Search bank"
          />
        </div>
        <label className="inline-flex items-center gap-2 rounded-xl bg-white/5 border border-white/10 px-3 py-2 text-cream/75 text-xs font-syne">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55">sort</span>
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as Sort)}
            className="bg-transparent text-cream font-syne text-sm focus:outline-none cursor-pointer"
            aria-label="Sort vocab list"
          >
            {(Object.keys(SORT_LABEL) as Sort[]).map((k) => (
              <option key={k} value={k} className="bg-navy text-cream">
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
        {filtered.length} {filtered.length === 1 ? "entry" : "entries"} in {bank.name}
      </p>

      {/* Inline add row */}
      <AddWordRow bank={bank} onAdded={() => mutate()} />

      {isLoading && !data ? (
        <div className="rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-10 text-center">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-cream/55">loading...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl bg-white/[0.03] backdrop-blur border border-white/[0.06] p-10 text-center">
          <p className="font-syne text-sm text-cream/65">{emptyMessage}</p>
        </div>
      ) : (
        <>
          {/* Desktop grid */}
          <div className="hidden sm:block rounded-2xl bg-white/5 backdrop-blur border border-white/10 overflow-hidden">
            <div
              className="grid items-center px-3 py-2 border-b border-white/10 text-cream/45 font-mono text-[9px] uppercase tracking-[0.2em]"
              style={{
                gridTemplateColumns: "2px minmax(140px,1.2fr) minmax(160px,1.5fr) minmax(120px,1fr) 48px 56px 80px 28px 28px",
                columnGap: "12px",
              }}
            >
              <span />
              <span>{isLanguageBank ? "Word" : "Term"}</span>
              <span>{isLanguageBank ? "Translation" : "Definition"}</span>
              <span>Note</span>
              <span className="text-center">Conf</span>
              <span className="text-center">Acc</span>
              <span>Next</span>
              <span />
              <span />
            </div>
            {filtered.map((w) => (
              <VocabRow
                key={w.id}
                word={w}
                bank={bank}
                isLanguageBank={isLanguageBank}
                onDelete={handleDelete}
                deleting={deletingId === w.id}
                onConfidenceCycle={handleConfidenceCycle}
                lookupCache={lookupCache}
                activePopover={activePopover}
                onMagnifierClick={handleMagnifierClick}
              />
            ))}
          </div>

          {/* Mobile cards */}
          <ul className="sm:hidden space-y-2">
            {filtered.map((w) => (
              <VocabCard
                key={w.id}
                word={w}
                bank={bank}
                isLanguageBank={isLanguageBank}
                onDelete={handleDelete}
                deleting={deletingId === w.id}
                onConfidenceCycle={handleConfidenceCycle}
                lookupCache={lookupCache}
                activePopover={activePopover}
                onMagnifierClick={handleMagnifierClick}
              />
            ))}
          </ul>
        </>
      )}
      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => { await confirmDelete(); }}
        title="Delete this entry?"
        message={pendingDelete ? `"${pendingDelete.label}" will be removed from ${bank.name}. This can't be undone.` : undefined}
        confirmLabel="Delete"
        destructive
      />
    </div>
  );
}

/* ── AddWordRow ─────────────────────────────────────────────────────────────── */

interface AddWordRowProps {
  bank: VocabBank;
  onAdded: () => void;
}

function AddWordRow({ bank, onAdded }: AddWordRowProps) {
  const isLanguageBank = bank.kind === "language";
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [saving, setSaving] = useState(false);
  const frontRef = useRef<HTMLInputElement>(null);

  const handleSave = async () => {
    const frontClean = front.trim();
    const backClean = back.trim();
    if (!frontClean || !backClean || saving) return;

    setSaving(true);
    try {
      const body: Record<string, unknown> = { bank_id: bank.id };
      if (isLanguageBank) {
        body.word = frontClean;
        body.translation = backClean;
        body.source_lang = bank.source_lang;
        body.target_lang = bank.target_lang;
      } else {
        body.term = frontClean;
        body.term_definition = backClean;
        body.definition_source = "manual";
      }

      const { ok, error, status } = await apiPost("/api/vocab/words", body);
      if (!ok) {
        if (status === 409) {
          toastError("Already in this bank.");
        } else {
          toastError(error ?? "Couldn't save. Try again.");
        }
        return;
      }
      toastSuccess("Saved!");
      setFront("");
      setBack("");
      frontRef.current?.focus();
      onAdded();
    } catch {
      toastError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && front.trim() && back.trim()) {
      e.preventDefault();
      handleSave();
    } else if (e.key === "Escape") {
      setFront("");
      setBack("");
    }
  };

  return (
    <div className="rounded-xl bg-white/[0.03] border border-dashed border-white/15 px-3 py-2">
      <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center">
        <input
          ref={frontRef}
          type="text"
          value={front}
          onChange={(e) => setFront(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLanguageBank ? "Word" : "Term"}
          maxLength={50}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-electric/50 transition-colors"
          disabled={saving}
        />
        <input
          type="text"
          value={back}
          onChange={(e) => setBack(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isLanguageBank ? "Translation" : "Definition"}
          maxLength={200}
          className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-electric/50 transition-colors"
          disabled={saving}
        />
        <span className="hidden sm:inline font-mono text-[9px] uppercase tracking-wider text-cream/35 whitespace-nowrap">
          Enter to save
        </span>
      </div>
    </div>
  );
}

/* ── ConfidenceDot ──────────────────────────────────────────────────────────── */

interface ConfidenceDotProps {
  word: VocabWord;
  onClick: () => void;
}

function ConfidenceDot({ word, onClick }: ConfidenceDotProps) {
  const derived = deriveConfidence(word);
  const isAuto = word.self_confidence === null || word.self_confidence === undefined;
  const color = CONFIDENCE_COLORS[derived];

  return (
    <button
      type="button"
      onClick={onClick}
      className="flex flex-col items-center gap-0.5 p-1 rounded hover:bg-white/10 transition-colors"
      aria-label={`Confidence: ${derived}. Click to change.`}
    >
      <span
        className="w-2.5 h-2.5 rounded-full"
        style={{ backgroundColor: color }}
      />
      {isAuto && (
        <span className="text-[8px] uppercase tracking-wider text-cream/40">auto</span>
      )}
    </button>
  );
}

/* ── LookupPopover ──────────────────────────────────────────────────────────── */

interface LookupPopoverProps {
  result: LookupResult | undefined;
}

function LookupPopover({ result }: LookupPopoverProps) {
  if (!result) return null;

  return (
    <div
      data-popover
      className="absolute right-0 top-full mt-2 z-50 max-w-sm rounded-xl bg-navy/95 backdrop-blur border border-white/15 shadow-xl p-3 animate-slide-up"
      style={{ minWidth: 200 }}
    >
      {result.loading ? (
        <p className="font-syne text-xs text-cream/55 italic">Looking it up...</p>
      ) : result.error ? (
        <p className="font-syne text-xs text-red-300/85">{result.error}</p>
      ) : result.text ? (
        <p className="font-syne text-sm text-cream/90 leading-relaxed">{result.text}</p>
      ) : (
        <p className="font-syne text-xs text-cream/55 italic">No results found. Check your spelling.</p>
      )}
    </div>
  );
}

/* ── VocabRow (desktop) ─────────────────────────────────────────────────────── */

interface VocabRowProps {
  word: VocabWord;
  bank: VocabBank;
  isLanguageBank: boolean;
  onDelete: (id: string, label: string) => void;
  deleting: boolean;
  onConfidenceCycle: (w: VocabWord) => void;
  lookupCache: Map<string, LookupResult>;
  activePopover: string | null;
  onMagnifierClick: (w: VocabWord) => void;
}

function VocabRow({
  word: w,
  bank,
  isLanguageBank,
  onDelete,
  deleting,
  onConfidenceCycle,
  lookupCache,
  activePopover,
  onMagnifierClick,
}: VocabRowProps) {
  const front = w.word ?? w.term ?? "";
  const back = w.translation ?? w.term_definition ?? "";
  const note = w.user_definition || "";
  const derived = deriveConfidence(w);
  const stripeColor = CONFIDENCE_COLORS[derived];
  const washColor = getConfidenceWash(derived);
  const accuracy = w.review_count > 0 ? Math.round((w.correct_count / w.review_count) * 100) : null;
  const accColor = getAccuracyColor(w);

  return (
    <div
      className="relative grid items-center px-3 py-2 border-b border-white/5 hover:bg-white/[0.02] transition-colors"
      style={{
        gridTemplateColumns: "2px minmax(140px,1.2fr) minmax(160px,1.5fr) minmax(120px,1fr) 48px 56px 80px 28px 28px",
        columnGap: "12px",
        backgroundColor: washColor,
      }}
    >
      {/* Stripe */}
      <span
        className="absolute left-0 top-0 bottom-0 w-0.5"
        style={{ backgroundColor: stripeColor }}
      />
      <span />

      {/* Front */}
      <p className="font-bebas text-base tracking-wider text-cream truncate">{front}</p>

      {/* Back */}
      <p
        className={
          isLanguageBank
            ? "font-syne text-sm text-electric/90 truncate"
            : "font-syne text-xs text-electric/85 truncate"
        }
      >
        {back}
      </p>

      {/* Note */}
      <p className="font-syne text-xs text-cream/55 italic truncate">{note || "—"}</p>

      {/* Confidence dot */}
      <div className="flex justify-center">
        <ConfidenceDot word={w} onClick={() => onConfidenceCycle(w)} />
      </div>

      {/* Accuracy */}
      <div className="flex justify-center">
        {accuracy !== null ? (
          <span
            className="px-1.5 py-0.5 rounded-full font-bebas text-xs tabular-nums tracking-wider"
            style={{
              background: `${accColor}18`,
              color: accColor,
              border: `1px solid ${accColor}40`,
            }}
          >
            {accuracy}%
          </span>
        ) : (
          <span className="text-cream/30 text-xs">—</span>
        )}
      </div>

      {/* Next review */}
      <span className="font-mono text-[9px] uppercase tracking-wider text-cream/45 inline-flex items-center gap-1">
        <ClockCounterClockwise size={10} weight="bold" aria-hidden="true" />
        {timeUntil(w.next_review_at)}
      </span>

      {/* Magnifier */}
      <div className="relative">
        <button
          type="button"
          data-magnifier
          onClick={() => onMagnifierClick(w)}
          className="p-1 rounded text-cream/40 hover:text-electric hover:bg-electric/10 transition-colors"
          aria-label="Look up definition"
        >
          <MagnifyingGlass size={14} weight="bold" />
        </button>
        {activePopover === w.id && <LookupPopover result={lookupCache.get(w.id)} />}
      </div>

      {/* Delete */}
      <button
        type="button"
        onClick={() => onDelete(w.id, front)}
        disabled={deleting}
        className="p-1 rounded text-cream/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
        aria-label={`Delete ${front}`}
      >
        <Trash size={14} weight="bold" />
      </button>
    </div>
  );
}

/* ── VocabCard (mobile) ─────────────────────────────────────────────────────── */

interface VocabCardProps {
  word: VocabWord;
  bank: VocabBank;
  isLanguageBank: boolean;
  onDelete: (id: string, label: string) => void;
  deleting: boolean;
  onConfidenceCycle: (w: VocabWord) => void;
  lookupCache: Map<string, LookupResult>;
  activePopover: string | null;
  onMagnifierClick: (w: VocabWord) => void;
}

function VocabCard({
  word: w,
  bank,
  isLanguageBank,
  onDelete,
  deleting,
  onConfidenceCycle,
  lookupCache,
  activePopover,
  onMagnifierClick,
}: VocabCardProps) {
  const front = w.word ?? w.term ?? "";
  const back = w.translation ?? w.term_definition ?? "";
  const note = w.user_definition || "";
  const derived = deriveConfidence(w);
  const stripeColor = CONFIDENCE_COLORS[derived];
  const washColor = getConfidenceWash(derived);
  const accuracy = w.review_count > 0 ? Math.round((w.correct_count / w.review_count) * 100) : null;
  const accColor = getAccuracyColor(w);

  return (
    <li
      className="relative rounded-lg bg-white/5 backdrop-blur border border-white/10 p-3 space-y-2"
      style={{ backgroundColor: washColor }}
    >
      {/* Stripe */}
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-lg"
        style={{ backgroundColor: stripeColor }}
      />

      {/* Row 1: front + confidence + accuracy */}
      <div className="flex items-center gap-2">
        <p className="flex-1 font-bebas text-lg tracking-wider text-cream truncate">{front}</p>
        <ConfidenceDot word={w} onClick={() => onConfidenceCycle(w)} />
        {accuracy !== null && (
          <span
            className="px-1.5 py-0.5 rounded-full font-bebas text-xs tabular-nums tracking-wider"
            style={{
              background: `${accColor}18`,
              color: accColor,
              border: `1px solid ${accColor}40`,
            }}
          >
            {accuracy}%
          </span>
        )}
      </div>

      {/* Row 2: back */}
      {back && (
        <p
          className={
            isLanguageBank
              ? "font-syne text-sm text-electric/90"
              : "font-syne text-xs text-electric/85 line-clamp-2"
          }
        >
          {back}
        </p>
      )}

      {/* Row 3: note */}
      {note && (
        <p className="font-syne text-xs text-cream/55 italic line-clamp-2">&ldquo;{note}&rdquo;</p>
      )}

      {/* Row 4: next review + actions */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-cream/45 inline-flex items-center gap-1">
          <ClockCounterClockwise size={10} weight="bold" aria-hidden="true" />
          {timeUntil(w.next_review_at)}
        </span>
        <div className="flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              data-magnifier
              onClick={() => onMagnifierClick(w)}
              className="p-1.5 rounded text-cream/40 hover:text-electric hover:bg-electric/10 transition-colors"
              aria-label="Look up definition"
            >
              <MagnifyingGlass size={14} weight="bold" />
            </button>
            {activePopover === w.id && <LookupPopover result={lookupCache.get(w.id)} />}
          </div>
          <button
            type="button"
            onClick={() => onDelete(w.id, front)}
            disabled={deleting}
            className="p-1.5 rounded text-cream/40 hover:text-red-400 hover:bg-red-400/10 transition-colors disabled:opacity-30"
            aria-label={`Delete ${front}`}
          >
            <Trash size={14} weight="bold" />
          </button>
        </div>
      </div>
    </li>
  );
}
