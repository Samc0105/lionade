"use client";

// /library — the Community Study-Set Library.
//
// Browse public study sets: search by title, filter by subject, clone a set
// into your own collection (free), tip the creator in Fangs (25/50/100), or
// report a set. Share links (/library?set=<id>) pin the shared set above the
// grid.
//
// Data: GET /api/library (first page via SWR, "Load more" appends pages).
// Fail-soft: while the HELD library migrations are unapplied the API returns
// { sets: [], unavailable: true } and this page renders an honest "not live
// yet" state. Tipping additionally self-disables for the session when the
// server answers tipsPending (ledger migration 20260702090000 unapplied).

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import BackButton from "@/components/BackButton";
import { useAuth } from "@/lib/auth";
import { apiGet, apiPost } from "@/lib/api-client";
import { toastError, toastInfo, toastSuccess } from "@/lib/toast";
import { avatarFor } from "@/lib/avatar";
import { cdnUrl } from "@/lib/cdn";
import { SUBJECT_COLORS, SUBJECT_ICONS, DefaultSubjectIcon } from "@/lib/mockData";
import {
  TIP_AMOUNTS,
  LIBRARY_MAX_LIMIT,
  MAX_REPORT_REASON_LENGTH,
  type LibrarySetSummary,
} from "@/lib/library/constants";
import {
  BookBookmark,
  Cards,
  Copy,
  Flag,
  MagnifyingGlass,
  HandCoins,
  CircleNotch,
  CheckCircle,
  X,
} from "@phosphor-icons/react";

const ACCENT = "#2DD4BF"; // library teal — the feature's ONE accent

const SUBJECT_FILTERS = [
  "Math",
  "Science",
  "Languages",
  "Humanities",
  "Tech & Coding",
  "Cloud & IT",
  "Finance & Business",
  "Test Prep",
] as const;

interface BrowseResponse {
  sets: LibrarySetSummary[];
  unavailable?: boolean;
  message?: string;
}

interface TipResponse {
  ok?: boolean;
  tipsPending?: boolean;
  message?: string;
  error?: string;
  capped?: boolean;
}

interface CloneResponse {
  setId?: string;
  alreadyCloned?: boolean;
  cardCount?: number;
  error?: string;
  unavailable?: boolean;
}

interface ReportResponse {
  ok?: boolean;
  alreadyReported?: boolean;
  error?: string;
  unavailable?: boolean;
}

type ModalState =
  | { kind: "tip"; set: LibrarySetSummary }
  | { kind: "report"; set: LibrarySetSummary }
  | null;

function avatarSrc(owner: LibrarySetSummary["owner"]): string {
  // House helper - keeps the DiceBear fallback identical to the navbar,
  // leaderboards, and social surfaces (reviewer minor).
  return avatarFor(owner.username ?? owner.id, owner.avatarUrl);
}

function buildBrowseUrl(q: string, subject: string | null, offset: number): string {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (subject) params.set("subject", subject);
  params.set("limit", String(LIBRARY_MAX_LIMIT));
  params.set("offset", String(offset));
  return `/api/library?${params.toString()}`;
}

/* ── Set card ─────────────────────────────────────────────────── */

function SetCard({
  set,
  pinned,
  cloneBusy,
  cloned,
  tipsDisabled,
  onClone,
  onTip,
  onReport,
}: {
  set: LibrarySetSummary;
  pinned?: boolean;
  cloneBusy: boolean;
  cloned: boolean;
  tipsDisabled: boolean;
  onClone: (set: LibrarySetSummary) => void;
  onTip: (set: LibrarySetSummary) => void;
  onReport: (set: LibrarySetSummary) => void;
}) {
  const subjectColor = set.subject ? (SUBJECT_COLORS[set.subject] ?? ACCENT) : ACCENT;
  const SubjectIcon = set.subject ? (SUBJECT_ICONS[set.subject] ?? DefaultSubjectIcon) : DefaultSubjectIcon;
  const alreadyCloned = cloned || set.clonedByMe;

  return (
    <article
      className="card card-hover p-5 flex flex-col gap-3"
      style={pinned ? { borderColor: `${ACCENT}55`, boxShadow: `0 0 0 1px ${ACCENT}25` } : undefined}
    >
      {pinned && (
        <p className="font-mono text-[10px] uppercase tracking-[0.24em]" style={{ color: ACCENT }}>
          Shared with you
        </p>
      )}

      <div className="flex items-start justify-between gap-3">
        <h3 className="font-syne font-semibold text-cream text-base leading-snug line-clamp-2">
          {set.title}
        </h3>
        {set.subject && (
          <span
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider flex-shrink-0"
            style={{ background: `${subjectColor}1a`, border: `1px solid ${subjectColor}40`, color: subjectColor }}
          >
            <SubjectIcon size={11} weight="duotone" aria-hidden="true" />
            {set.subject}
          </span>
        )}
      </div>

      {set.description && (
        <p className="font-syne text-xs text-cream/60 leading-relaxed line-clamp-2">{set.description}</p>
      )}

      <div className="flex items-center gap-2 text-cream/70">
        <img
          src={avatarSrc(set.owner)}
          alt=""
          className="w-5 h-5 rounded-full object-cover bg-white/10"
          loading="lazy"
        />
        <span className="font-syne text-xs truncate">
          {set.owner.username ?? "A Lionade learner"}
          {set.isMine && (
            <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider" style={{ color: ACCENT }}>
              Yours
            </span>
          )}
        </span>
        <span className="ml-auto inline-flex items-center gap-3 font-mono text-[11px] text-cream/55 flex-shrink-0">
          <span className="inline-flex items-center gap-1">
            <Cards size={13} weight="duotone" aria-hidden="true" />
            {set.cardCount}
          </span>
          <span className="inline-flex items-center gap-1">
            <Copy size={13} weight="duotone" aria-hidden="true" />
            {set.cloneCount}
          </span>
        </span>
      </div>

      <div className="mt-auto flex items-center gap-2 pt-1">
        {!set.isMine && (
          <button
            type="button"
            onClick={() => onClone(set)}
            disabled={cloneBusy || alreadyCloned}
            className="inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 font-bebas text-sm tracking-wider transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
            style={{ background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }}
          >
            {cloneBusy ? (
              <CircleNotch size={14} className="animate-spin" aria-hidden="true" />
            ) : alreadyCloned ? (
              <CheckCircle size={14} weight="duotone" aria-hidden="true" />
            ) : (
              <Copy size={14} weight="duotone" aria-hidden="true" />
            )}
            {alreadyCloned ? "In your sets" : "Clone"}
          </button>
        )}
        {!set.isMine && (
          <button
            type="button"
            onClick={() => onTip(set)}
            disabled={tipsDisabled}
            className="inline-flex items-center gap-1.5 rounded-xl border border-gold/40 bg-gold/10 px-3.5 py-2 font-bebas text-sm tracking-wider text-gold transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
            title={tipsDisabled ? "Tipping isn't switched on yet." : "Send the creator some Fangs"}
          >
            <HandCoins size={14} weight="duotone" aria-hidden="true" />
            Tip
          </button>
        )}
        <button
          type="button"
          onClick={() => onReport(set)}
          className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.18em] text-cream/40 hover:text-cream/70 transition-colors"
        >
          <Flag size={12} weight="duotone" aria-hidden="true" />
          Report
        </button>
      </div>
    </article>
  );
}

/* ── Page ─────────────────────────────────────────────────────── */

export default function LibraryPage() {
  const { user } = useAuth();
  const reduceMotion = useReducedMotion();

  const [searchInput, setSearchInput] = useState("");
  const [q, setQ] = useState("");
  const [subject, setSubject] = useState<string | null>(null);

  // Debounce the search box into the SWR key.
  useEffect(() => {
    const t = setTimeout(() => setQ(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const { data: firstPage, error: browseError, isLoading, mutate: mutateBrowse } = useSWR(
    user?.id ? `library/${q}/${subject ?? "all"}/${user.id}` : null,
    async () => {
      const res = await apiGet<BrowseResponse>(buildBrowseUrl(q, subject, 0));
      // THROW on failure instead of collapsing to an empty result — a failed
      // browse must not render "no sets found" (that reads as "the library is
      // empty" when the fetch just broke).
      if (!res.ok) throw new Error(res.error ?? "Couldn't load the library");
      return res.data ?? { sets: [] };
    },
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  // "Load more" pages append below the SWR-managed first page.
  const [extraSets, setExtraSets] = useState<LibrarySetSummary[]>([]);
  const [pagesLoaded, setPagesLoaded] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [reachedEnd, setReachedEnd] = useState(false);
  useEffect(() => {
    setExtraSets([]);
    setPagesLoaded(1);
    setReachedEnd(false);
  }, [q, subject]);

  const loadMore = useCallback(async () => {
    if (loadingMore) return;
    setLoadingMore(true);
    const res = await apiGet<BrowseResponse>(buildBrowseUrl(q, subject, pagesLoaded * LIBRARY_MAX_LIMIT));
    setLoadingMore(false);
    if (res.ok && res.data) {
      const next = res.data.sets ?? [];
      setExtraSets((prev) => [...prev, ...next]);
      setPagesLoaded((p) => p + 1);
      if (next.length < LIBRARY_MAX_LIMIT) setReachedEnd(true);
    } else {
      toastError("Couldn't load more sets.");
    }
  }, [loadingMore, q, subject, pagesLoaded]);

  // Share-link pin: /library?set=<id>. Read from location (not useSearchParams)
  // so the page needs no Suspense boundary.
  const [pinnedSet, setPinnedSet] = useState<LibrarySetSummary | null>(null);
  useEffect(() => {
    if (!user?.id) return;
    const sharedId = new URLSearchParams(window.location.search).get("set");
    if (!sharedId) return;
    void apiGet<BrowseResponse>(`/api/library?set=${encodeURIComponent(sharedId)}`).then((res) => {
      if (res.ok && res.data?.sets?.[0]) setPinnedSet(res.data.sets[0]);
    });
  }, [user?.id]);

  const unavailable = firstPage?.unavailable === true;
  const baseSets = firstPage?.sets ?? [];
  const allSets = useMemo(() => {
    const merged = [...baseSets, ...extraSets];
    if (!pinnedSet) return merged;
    return merged.filter((s) => s.id !== pinnedSet.id);
  }, [baseSets, extraSets, pinnedSet]);
  const canLoadMore = !reachedEnd && baseSets.length === LIBRARY_MAX_LIMIT;

  // ── Actions ────────────────────────────────────────────────────
  const [modal, setModal] = useState<ModalState>(null);
  const [cloneBusyId, setCloneBusyId] = useState<string | null>(null);
  const [clonedIds, setClonedIds] = useState<Set<string>>(new Set());
  const [tipsDisabled, setTipsDisabled] = useState(false);
  const [tipBusy, setTipBusy] = useState(false);
  const [reportReason, setReportReason] = useState("");
  const [reportBusy, setReportBusy] = useState(false);

  const handleClone = useCallback(
    async (set: LibrarySetSummary) => {
      if (cloneBusyId) return;
      setCloneBusyId(set.id);
      const res = await apiPost<CloneResponse>(`/api/library/${set.id}/clone`, {});
      setCloneBusyId(null);
      if (res.ok && res.data?.setId) {
        setClonedIds((prev) => new Set(prev).add(set.id));
        toastSuccess(
          res.data.alreadyCloned ? "Already in your sets." : "Added to your sets. Fresh cards, fresh start.",
        );
        return;
      }
      if (res.data?.unavailable) {
        toastInfo(res.data.error ?? "The community library isn't live yet.");
        return;
      }
      toastError(res.data?.error ?? res.error ?? "Couldn't clone the set.");
    },
    [cloneBusyId],
  );

  const handleTip = useCallback(
    async (set: LibrarySetSummary, amount: number) => {
      if (tipBusy) return;
      setTipBusy(true);
      const res = await apiPost<TipResponse>(`/api/library/${set.id}/tip`, { amount });
      setTipBusy(false);
      setModal(null);
      if (res.ok && res.data?.ok) {
        toastSuccess(`Tip sent. ${amount} Fangs to ${set.owner.username ?? "the creator"}.`);
        return;
      }
      if (res.data?.tipsPending) {
        // HELD ledger migration not applied: honest copy + disable for the session.
        setTipsDisabled(true);
        toastInfo(res.data.message ?? "Tipping isn't switched on yet. Your Fangs were returned.");
        return;
      }
      toastError(res.data?.error ?? res.error ?? "Couldn't send the tip.");
    },
    [tipBusy],
  );

  const handleReport = useCallback(
    async (set: LibrarySetSummary) => {
      const reason = reportReason.trim();
      if (!reason || reportBusy) return;
      setReportBusy(true);
      const res = await apiPost<ReportResponse>(`/api/library/${set.id}/report`, { reason });
      setReportBusy(false);
      setModal(null);
      setReportReason("");
      if (res.ok && res.data?.ok) {
        toastSuccess(
          res.data.alreadyReported
            ? "You already reported this set. Our team is on it."
            : "Thanks for the report. Our team will take a look.",
        );
        return;
      }
      if (res.data?.unavailable) {
        toastInfo(res.data.error ?? "Reporting isn't live yet.");
        return;
      }
      toastError(res.data?.error ?? res.error ?? "Couldn't send the report.");
    },
    [reportReason, reportBusy],
  );

  const openTip = useCallback((set: LibrarySetSummary) => setModal({ kind: "tip", set }), []);
  const openReport = useCallback((set: LibrarySetSummary) => {
    setReportReason("");
    setModal({ kind: "report", set });
  }, []);

  // Only an error when we have nothing cached to show (keepPreviousData keeps
  // the last-good grid on a revalidation failure).
  const loadError = !!browseError && firstPage === undefined;
  const showSkeletons = isLoading && baseSets.length === 0 && !unavailable && !loadError;
  const showEmpty = !isLoading && !unavailable && !loadError && allSets.length === 0 && !pinnedSet;

  return (
    <ProtectedRoute>
      <style jsx>{`
        @keyframes slide-up {
          from { opacity: 0; transform: translateY(12px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up {
          animation: slide-up 0.4s var(--ease-out-expo, cubic-bezier(0.16, 1, 0.3, 1)) both;
        }
        .library-eyebrow-rule {
          height: 1px;
          background: linear-gradient(90deg, ${ACCENT}8c 0%, transparent 100%);
          width: 56px;
        }
        @media (prefers-reduced-motion: reduce) {
          .animate-slide-up { animation: none; }
        }
      `}</style>

      <FeatureGate feature="library">
        <div className="min-h-screen pt-16 pb-20 md:pb-8">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <BackButton href="/learn" label="Learn" />

            {/* Header */}
            <header className="mb-6 animate-slide-up">
              <div className="flex items-center gap-2.5 mb-3">
                <span className="library-eyebrow-rule" aria-hidden="true" />
                <p className="font-mono text-[10px] uppercase tracking-[0.32em]" style={{ color: `${ACCENT}c0` }}>
                  Built by learners, for learners
                </p>
              </div>
              <div className="flex items-center gap-3">
                <BookBookmark size={34} weight="duotone" color={ACCENT} aria-hidden="true" />
                <h1 className="font-bebas text-4xl sm:text-5xl text-cream tracking-[0.08em] leading-[0.95]">
                  Community Library
                </h1>
              </div>
              <p className="font-syne text-sm text-cream/65 mt-3 max-w-lg leading-relaxed">
                Browse study sets other learners published. Clone anything into your own
                collection for free, and tip creators whose sets carry you.
              </p>
            </header>

            {/* Search + subject filter */}
            <div className="mb-6 animate-slide-up space-y-3">
              <div className="relative max-w-md">
                <MagnifyingGlass
                  size={16}
                  weight="duotone"
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-cream/40"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  placeholder="Search sets by title"
                  aria-label="Search sets by title"
                  className="w-full rounded-xl border border-white/12 bg-white/5 py-2.5 pl-10 pr-4 font-syne text-sm text-cream placeholder:text-cream/35 outline-none focus:border-white/25 transition-colors"
                />
              </div>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by subject">
                <button
                  type="button"
                  onClick={() => setSubject(null)}
                  className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all"
                  style={
                    subject === null
                      ? { background: `${ACCENT}22`, border: `1px solid ${ACCENT}55`, color: ACCENT }
                      : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,248,231,0.6)" }
                  }
                >
                  All
                </button>
                {SUBJECT_FILTERS.map((s) => {
                  const active = subject === s;
                  const color = SUBJECT_COLORS[s] ?? ACCENT;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSubject(active ? null : s)}
                      className="rounded-full px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider transition-all"
                      style={
                        active
                          ? { background: `${color}22`, border: `1px solid ${color}55`, color }
                          : { background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.12)", color: "rgba(255,248,231,0.6)" }
                      }
                    >
                      {s}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Pinned shared set */}
            {pinnedSet && (
              <div className="mb-5 animate-slide-up">
                <SetCard
                  set={pinnedSet}
                  pinned
                  cloneBusy={cloneBusyId === pinnedSet.id}
                  cloned={clonedIds.has(pinnedSet.id)}
                  tipsDisabled={tipsDisabled || tipBusy}
                  onClone={handleClone}
                  onTip={openTip}
                  onReport={openReport}
                />
              </div>
            )}

            {/* Grid states: unavailable -> skeletons -> empty -> sets */}
            {unavailable ? (
              <div className="card p-10 text-center animate-slide-up">
                <BookBookmark size={36} weight="duotone" color={ACCENT} className="mx-auto mb-3" aria-hidden="true" />
                <p className="font-bebas text-2xl text-cream tracking-wide mb-2">Almost ready</p>
                <p className="font-syne text-sm text-cream/60 max-w-sm mx-auto leading-relaxed">
                  {firstPage?.message ?? "The community library isn't live yet. Check back soon."}
                </p>
              </div>
            ) : loadError ? (
              <div className="card p-10 text-center animate-slide-up">
                <BookBookmark size={36} weight="duotone" color={ACCENT} className="mx-auto mb-3" aria-hidden="true" />
                <p className="font-bebas text-2xl text-cream tracking-wide mb-2">Couldn&apos;t load the library</p>
                <p className="font-syne text-sm text-cream/60 max-w-sm mx-auto leading-relaxed mb-4">
                  Something went wrong fetching community sets. Nothing is missing.
                </p>
                <button
                  onClick={() => mutateBrowse()}
                  className="font-bebas tracking-wider text-sm px-5 py-2 rounded-lg transition-colors"
                  style={{ background: `${ACCENT}20`, border: `1px solid ${ACCENT}55`, color: ACCENT }}
                >
                  Try again
                </button>
              </div>
            ) : showSkeletons ? (
              <div className="grid gap-4 sm:grid-cols-2" aria-busy="true" aria-label="Loading the library">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="card p-5 h-44 animate-pulse bg-white/5" />
                ))}
              </div>
            ) : showEmpty ? (
              <div className="card p-10 text-center animate-slide-up">
                <MagnifyingGlass size={32} weight="duotone" className="mx-auto mb-3 text-cream/40" aria-hidden="true" />
                <p className="font-bebas text-2xl text-cream tracking-wide mb-2">
                  {q || subject ? "No sets match" : "Nothing here yet"}
                </p>
                <p className="font-syne text-sm text-cream/60 max-w-sm mx-auto leading-relaxed">
                  {q || subject
                    ? "Try a different search or subject."
                    : "Be the first. Publish one of your study sets and it shows up here."}
                </p>
              </div>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 animate-slide-up">
                  {allSets.map((set) => (
                    <SetCard
                      key={set.id}
                      set={set}
                      cloneBusy={cloneBusyId === set.id}
                      cloned={clonedIds.has(set.id)}
                      tipsDisabled={tipsDisabled || tipBusy}
                      onClone={handleClone}
                      onTip={openTip}
                      onReport={openReport}
                    />
                  ))}
                </div>
                {canLoadMore && (
                  <div className="mt-6 text-center">
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/5 px-6 py-2.5 font-bebas text-base tracking-wider text-cream/85 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60"
                    >
                      {loadingMore && <CircleNotch size={15} className="animate-spin" aria-hidden="true" />}
                      Load more
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Tip / report modal */}
        <AnimatePresence>
          {modal && (
            <motion.div
              className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.15 }}
              onClick={() => setModal(null)}
              role="dialog"
              aria-modal="true"
              aria-label={modal.kind === "tip" ? "Send a tip" : "Report this set"}
            >
              <motion.div
                className="card p-6 w-full max-w-sm"
                initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
                animate={reduceMotion ? { opacity: 1 } : { opacity: 1, y: 0 }}
                exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
                transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-3 mb-1">
                  <h2 className="font-bebas text-2xl text-cream tracking-wide">
                    {modal.kind === "tip" ? "Send a tip" : "Report this set"}
                  </h2>
                  <button
                    type="button"
                    onClick={() => setModal(null)}
                    className="text-cream/40 hover:text-cream/80 transition-colors"
                    aria-label="Close"
                  >
                    <X size={18} aria-hidden="true" />
                  </button>
                </div>
                <p className="font-syne text-xs text-cream/55 leading-relaxed mb-4 line-clamp-2">
                  {modal.set.title}
                  {modal.set.owner.username ? ` by ${modal.set.owner.username}` : ""}
                </p>

                {modal.kind === "tip" ? (
                  <>
                    <p className="font-syne text-sm text-cream/70 leading-relaxed mb-4">
                      Tips go straight to the creator. Up to 3 a day.
                    </p>
                    <div className="grid grid-cols-3 gap-2">
                      {TIP_AMOUNTS.map((amt) => (
                        <button
                          key={amt}
                          type="button"
                          disabled={tipBusy}
                          onClick={() => handleTip(modal.set, amt)}
                          className="rounded-xl border border-gold/40 bg-gold/10 px-2 py-3 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-60 flex flex-col items-center gap-1.5"
                        >
                          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
                          <span className="font-bebas text-lg text-gold tracking-wider leading-none">{amt}</span>
                        </button>
                      ))}
                    </div>
                  </>
                ) : (
                  <>
                    <textarea
                      value={reportReason}
                      onChange={(e) => setReportReason(e.target.value.slice(0, MAX_REPORT_REASON_LENGTH))}
                      placeholder="What's wrong with this set?"
                      aria-label="Report reason"
                      rows={3}
                      className="w-full rounded-xl border border-white/12 bg-white/5 p-3 font-syne text-sm text-cream placeholder:text-cream/35 outline-none focus:border-white/25 transition-colors resize-none"
                    />
                    <div className="mt-1 mb-4 flex justify-end">
                      <span className="font-mono text-[10px] text-cream/40">
                        {reportReason.length}/{MAX_REPORT_REASON_LENGTH}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleReport(modal.set)}
                      disabled={reportBusy || reportReason.trim().length === 0}
                      className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-red-400/40 bg-red-400/10 px-4 py-2.5 font-bebas text-base tracking-wider text-red-300 transition-all hover:brightness-110 active:scale-[0.99] disabled:opacity-50"
                    >
                      {reportBusy && <CircleNotch size={15} className="animate-spin" aria-hidden="true" />}
                      Send report
                    </button>
                  </>
                )}
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
      </FeatureGate>
    </ProtectedRoute>
  );
}
