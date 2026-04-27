"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import {
  CaretLeft, Plus, Target, Note, Calendar, Clock,
  CheckCircle, ArrowRight, DotsThreeVertical, Trash, PencilSimple,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiDelete, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";
import ExamCountdown from "@/components/Class/ExamCountdown";
import ClassStreakChip from "@/components/Class/ClassStreakChip";
import { PushPin, PushPinSlash, Brain, ArrowsClockwise, Lightning, Coffee, BookOpenText } from "@phosphor-icons/react";
import { toastError } from "@/lib/toast";
import SyllabusUpload from "@/components/Class/SyllabusUpload";
import GradeTracker from "@/components/Class/GradeTracker";
import FlashcardStudy from "@/components/Class/FlashcardStudy";

/**
 * Single class notebook. Shows the class header (color-bar, name,
 * countdown to next exam) and lists every Mastery target attached to
 * this class. Notes section is a placeholder for the next phase.
 */

interface ClassDetail {
  class: {
    id: string;
    name: string;
    shortCode: string | null;
    professor: string | null;
    term: string | null;
    color: string;
    emoji: string | null;
    position: number;
    createdAt: string;
    updatedAt: string;
  };
  exams: {
    id: string;
    title: string;
    targetDate: string | null;
    reachedMasteryAt: string | null;
    totalActiveSeconds: number;
    pPass: number;
    overallDisplayPct: number;
    subtopicCount: number;
  }[];
  notes: {
    id: string;
    title: string | null;
    body: string;
    source: string;
    pinned: boolean;
    aiTopics: string[] | null;
    aiSummary: string | null;
    createdAt: string;
    updatedAt: string;
  }[];
}

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
}

export default function ClassNotebookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const classId = params?.id;

  const { data, isLoading, mutate } = useSWR<ClassDetail>(
    classId ? `/api/classes/${classId}` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const [menuOpen, setMenuOpen] = useState(false);

  if (isLoading || !data) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-navy text-cream pt-12">
          <SpaceBackground />
          <Navbar />
          <main className="max-w-[980px] mx-auto px-4 sm:px-6 pt-6 pb-24">
            <div className="h-5 w-24 bg-white/[0.06] rounded-full mb-5 animate-pulse" />
            <div className="h-12 w-72 bg-white/[0.06] rounded-md mb-3 animate-pulse" />
            <div className="h-4 w-48 bg-white/[0.04] rounded mb-8 animate-pulse" />
            <div className="space-y-3">
              {[0, 1].map(i => (
                <div key={i} className="h-24 w-full bg-white/[0.04] rounded-[12px] animate-pulse" />
              ))}
            </div>
          </main>
        </div>
      </ProtectedRoute>
    );
  }

  const { class: cls, exams, notes } = data;
  const upcomingExams = exams
    .filter(e => e.targetDate && (daysUntil(e.targetDate) ?? -1) >= 0)
    .sort((a, b) => (a.targetDate ?? "").localeCompare(b.targetDate ?? ""));
  const nextExam = upcomingExams[0];

  const handleArchive = async () => {
    if (!confirm(`Archive "${cls.name}"? You can restore it later.`)) return;
    const r = await apiDelete(`/api/classes/${cls.id}`);
    if (r.ok) router.push("/classes");
    else alert(r.error || "Couldn't archive class.");
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />

        <main
          className="relative z-10 max-w-[980px] mx-auto px-4 sm:px-6 pt-6 pb-24"
          style={{ ["--accent" as string]: cls.color }}
        >
          {/* Top bar with back + menu */}
          <div className="flex items-center justify-between mb-5">
            <Link
              href="/classes"
              className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream transition-colors"
            >
              <CaretLeft size={12} weight="bold" /> Classes
            </Link>
            <div className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen(o => !o)}
                aria-label="Class options"
                className="grid place-items-center w-8 h-8 rounded-full hover:bg-white/[0.05] transition-colors"
              >
                <DotsThreeVertical size={16} weight="bold" />
              </button>
              {menuOpen && (
                <div className="absolute top-full right-0 mt-1 w-44 rounded-[8px] border border-white/[0.1] bg-navy shadow-xl py-1 z-30">
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); /* TODO edit modal */ }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[13px] text-cream/80 hover:bg-white/[0.04]"
                  >
                    <PencilSimple size={13} /> Edit details
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); void handleArchive(); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[13px] text-[#EF4444] hover:bg-[#EF4444]/[0.08]"
                  >
                    <Trash size={13} /> Archive class
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Header — color stripe + name + per-class streak chip */}
          <header className="relative mb-6 rounded-[16px] overflow-hidden border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
            <span
              className="absolute top-0 left-0 right-0 h-1.5"
              style={{ background: `linear-gradient(90deg, ${cls.color}, ${cls.color}40)` }}
              aria-hidden="true"
            />
            <div className="flex items-start gap-4">
              {cls.emoji && (
                <span className="text-[40px] leading-none mt-1 shrink-0" aria-hidden="true">
                  {cls.emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <h1 className="font-bebas text-4xl sm:text-5xl tracking-[0.06em] text-cream leading-none mb-1">
                    {cls.name}
                  </h1>
                  <div className="shrink-0 mt-1">
                    <ClassStreakChip classId={cls.id} />
                  </div>
                </div>
                {(cls.shortCode || cls.term || cls.professor) && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
                    {[cls.shortCode, cls.term, cls.professor].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </div>
          </header>

          {/* Next-exam countdown banner. When there's no exam date set, we
              don't render this AT ALL — the "Add target" CTA inside the
              EXAM TARGETS section below handles the empty-state nudge. */}
          {nextExam?.targetDate ? (
            <ExamCountdown
              examTitle={nextExam.title}
              targetDate={nextExam.targetDate}
              classShortCode={cls.shortCode}
            />
          ) : null}

          {/* Syllabus PDF — drop to extract topics + exam dates. Lives above
              the daily plan because parsing it seeds the plan. */}
          <SyllabusUpload classId={cls.id} />

          {/* AI daily plan — only shows when there's at least one exam target
              AND the user has done some work (otherwise it's noisy AI for no
              real signal). */}
          {exams.length > 0 && (
            <DailyPlanCard classId={cls.id} color={cls.color} />
          )}

          {/* Mastery targets */}
          <section className="mb-10">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
                <span className="inline-flex items-center gap-2">
                  <Target size={13} weight="bold" /> EXAM TARGETS
                </span>
              </h2>
              <Link
                href={`/learn/mastery?classId=${cls.id}`}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-gold hover:text-gold/80 transition-colors"
              >
                <Plus size={11} weight="bold" /> Add target
              </Link>
            </div>

            {exams.length === 0 ? (
              <div className="rounded-[12px] border border-dashed border-white/[0.1] bg-white/[0.02] p-6 text-center">
                <Target size={20} className="text-cream/40 mx-auto mb-2" />
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/50 mb-3">
                  No exam targets yet
                </p>
                <Link
                  href={`/learn/mastery?classId=${cls.id}`}
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/70 hover:text-cream"
                >
                  <ArrowRight size={11} weight="bold" /> Set up your first target
                </Link>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {exams.map(e => <ExamRow key={e.id} exam={e} color={cls.color} />)}
              </div>
            )}
          </section>

          {/* Grades — between exam targets (outcomes) and notes (inputs).
              Self-fetches so it doesn't bloat the parent class detail call. */}
          <section className="mb-10">
            <GradeTracker classId={cls.id} />
          </section>

          {/* Notes — real list now, with inline create + pin/archive */}
          <NotesSection
            classId={cls.id}
            notes={notes}
            onChange={() => void mutate()}
          />

          {/* Flashcards — auto-generated from notes by Ninny on save */}
          <FlashcardStudy classId={cls.id} />
        </main>
      </div>
    </ProtectedRoute>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Notes section
// ─────────────────────────────────────────────────────────────────────────────
function NotesSection({
  classId, notes, onChange,
}: {
  classId: string;
  notes: ClassDetail["notes"];
  onChange: () => void;
}) {
  const [drafting, setDrafting] = useState(false);
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (submitting) return;
    const cleaned = draft.trim();
    if (cleaned.length < 1) return;
    setSubmitting(true);
    const r = await apiPost(`/api/classes/${classId}/notes`, { body: cleaned, source: "manual" });
    setSubmitting(false);
    if (!r.ok) { toastError(r.error || "Couldn't save note."); return; }
    setDraft("");
    setDrafting(false);
    onChange();
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); }
    if (e.key === "Escape") { setDrafting(false); setDraft(""); }
  };

  return (
    <section>
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
          <span className="inline-flex items-center gap-2">
            <Note size={13} weight="bold" /> NOTES
          </span>
        </h2>
        {!drafting && (
          <button
            type="button"
            onClick={() => setDrafting(true)}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-gold hover:text-gold/80 transition-colors"
          >
            <Plus size={11} weight="bold" /> Add note
          </button>
        )}
      </div>

      {drafting && (
        <div className="mb-4 rounded-[10px] border border-gold/30 bg-gold/[0.04] p-3">
          <textarea
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value.slice(0, 50_000))}
            onKeyDown={onKey}
            placeholder="Write your note. ⌘+Enter to save, Esc to cancel."
            rows={3}
            className="w-full resize-none bg-transparent border-none focus:outline-none
              text-[14px] text-cream placeholder:text-cream/30 leading-relaxed"
          />
          <div className="flex items-center justify-end gap-2 mt-2">
            <button
              type="button"
              onClick={() => { setDrafting(false); setDraft(""); }}
              className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-3 py-1.5"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || draft.trim().length < 1}
              className="rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[10px] uppercase tracking-[0.25em] px-4 py-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}

      {notes.length === 0 && !drafting ? (
        <div className="rounded-[12px] border border-dashed border-white/[0.08] bg-white/[0.015] p-6 text-center">
          <Note size={18} className="text-cream/30 mx-auto mb-2" />
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/40 mb-1">
            No notes yet
          </p>
          <p className="text-[12px] text-cream/40">
            Use ⌘K from anywhere to capture a thought — Lionade files it here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map(n => <NoteCard key={n.id} note={n} onChange={onChange} />)}
        </div>
      )}
    </section>
  );
}

function NoteCard({
  note, onChange,
}: {
  note: ClassDetail["notes"][number];
  onChange: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const togglePin = async () => {
    if (busy) return;
    setBusy(true);
    const r = await apiPatch(`/api/classes/notes/${note.id}`, { pinned: !note.pinned });
    setBusy(false);
    if (!r.ok) { toastError(r.error || "Couldn't update."); return; }
    onChange();
  };

  const archive = async () => {
    if (busy) return;
    if (!confirm("Archive this note? You won't see it in the list anymore.")) return;
    setBusy(true);
    const r = await apiDelete(`/api/classes/notes/${note.id}`);
    setBusy(false);
    if (!r.ok) { toastError(r.error || "Couldn't archive."); return; }
    onChange();
  };

  // Two-line teaser of the body
  const teaser = note.body.length > 220 ? note.body.slice(0, 220).trim() + "…" : note.body;

  return (
    <div
      className={`relative rounded-[10px] border px-4 py-3 transition-colors
        ${note.pinned
          ? "border-gold/30 bg-gold/[0.04]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]"}`}
    >
      <div className="flex items-start justify-between gap-3 mb-1.5">
        <div className="min-w-0 flex-1">
          {note.title && (
            <p className="font-syne font-semibold text-[13.5px] text-cream truncate mb-0.5">
              {note.title}
            </p>
          )}
          {note.aiSummary && !note.title && (
            <p className="font-syne font-semibold text-[13.5px] text-cream truncate mb-0.5">
              {note.aiSummary}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={togglePin}
            disabled={busy}
            aria-label={note.pinned ? "Unpin" : "Pin"}
            className="grid place-items-center w-7 h-7 rounded-full hover:bg-white/[0.06] text-cream/40 hover:text-cream transition-colors"
          >
            {note.pinned
              ? <PushPinSlash size={12} weight="bold" />
              : <PushPin size={12} weight="bold" />}
          </button>
          <button
            type="button"
            onClick={archive}
            disabled={busy}
            aria-label="Archive"
            className="grid place-items-center w-7 h-7 rounded-full hover:bg-[#EF4444]/10 text-cream/40 hover:text-[#EF4444] transition-colors"
          >
            <Trash size={12} weight="bold" />
          </button>
        </div>
      </div>
      <p className="text-[13px] text-cream/75 leading-relaxed whitespace-pre-wrap">
        {teaser}
      </p>
      {note.aiTopics && note.aiTopics.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {note.aiTopics.map(t => (
            <span
              key={t}
              className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45 border border-white/[0.06] rounded-full px-2 py-0.5"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.2em] text-cream/30">
        <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
        {note.source !== "manual" && <span>· via {note.source}</span>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Exam row inside a class
// ─────────────────────────────────────────────────────────────────────────────
function ExamRow({
  exam, color,
}: {
  exam: ClassDetail["exams"][number];
  color: string;
}) {
  const days = daysUntil(exam.targetDate);
  const hours = Math.floor(exam.totalActiveSeconds / 3600);
  const mins = Math.floor((exam.totalActiveSeconds % 3600) / 60);
  const timeLabel = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
  const mastered = !!exam.reachedMasteryAt;

  return (
    <Link
      href={`/learn/mastery/${exam.id}`}
      className="group rounded-[12px] border border-white/[0.06] hover:border-white/[0.15]
        bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-200 p-4 block"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bebas text-[20px] tracking-wider text-cream leading-tight truncate">
            {exam.title}
          </h3>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mt-1">
            {days !== null && days >= 0 && (
              <span className="flex items-center gap-1">
                <Calendar size={10} weight="bold" /> {days === 0 ? "today" : `${days}d`}
              </span>
            )}
            <span className="flex items-center gap-1">
              <Clock size={10} weight="bold" /> {timeLabel}
            </span>
            <span>{exam.subtopicCount} subtopics</span>
            {mastered && (
              <span className="text-gold flex items-center gap-1">
                <CheckCircle size={10} weight="fill" /> mastered
              </span>
            )}
          </div>
        </div>
        <ArrowRight
          size={14}
          weight="bold"
          className="opacity-30 group-hover:opacity-100 transition-opacity shrink-0 mt-1"
          style={{ color }}
        />
      </div>
      <MasteryProgressBar value={exam.overallDisplayPct} readyThreshold={0.80} />
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Daily plan card — fetches /api/classes/[id]/plan, renders task list.
// Plan is cached server-side per (user, class, day), so the round-trip is
// fast on revisits. Regenerate button forces a fresh AI call.
// ─────────────────────────────────────────────────────────────────────────────
type PlanShape = {
  tasks: Array<{
    kind: "mastery" | "review_notes" | "quiz" | "break";
    label: string;
    minutes: number;
    deepLink: string | null;
    why?: string;
  }>;
  totalMinutes: number;
  summary: string;
  generatedAt: string;
  fromCache: boolean;
};

function DailyPlanCard({ classId, color }: { classId: string; color: string }) {
  const { data, isLoading, mutate } = useSWR<{ plan: PlanShape }>(
    `/api/classes/${classId}/plan`,
    swrFetcher,
    { revalidateOnFocus: false, keepPreviousData: true },
  );
  const [regenerating, setRegenerating] = useState(false);

  const regenerate = async () => {
    if (regenerating) return;
    setRegenerating(true);
    try {
      const res = await fetch(`/api/classes/${classId}/plan?regenerate=1`, {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });
      if (res.ok) {
        const json = await res.json();
        await mutate(json, { revalidate: false });
      }
    } finally {
      setRegenerating(false);
    }
  };

  if (isLoading && !data) {
    return (
      <section className="mb-8">
        <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.02] p-5 animate-pulse">
          <div className="h-4 w-40 bg-white/[0.06] rounded mb-3" />
          <div className="h-3 w-full bg-white/[0.04] rounded mb-2" />
          <div className="h-3 w-2/3 bg-white/[0.04] rounded" />
        </div>
      </section>
    );
  }

  const plan = data?.plan;
  if (!plan) return null;

  return (
    <section className="mb-8">
      <div className="flex items-baseline justify-between mb-4">
        <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
          <span className="inline-flex items-center gap-2">
            <Brain size={13} weight="bold" /> TODAY&apos;S PLAN
          </span>
        </h2>
        <button
          type="button"
          onClick={regenerate}
          disabled={regenerating}
          className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 hover:text-cream transition-colors disabled:opacity-40"
        >
          <ArrowsClockwise
            size={11}
            weight="bold"
            className={regenerating ? "animate-spin" : ""}
          />
          {regenerating ? "Regenerating…" : "Refresh"}
        </button>
      </div>

      <div
        className="rounded-[12px] border p-4 sm:p-5 transition-colors"
        style={{
          borderColor: `${color}33`,
          background: `linear-gradient(180deg, ${color}0a 0%, transparent 60%)`,
        }}
      >
        <p className="text-[14px] text-cream/85 leading-relaxed mb-4 italic">
          {plan.summary}
        </p>

        <ul className="flex flex-col gap-2">
          {plan.tasks.map((t, i) => <PlanTaskRow key={i} task={t} accent={color} />)}
        </ul>

        <div className="mt-4 pt-3 border-t border-white/[0.06] flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-cream/40">
          <span>{plan.totalMinutes} min total</span>
          <span>
            {plan.fromCache ? "Cached today" : "Fresh"} ·{" "}
            {new Date(plan.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </div>
    </section>
  );
}

function PlanTaskRow({
  task, accent,
}: {
  task: PlanShape["tasks"][number];
  accent: string;
}) {
  const Icon =
    task.kind === "mastery"      ? Brain
    : task.kind === "review_notes" ? BookOpenText
    : task.kind === "quiz"       ? Lightning
    :                              Coffee;

  const inner = (
    <div className="group flex items-start gap-3 rounded-[8px] bg-white/[0.02] hover:bg-white/[0.05] border border-white/[0.04] hover:border-white/[0.12] transition-colors px-3 py-2.5">
      <div
        className="grid place-items-center w-8 h-8 rounded-lg shrink-0 mt-0.5"
        style={{ background: `${accent}15`, color: accent }}
      >
        <Icon size={14} weight="bold" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-[13.5px] text-cream/95 font-syne font-medium leading-snug">
            {task.label}
          </span>
          <span className="font-mono text-[10px] tabular-nums text-cream/45 shrink-0">
            {task.minutes}m
          </span>
        </div>
        {task.why && (
          <p className="text-[11.5px] text-cream/50 mt-0.5 leading-snug">{task.why}</p>
        )}
      </div>
      {task.deepLink && (
        <ArrowRight
          size={13}
          weight="bold"
          className="opacity-30 group-hover:opacity-100 transition-opacity shrink-0 mt-2"
          style={{ color: accent }}
        />
      )}
    </div>
  );

  return task.deepLink
    ? <Link href={task.deepLink} className="block">{inner}</Link>
    : <div>{inner}</div>;
}
