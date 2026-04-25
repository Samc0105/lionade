"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useParams, useRouter } from "next/navigation";
import {
  CaretLeft, Plus, Target, Note, Sparkle, Calendar, Clock,
  CheckCircle, ArrowRight, DotsThreeVertical, Trash, PencilSimple,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiDelete, swrFetcher } from "@/lib/api-client";
import MasteryProgressBar from "@/components/Mastery/MasteryProgressBar";

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

  const { data, isLoading } = useSWR<ClassDetail>(
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
  const nextDays = daysUntil(nextExam?.targetDate ?? null);

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

        <main className="relative z-10 max-w-[980px] mx-auto px-4 sm:px-6 pt-6 pb-24">
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

          {/* Header — color stripe + name + countdown */}
          <header className="relative mb-8 rounded-[16px] overflow-hidden border border-white/[0.08] bg-white/[0.02] p-5 sm:p-6">
            <span
              className="absolute top-0 left-0 right-0 h-1.5"
              style={{ background: `linear-gradient(90deg, ${cls.color}, ${cls.color}40)` }}
              aria-hidden="true"
            />
            <div className="flex items-start gap-4 mb-3">
              {cls.emoji && (
                <span className="text-[40px] leading-none mt-1 shrink-0" aria-hidden="true">
                  {cls.emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <h1 className="font-bebas text-4xl sm:text-5xl tracking-[0.06em] text-cream leading-none mb-1">
                  {cls.name}
                </h1>
                {(cls.shortCode || cls.term || cls.professor) && (
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45">
                    {[cls.shortCode, cls.term, cls.professor].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            </div>

            {/* Next-exam countdown */}
            {nextExam && nextDays !== null && (
              <div
                className="flex items-center gap-2 rounded-[8px] px-3 py-2.5 border"
                style={{
                  borderColor: `${cls.color}40`,
                  backgroundColor: `${cls.color}0d`,
                }}
              >
                <Calendar size={14} weight="bold" style={{ color: cls.color }} />
                <span className="text-[13px] text-cream/85">
                  {nextExam.title}
                </span>
                <span
                  className="ml-auto font-bebas text-[20px] tabular-nums tracking-wider leading-none"
                  style={{ color: cls.color }}
                >
                  {nextDays === 0 ? "TODAY" : nextDays === 1 ? "1 DAY" : `${nextDays} DAYS`}
                </span>
              </div>
            )}
          </header>

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

          {/* Notes — placeholder for Phase 1C */}
          <section>
            <div className="flex items-baseline justify-between mb-4">
              <h2 className="font-bebas text-sm text-cream/85 tracking-[0.2em]">
                <span className="inline-flex items-center gap-2">
                  <Note size={13} weight="bold" /> NOTES
                </span>
              </h2>
              <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/30">
                Coming soon
              </span>
            </div>
            <div className="rounded-[12px] border border-dashed border-white/[0.08] bg-white/[0.015] p-6 text-center">
              <Note size={18} className="text-cream/30 mx-auto mb-2" />
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/40">
                Quick-note shortcut + AI categorization landing next
              </p>
              {notes.length > 0 && (
                <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/30 mt-2">
                  {notes.length} note{notes.length === 1 ? "" : "s"} already filed for this class
                </p>
              )}
            </div>
          </section>
        </main>
      </div>
    </ProtectedRoute>
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
