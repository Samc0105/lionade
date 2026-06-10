"use client";

import { useState } from "react";
import { mutate as globalMutate } from "swr";
import {
  Sparkle, CalendarPlus, ArrowsClockwise, CalendarBlank, CheckSquare, Square,
} from "@phosphor-icons/react";
import { apiGet, apiPost } from "@/lib/api-client";
import BottomSheet from "@/components/ui/BottomSheet";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * "Build study plan" tool for a class. Lives near the EXAM TARGETS / ASSIGNMENTS
 * area. On click it pulls the proposed plan (one study session per spaced-
 * repetition slot leading up to the class's next exam) and opens a BottomSheet
 * preview. The user can trim individual sessions, then commit the selection,
 * which writes them in as assignments (so they appear in the AssignmentTracker
 * and on the Academia hub calendar).
 *
 * Frozen contract:
 *   GET  /api/classes/[id]/study-plan
 *        -> { exam: { id, title, targetDate } | null,
 *             blocks: Array<{ date: "YYYY-MM-DD"; title; subtopicId: string|null }> }
 *   POST /api/classes/[id]/study-plan  body { blocks: Array<{ date; title }> }
 *        -> { created: number }
 *
 * After a successful POST we mutate the assignments SWR key for this class so
 * the new sessions show up in the tracker without a manual refresh.
 */

interface Block {
  date: string; // YYYY-MM-DD
  title: string;
  subtopicId: string | null;
}

interface PlanResponse {
  exam: { id: string; title: string; targetDate: string } | null;
  blocks: Block[];
}

interface Props {
  classId: string;
  color: string;
}

type SheetState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "empty" }
  | { kind: "ready"; exam: NonNullable<PlanResponse["exam"]>; blocks: Block[] };

export default function StudyPlanBuilder({ classId, color }: Props) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SheetState>({ kind: "loading" });
  // Selected block indices — all on by default once a plan loads.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setState({ kind: "loading" });
    const r = await apiGet<PlanResponse>(`/api/classes/${classId}/study-plan`);
    if (!r.ok || !r.data) {
      setState({ kind: "error" });
      return;
    }
    const { exam, blocks } = r.data;
    if (!exam || blocks.length === 0) {
      setState({ kind: "empty" });
      return;
    }
    setSelected(new Set(blocks.map((_, i) => i)));
    setState({ kind: "ready", exam, blocks });
  };

  const handleOpen = () => {
    setOpen(true);
    void load();
  };

  const toggle = (i: number) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const handleCommit = async () => {
    if (submitting || state.kind !== "ready") return;
    const chosen = state.blocks.filter((_, i) => selected.has(i));
    if (chosen.length === 0) {
      toastError("Pick at least one session to add.");
      return;
    }
    setSubmitting(true);
    const r = await apiPost<{ created: number }>(`/api/classes/${classId}/study-plan`, {
      blocks: chosen.map(b => ({ date: b.date, title: b.title })),
    });
    setSubmitting(false);
    if (!r.ok) {
      toastError(r.error || "Couldn't add study sessions.");
      return;
    }
    const created = r.data?.created ?? chosen.length;
    toastSuccess(`Added ${created} study ${created === 1 ? "session" : "sessions"}`);
    setOpen(false);
    // Refresh the assignment tracker so the new sessions appear immediately.
    void globalMutate(`/api/classes/${classId}/assignments`);
  };

  const selectedCount = selected.size;

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[10px] uppercase tracking-[0.25em] px-4 py-2 transition-colors"
      >
        <Sparkle size={13} weight="fill" />
        Build study plan
      </button>

      <BottomSheet open={open} onClose={() => setOpen(false)} ariaLabel="Build study plan">
        {state.kind === "loading" && <LoadingState />}
        {state.kind === "error" && <ErrorState onRetry={() => void load()} />}
        {state.kind === "empty" && <EmptyState />}
        {state.kind === "ready" && (
          <ReadyState
            exam={state.exam}
            blocks={state.blocks}
            color={color}
            selected={selected}
            onToggle={toggle}
            selectedCount={selectedCount}
            submitting={submitting}
            onCommit={handleCommit}
          />
        )}
      </BottomSheet>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function LoadingState() {
  return (
    <div className="px-1 pb-2">
      <div className="flex items-center gap-2 mb-5">
        <Sparkle size={14} className="text-gold animate-pulse" weight="fill" />
        <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold">
          Building study plan
        </span>
      </div>
      <div className="flex flex-col items-center justify-center py-10">
        <ArrowsClockwise size={26} weight="bold" className="text-cream/40 animate-spin mb-3" />
        <p className="font-syne text-[13px] text-cream/55">
          Spacing your sessions before exam day...
        </p>
      </div>
    </div>
  );
}

function ErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="px-1 pb-2">
      <h2 className="font-bebas text-[26px] tracking-wider text-cream leading-tight mb-3">
        Study plan
      </h2>
      <div className="rounded-[12px] border border-red-400/30 bg-red-400/5 p-6 text-center">
        <p className="font-syne text-[13px] text-red-300 mb-4">
          Couldn&apos;t build the plan. Network hiccup, probably.
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
    </div>
  );
}

function EmptyState() {
  return (
    <div className="px-1 pb-2">
      <h2 className="font-bebas text-[26px] tracking-wider text-cream leading-tight mb-4">
        Study plan
      </h2>
      <div className="rounded-[12px] border border-dashed border-white/[0.1] bg-white/[0.02] p-7 text-center">
        <div className="inline-grid place-items-center w-10 h-10 rounded-full bg-gold/10 border border-gold/20 mx-auto mb-3">
          <CalendarBlank size={17} className="text-gold" weight="bold" />
        </div>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cream/55 mb-2">
          Nothing to schedule yet
        </p>
        <p className="font-syne text-[13px] text-cream/55 leading-relaxed max-w-sm mx-auto">
          Set an exam date (with subtopics from a syllabus parse or Mastery) to
          auto-build a plan. We&apos;ll space your sessions across the days before
          the exam.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
function ReadyState({
  exam, blocks, color, selected, onToggle, selectedCount, submitting, onCommit,
}: {
  exam: NonNullable<PlanResponse["exam"]>;
  blocks: Block[];
  color: string;
  selected: Set<number>;
  onToggle: (i: number) => void;
  selectedCount: number;
  submitting: boolean;
  onCommit: () => void;
}) {
  const examDateLabel = formatLongDate(exam.targetDate);

  return (
    <div className="px-1 pb-2">
      {/* Header */}
      <div className="flex items-center gap-2 mb-2">
        <Sparkle size={13} className="text-gold" weight="fill" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
          Study plan
        </span>
      </div>
      <h2 className="font-bebas text-[26px] sm:text-[30px] tracking-wider text-cream leading-tight mb-1 pr-8">
        STUDY PLAN FOR {exam.title.toUpperCase()}
      </h2>
      <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 mb-5 tabular-nums">
        {blocks.length} {blocks.length === 1 ? "session" : "sessions"} before {examDateLabel}
      </p>

      {/* Blocks grouped by date */}
      <div className="flex flex-col gap-1.5 mb-5">
        {blocks.map((b, i) => {
          const isOn = selected.has(i);
          return (
            <button
              key={`${b.date}-${i}`}
              type="button"
              onClick={() => onToggle(i)}
              aria-pressed={isOn}
              className={`group flex items-center gap-3 rounded-[10px] border px-3.5 py-2.5 text-left transition-colors ${
                isOn
                  ? "border-white/[0.12] bg-white/[0.04]"
                  : "border-white/[0.05] bg-white/[0.015] opacity-55 hover:opacity-80"
              }`}
            >
              <span className="shrink-0 grid place-items-center w-5 h-5">
                {isOn ? (
                  <CheckSquare size={19} weight="fill" style={{ color }} />
                ) : (
                  <Square size={19} weight="bold" className="text-cream/35" />
                )}
              </span>
              <span
                className="shrink-0 font-mono text-[10px] uppercase tracking-[0.16em] tabular-nums w-[68px]"
                style={{ color: isOn ? color : undefined }}
              >
                {formatShortDate(b.date)}
              </span>
              <span className="min-w-0 flex-1 font-syne text-[13.5px] font-medium text-cream truncate">
                {b.title}
              </span>
            </button>
          );
        })}
      </div>

      {/* Commit bar */}
      <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-1 bg-gradient-to-t from-[#080d1a] via-[#080d1a] to-transparent">
        <div className="flex items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 tabular-nums">
            {selectedCount} of {blocks.length} selected
          </p>
          <button
            type="button"
            onClick={onCommit}
            disabled={submitting || selectedCount === 0}
            className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[11px] uppercase tracking-[0.22em] px-5 py-2.5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <CalendarPlus size={14} weight="bold" />
            {submitting
              ? "Adding..."
              : `Add ${selectedCount} ${selectedCount === 1 ? "session" : "sessions"} to calendar`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date helpers. Parse YYYY-MM-DD as local midnight (not UTC) to avoid an
// off-by-one day from timezone shifts.
function parseLocalDate(dateStr: string): Date {
  return new Date(dateStr + "T00:00:00");
}

function formatLongDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { month: "long", day: "numeric" });
}

function formatShortDate(dateStr: string): string {
  const d = parseLocalDate(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}
