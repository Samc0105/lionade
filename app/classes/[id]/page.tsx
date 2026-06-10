"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import {
  CaretLeft, Plus, Target, Note, Calendar, Clock,
  CheckCircle, ArrowRight, DotsThreeVertical, Trash, PencilSimple, X,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiDelete, apiGet, apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
import ConfirmModal from "@/components/ConfirmModal";
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";
import ExamCountdown from "@/components/Class/ExamCountdown";
import ClassStreakChip from "@/components/Class/ClassStreakChip";
import { PushPin, PushPinSlash, Brain, ArrowsClockwise, Lightning, Coffee, BookOpenText } from "@phosphor-icons/react";
import { toastError, toastSuccess } from "@/lib/toast";
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

/**
 * Status-aware error for the class detail fetch. The shared swrFetcher
 * throws a plain Error with no status, which makes "class gone" (404)
 * indistinguishable from a network blip. We keep the status so the page
 * can render not-found vs retry.
 */
class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

async function classDetailFetcher(path: string): Promise<ClassDetail> {
  const r = await apiGet<ClassDetail>(path);
  if (!r.ok) throw new ApiError(r.error ?? `Request failed (${r.status})`, r.status);
  return r.data as ClassDetail;
}

export default function ClassNotebookPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const classId = params?.id;

  const { data, error, isLoading, mutate } = useSWR<ClassDetail>(
    classId ? `/api/classes/${classId}` : null,
    classDetailFetcher,
    { keepPreviousData: true },
  );

  const [menuOpen, setMenuOpen] = useState(false);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  // Error before skeleton. A bad ID or a dead API used to leave isLoading
  // false with no data, which rendered the skeleton forever. Checking
  // error first also avoids painting stale keepPreviousData from a
  // different class under this URL.
  if (error) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-navy text-cream pt-12">
          <SpaceBackground />
          <Navbar />
          <main className="relative z-10 max-w-[980px] mx-auto px-4 sm:px-6 pt-6 pb-24">
            <Link
              href="/classes"
              className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream transition-colors"
            >
              <CaretLeft size={12} weight="bold" className="transition-transform duration-200 group-hover:-translate-x-0.5" />
              Classes
            </Link>
            {notFound ? (
              <div className="mt-6 rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-8 sm:p-10 text-center">
                <div className="inline-grid place-items-center w-12 h-12 rounded-2xl bg-white/[0.04] border border-white/10 mx-auto mb-4">
                  <BookOpenText size={22} className="text-cream/50" weight="bold" />
                </div>
                <h1 className="font-bebas text-[32px] tracking-[0.05em] text-cream leading-none mb-2">
                  Class not found
                </h1>
                <p className="font-syne text-sm text-cream/60 max-w-sm mx-auto mb-5">
                  This class does not exist or was deleted. Head back and pick one that does.
                </p>
                <Link
                  href="/classes"
                  className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90 font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5 transition-colors"
                >
                  Back to Classes
                </Link>
              </div>
            ) : (
              <div className="mt-6 rounded-2xl border border-red-400/30 bg-red-400/5 p-8 text-center">
                <p className="font-syne text-sm text-red-300 mb-4">
                  Couldn&apos;t load this class. Network hiccup, probably.
                </p>
                <div className="flex items-center justify-center gap-4">
                  <button
                    type="button"
                    onClick={() => void mutate()}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
                  >
                    <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
                    Try again
                  </button>
                  <Link
                    href="/classes"
                    className="font-syne text-xs font-bold text-cream/60 hover:text-cream transition-colors"
                  >
                    Back to Classes
                  </Link>
                </div>
              </div>
            )}
          </main>
        </div>
      </ProtectedRoute>
    );
  }

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
    const r = await apiDelete(`/api/classes/${cls.id}`);
    if (r.ok) {
      toastSuccess("Class archived. You can restore it later.");
      router.push("/classes");
    } else {
      toastError(r.error || "Couldn't archive class.");
      throw new Error("archive failed");
    }
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />

        <main
          className="relative z-10 max-w-[980px] mx-auto px-4 sm:px-6 pt-6 pb-12"
          style={{ ["--accent" as string]: cls.color }}
        >
          {/* Top bar with back + menu */}
          <div className="flex items-center justify-between mb-5">
            <Link
              href="/classes"
              className="group inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream transition-colors"
            >
              <CaretLeft size={12} weight="bold" className="transition-transform duration-200 group-hover:-translate-x-0.5" />
              Classes
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
                    onClick={() => { setMenuOpen(false); setShowEditModal(true); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[13px] text-cream/80 hover:bg-white/[0.04]"
                  >
                    <PencilSimple size={13} /> Edit details
                  </button>
                  <button
                    type="button"
                    onClick={() => { setMenuOpen(false); setShowArchiveConfirm(true); }}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 text-[13px] text-[#EF4444] hover:bg-[#EF4444]/[0.08]"
                  >
                    <Trash size={13} /> Archive class
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Header — color stripe + name + per-class streak chip */}
          <header
            className="relative mb-6 rounded-[16px] overflow-hidden border bg-white/[0.02] p-5 sm:p-7"
            style={{
              borderColor: `${cls.color}28`,
              background: `linear-gradient(180deg, ${cls.color}10 0%, ${cls.color}03 40%, rgba(255,255,255,0.02) 100%)`,
            }}
          >
            <span
              className="absolute top-0 left-0 right-0 h-1.5"
              style={{ background: `linear-gradient(90deg, ${cls.color}, ${cls.color}40)` }}
              aria-hidden="true"
            />
            <span
              className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 rounded-full blur-3xl opacity-60"
              style={{ background: `${cls.color}22` }}
              aria-hidden="true"
            />
            <p
              className="relative font-mono text-[10px] uppercase tracking-[0.32em] mb-3"
              style={{ color: cls.color }}
            >
              Class Notebook
            </p>
            <div className="relative flex items-start gap-4">
              {cls.emoji && (
                <span className="text-[44px] sm:text-[48px] leading-none mt-1 shrink-0" aria-hidden="true">
                  {cls.emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <h1 className="font-bebas text-4xl sm:text-[56px] tracking-[0.06em] text-cream leading-none mb-1.5">
                    {cls.name}
                  </h1>
                  <div className="shrink-0 mt-1">
                    <ClassStreakChip classId={cls.id} />
                  </div>
                </div>
                {(cls.shortCode || cls.term || cls.professor) && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55">
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
          <section className="mb-6">
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bebas text-[15px] text-cream/90 tracking-[0.22em] inline-flex items-center gap-2.5">
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: cls.color }}
                  aria-hidden="true"
                />
                <Target size={13} weight="bold" /> EXAM TARGETS
              </h2>
              <Link
                href={`/learn/mastery?classId=${cls.id}`}
                className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-gold hover:text-gold/80 transition-colors"
              >
                <Plus size={11} weight="bold" /> Add target
              </Link>
            </div>

            {exams.length === 0 ? (
              <div className="group rounded-[12px] border border-dashed border-white/[0.1] hover:border-white/[0.2] bg-white/[0.02] px-4 py-3.5 flex items-center justify-between gap-3 transition-colors">
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cream/50 inline-flex items-center gap-2">
                  <Target size={14} className="text-cream/40" /> No exam targets yet
                </p>
                <Link
                  href={`/learn/mastery?classId=${cls.id}`}
                  className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-cream/70 hover:text-cream whitespace-nowrap"
                >
                  Set first target
                  <ArrowRight size={11} weight="bold" className="transition-transform duration-200 group-hover:translate-x-0.5" />
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
          <section className="mb-6">
            <GradeTracker classId={cls.id} />
          </section>

          {/* Notes + Flashcards — these are paired (notes feed flashcards)
              so on desktop they sit side-by-side instead of stacking with
              big empty-state gaps. On mobile they collapse back to a stack. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8">
            <NotesSection
              classId={cls.id}
              notes={notes}
              onChange={() => void mutate()}
            />
            <FlashcardStudy classId={cls.id} />
          </div>

          {/* Confirm + Edit modals — Bucket B dead-end fix (2026-06-05). */}
          <ConfirmModal
            open={showArchiveConfirm}
            onClose={() => setShowArchiveConfirm(false)}
            onConfirm={async () => {
              await handleArchive();
              setShowArchiveConfirm(false);
            }}
            title="Archive this class?"
            message={`"${cls.name}" will be hidden from your list. You can restore it later.`}
            confirmLabel="Archive"
            destructive
          />

          {showEditModal && (
            <EditClassModal
              cls={cls}
              onClose={() => setShowEditModal(false)}
              onSaved={() => { setShowEditModal(false); void mutate(); }}
            />
          )}
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
        <h2 className="font-bebas text-[15px] text-cream/90 tracking-[0.22em] inline-flex items-center gap-2.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0 bg-gold"
            aria-hidden="true"
          />
          <Note size={13} weight="bold" /> NOTES
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
        <div className="rounded-[12px] border border-dashed border-white/[0.08] bg-white/[0.015] p-7 text-center">
          <div className="inline-grid place-items-center w-9 h-9 rounded-full bg-gold/10 border border-gold/20 mx-auto mb-3">
            <Note size={15} className="text-gold" weight="bold" />
          </div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cream/55 mb-1.5">
            No notes yet
          </p>
          <p className="text-[12px] text-cream/45 mb-4 leading-relaxed">
            Use ⌘K from anywhere to capture a thought. Lionade files it here.
          </p>
          <button
            type="button"
            onClick={() => setDrafting(true)}
            className="inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-gold hover:text-gold/80 transition-colors"
          >
            <Plus size={11} weight="bold" /> Add your first note
          </button>
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
  const [showArchive, setShowArchive] = useState(false);

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
    setBusy(true);
    const r = await apiDelete(`/api/classes/notes/${note.id}`);
    setBusy(false);
    if (!r.ok) {
      toastError(r.error || "Couldn't archive.");
      throw new Error("note archive failed");
    }
    onChange();
  };

  // Two-line teaser of the body
  const teaser = note.body.length > 220 ? note.body.slice(0, 220).trim() + "…" : note.body;

  return (
    <div
      className={`group relative rounded-[10px] border px-4 py-3 transition-colors
        ${note.pinned
          ? "border-gold/30 bg-gold/[0.05]"
          : "border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04] hover:border-white/[0.1]"}`}
    >
      {note.pinned && (
        <span
          className="absolute -top-1.5 left-3 font-mono text-[8.5px] uppercase tracking-[0.3em] text-gold bg-navy px-1.5 inline-flex items-center gap-1"
          aria-hidden="true"
        >
          <PushPin size={8} weight="fill" /> Pinned
        </span>
      )}
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
        <div className="flex items-center gap-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
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
            onClick={() => setShowArchive(true)}
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
        <div className="mt-2.5 flex flex-wrap gap-1">
          {note.aiTopics.map(t => (
            <span
              key={t}
              className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/50 border border-white/[0.08] rounded-full px-2 py-0.5"
            >
              {t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-[0.22em] text-cream/30 tabular-nums">
        <span>{new Date(note.updatedAt).toLocaleDateString()}</span>
        {note.source !== "manual" && <span>· via {note.source}</span>}
      </div>
      <ConfirmModal
        open={showArchive}
        onClose={() => setShowArchive(false)}
        onConfirm={async () => { await archive(); setShowArchive(false); }}
        title="Archive this note?"
        message="It won't show in the list anymore. You can still find it from search later."
        confirmLabel="Archive"
        destructive
      />
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
        bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-200 p-4 block relative overflow-hidden"
    >
      <span
        className="pointer-events-none absolute inset-y-0 left-0 w-px opacity-0 group-hover:opacity-100 transition-opacity"
        style={{ background: `linear-gradient(180deg, transparent, ${color}, transparent)` }}
        aria-hidden="true"
      />
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-bebas text-[22px] tracking-wider text-cream leading-tight truncate">
            {exam.title}
          </h3>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 mt-1.5">
            {days !== null && days >= 0 && (
              <span className="flex items-center gap-1 tabular-nums">
                <Calendar size={10} weight="bold" /> {days === 0 ? "today" : `${days}d`}
              </span>
            )}
            <span className="flex items-center gap-1 tabular-nums">
              <Clock size={10} weight="bold" /> {timeLabel}
            </span>
            <span className="tabular-nums">{exam.subtopicCount} subtopics</span>
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
          className="opacity-30 group-hover:opacity-100 transition-all duration-200 will-change-transform shrink-0 mt-1 -translate-x-1 group-hover:translate-x-0"
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
        <h2 className="font-bebas text-[15px] text-cream/90 tracking-[0.22em] inline-flex items-center gap-2.5">
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
            style={{ background: color }}
            aria-hidden="true"
          />
          <Brain size={13} weight="bold" /> TODAY&apos;S PLAN
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


// ─────────────────────────────────────────────────────────────────────────────
// Edit class modal — Bucket B dead-end fix (2026-06-05). Wires the "Edit
// details" menu item that was a TODO. PATCHes /api/classes/[id] with name,
// shortCode, professor, term, color, emoji.
// ─────────────────────────────────────────────────────────────────────────────
const EDIT_PRESET_COLORS = [
  "#FFD700", "#4A90D9", "#A855F7", "#22C55E",
  "#EF4444", "#F97316", "#06B6D4", "#EAB308",
];

function EditClassModal({
  cls, onClose, onSaved,
}: {
  cls: ClassDetail["class"];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(cls.name);
  const [shortCode, setShortCode] = useState(cls.shortCode ?? "");
  const [professor, setProfessor] = useState(cls.professor ?? "");
  const [term, setTerm] = useState(cls.term ?? "");
  const [color, setColor] = useState(cls.color);
  const [emoji, setEmoji] = useState(cls.emoji ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Esc closes (when not submitting). Aligns with CreateClassModal + the
  // Delete Account modal pattern.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !submitting) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submitting, onClose]);

  const submit = async () => {
    if (submitting) return;
    const trimmedName = name.trim();
    if (trimmedName.length < 2) {
      setError("Class name must be at least 2 characters.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const r = await apiPatch(`/api/classes/${cls.id}`, {
      name: trimmedName,
      shortCode: shortCode.trim() || null,
      professor: professor.trim() || null,
      term: term.trim() || null,
      color,
      emoji: emoji.trim() || null,
    });
    if (!r.ok) {
      console.error("[classes:edit] failed", r.error);
      setError("Couldn't save changes. Try again.");
      setSubmitting(false);
      return;
    }
    toastSuccess("Class updated.");
    onSaved();
  };

  return (
    <div
      className="fixed inset-0 z-[60] grid place-items-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget && !submitting) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-[14px] border border-white/[0.1] bg-gradient-to-br from-navy to-[#0a0f1d] p-5 sm:p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          disabled={submitting}
          aria-label="Close"
          className="absolute top-3 right-3 text-cream/40 hover:text-cream grid place-items-center w-7 h-7 rounded-full hover:bg-white/[0.05] disabled:opacity-40"
        >
          <X size={14} weight="bold" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <PencilSimple size={14} className="text-gold" weight="bold" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Edit class
          </span>
        </div>
        <h3 className="font-bebas text-[26px] tracking-wider text-cream leading-tight mb-4">
          Update the details
        </h3>

        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 mb-1.5 block">
            Class name *
          </span>
          <input
            value={name}
            onChange={e => setName(e.target.value.slice(0, 80))}
            placeholder="e.g. Calculus 2"
            className="w-full rounded-[8px] bg-white/[0.04] border border-white/[0.08]
              focus:border-gold/40 focus:outline-none px-3 py-2.5 text-[14px] text-cream
              placeholder:text-cream/30"
          />
        </label>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 mb-1.5 block">
              Code
            </span>
            <input
              value={shortCode}
              onChange={e => setShortCode(e.target.value.slice(0, 24))}
              placeholder="MATH 2002"
              className="w-full rounded-[8px] bg-white/[0.04] border border-white/[0.08]
                focus:border-gold/40 focus:outline-none px-3 py-2 text-[13px] text-cream
                placeholder:text-cream/30"
            />
          </label>
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 mb-1.5 block">
              Term
            </span>
            <input
              value={term}
              onChange={e => setTerm(e.target.value.slice(0, 32))}
              placeholder="Spring 2026"
              className="w-full rounded-[8px] bg-white/[0.04] border border-white/[0.08]
                focus:border-gold/40 focus:outline-none px-3 py-2 text-[13px] text-cream
                placeholder:text-cream/30"
            />
          </label>
        </div>

        <label className="block mb-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 mb-1.5 block">
            Professor
          </span>
          <input
            value={professor}
            onChange={e => setProfessor(e.target.value.slice(0, 80))}
            placeholder="e.g. Dr. Patel"
            className="w-full rounded-[8px] bg-white/[0.04] border border-white/[0.08]
              focus:border-gold/40 focus:outline-none px-3 py-2 text-[13px] text-cream
              placeholder:text-cream/30"
          />
        </label>

        <div className="grid grid-cols-[auto_1fr] gap-3 mb-5 items-end">
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 mb-1.5 block">
              Emoji
            </span>
            <input
              value={emoji}
              onChange={e => setEmoji(e.target.value.slice(0, 4))}
              placeholder="📐"
              className="w-16 rounded-[8px] bg-white/[0.04] border border-white/[0.08]
                focus:border-gold/40 focus:outline-none px-3 py-2 text-[16px] text-center"
            />
          </label>
          <div>
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 mb-1.5 block">
              Color
            </span>
            <div className="flex gap-2 flex-wrap">
              {EDIT_PRESET_COLORS.map(c => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setColor(c)}
                  aria-label={`Pick color ${c}`}
                  className={`w-7 h-7 rounded-full border-2 transition-transform
                    ${color === c ? "scale-110" : "hover:scale-105"}`}
                  style={{
                    backgroundColor: c,
                    borderColor: color === c ? "#ffffff80" : "#ffffff10",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        {error && (
          <p className="text-[12px] text-[#EF4444] mb-3">{error}</p>
        )}

        <div className="flex items-center gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-3 py-2 disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || name.trim().length < 2}
            className="rounded-full bg-gold hover:bg-gold/90 text-navy
              font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5
              disabled:opacity-40 disabled:cursor-not-allowed transition-colors
              inline-flex items-center gap-1.5"
          >
            {submitting ? "Saving..." : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
