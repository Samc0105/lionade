"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Plus, Target, Note, ArrowRight, BookOpen, Calendar,
  Sparkle, X,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useRouter } from "next/navigation";

/**
 * Class Notebook landing page — colored cards for each class with the
 * countdown to the next exam, exam count, and note count. Add-class
 * modal lives inline so creating a class never leaves this page.
 */

interface ClassSummary {
  id: string;
  name: string;
  shortCode: string | null;
  professor: string | null;
  term: string | null;
  color: string;
  emoji: string | null;
  position: number;
  examCount: number;
  noteCount: number;
  nextExamDate: string | null;
  overallDisplayPct: number;
  updatedAt: string;
}

const PRESET_COLORS = [
  "#FFD700", "#4A90D9", "#A855F7", "#22C55E",
  "#EF4444", "#F97316", "#06B6D4", "#EAB308",
];

export default function ClassesIndexPage() {
  const { data, mutate, isLoading } = useSWR<{ classes: ClassSummary[] }>(
    "/api/classes", swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const classes = data?.classes ?? [];
  const [showCreate, setShowCreate] = useState(false);

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />

        <main className="relative z-10 max-w-[980px] mx-auto px-4 sm:px-6 pt-6 pb-24">
          <header className="mb-8">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold mb-2">
              Class Notebook
            </p>
            <div className="flex items-end justify-between gap-3">
              <h1 className="font-bebas text-4xl sm:text-5xl tracking-[0.06em] text-cream leading-none">
                your classes
              </h1>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90
                  font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5
                  transition-transform duration-200 active:scale-[0.98]"
              >
                <Plus size={12} weight="bold" /> New class
              </button>
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/50 mt-3">
              One notebook per class. Notes, mastery, daily plan — all in one place.
            </p>
          </header>

          {isLoading && classes.length === 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-44 rounded-[14px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
              ))}
            </div>
          ) : classes.length === 0 ? (
            <EmptyState onCreate={() => setShowCreate(true)} />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {classes.map(c => <ClassCard key={c.id} cls={c} />)}
              <CreateTile onClick={() => setShowCreate(true)} />
            </div>
          )}
        </main>

        {showCreate && (
          <CreateClassModal
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); void mutate(); }}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Class card
// ─────────────────────────────────────────────────────────────────────────────
function ClassCard({ cls }: { cls: ClassSummary }) {
  const daysUntilExam = (() => {
    if (!cls.nextExamDate) return null;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const target = new Date(cls.nextExamDate + "T00:00:00");
    const diff = Math.ceil((target.getTime() - now.getTime()) / 86_400_000);
    return diff;
  })();

  return (
    <Link
      href={`/classes/${cls.id}`}
      className="group relative rounded-[14px] border border-white/[0.08] bg-white/[0.03]
        hover:bg-white/[0.05] hover:border-white/[0.15] transition-all duration-200
        p-5 flex flex-col gap-3 overflow-hidden"
    >
      {/* Color stripe */}
      <span
        className="absolute top-0 left-0 right-0 h-1"
        style={{ background: `linear-gradient(90deg, ${cls.color}, ${cls.color}40)` }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {cls.emoji && (
            <span className="text-[24px] leading-none mt-0.5 shrink-0" aria-hidden="true">
              {cls.emoji}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-bebas text-[24px] tracking-wider text-cream leading-tight truncate">
              {cls.name}
            </h3>
            {(cls.shortCode || cls.term) && (
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40 truncate">
                {[cls.shortCode, cls.term].filter(Boolean).join(" · ")}
              </p>
            )}
          </div>
        </div>
        {daysUntilExam !== null && daysUntilExam >= 0 && (
          <div
            className="shrink-0 rounded-full px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.18em] tabular-nums"
            style={{
              color: cls.color,
              borderColor: `${cls.color}55`,
              backgroundColor: `${cls.color}12`,
            }}
          >
            {daysUntilExam === 0 ? "TODAY"
              : daysUntilExam === 1 ? "1 DAY"
              : `${daysUntilExam} DAYS`}
          </div>
        )}
      </div>

      <div className="flex items-center gap-4 mt-auto font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">
        <span className="flex items-center gap-1">
          <Target size={11} weight="bold" /> {cls.examCount} {cls.examCount === 1 ? "exam" : "exams"}
        </span>
        <span className="flex items-center gap-1">
          <Note size={11} weight="bold" /> {cls.noteCount} {cls.noteCount === 1 ? "note" : "notes"}
        </span>
        <ArrowRight
          size={12}
          weight="bold"
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: cls.color }}
        />
      </div>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state + create tile
// ─────────────────────────────────────────────────────────────────────────────
function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="rounded-[14px] border border-dashed border-white/[0.1] bg-white/[0.02] p-10 text-center">
      <BookOpen size={28} className="text-cream/40 mx-auto mb-3" />
      <h2 className="font-bebas text-[26px] tracking-wider text-cream/90 mb-1">
        No classes yet
      </h2>
      <p className="text-[13px] text-cream/55 max-w-md mx-auto mb-5 leading-relaxed">
        Create a notebook for each class you're taking. Add the exam dates and
        Lionade builds your study plan around them.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-full bg-gold text-navy
          font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5
          hover:bg-gold/90 transition-colors"
      >
        <Plus size={12} weight="bold" /> Create first class
      </button>
    </div>
  );
}

function CreateTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-[14px] border border-dashed border-white/[0.1] bg-white/[0.01]
        hover:bg-white/[0.03] hover:border-white/[0.2] transition-colors
        p-5 flex flex-col items-center justify-center gap-2 text-cream/50 hover:text-cream/80
        min-h-[150px]"
    >
      <Plus size={20} weight="bold" />
      <span className="font-mono text-[11px] uppercase tracking-[0.25em]">New class</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create modal
// ─────────────────────────────────────────────────────────────────────────────
function CreateClassModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [shortCode, setShortCode] = useState("");
  const [term, setTerm] = useState("");
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [emoji, setEmoji] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (submitting) return;
    if (name.trim().length < 2) { setError("Class name must be at least 2 characters."); return; }
    setSubmitting(true);
    setError(null);
    try {
      const r = await apiPost<{ classId: string }>("/api/classes", {
        name: name.trim(),
        shortCode: shortCode.trim() || null,
        term: term.trim() || null,
        color,
        emoji: emoji.trim() || null,
      });
      if (!r.ok || !r.data?.classId) {
        setError(r.error || "Couldn't create class.");
        setSubmitting(false);
        return;
      }
      onCreated();
      router.push(`/classes/${r.data.classId}`);
    } catch (e) {
      setError((e as Error).message);
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-[14px] border border-white/[0.1] bg-gradient-to-br from-navy to-[#0a0f1d] p-5 sm:p-6 shadow-2xl">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 text-cream/40 hover:text-cream grid place-items-center w-7 h-7 rounded-full hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        <div className="flex items-center gap-2 mb-2">
          <Sparkle size={14} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            New class
          </span>
        </div>
        <h3 className="font-bebas text-[26px] tracking-wider text-cream leading-tight mb-4">
          What are you studying?
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
              {PRESET_COLORS.map(c => (
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
            className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream px-3 py-2"
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
            {submitting ? "Creating…" : <>Create <ArrowRight size={12} weight="bold" /></>}
          </button>
        </div>

        {/* Helper note about exam dates */}
        <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/30 mt-4 flex items-center gap-1.5">
          <Calendar size={10} weight="bold" />
          Add exam dates inside the class after creating it.
        </p>
      </div>
    </div>
  );
}
