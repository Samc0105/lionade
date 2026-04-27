"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Plus, Target, Note, ArrowRight, BookOpen, GraduationCap,
  PushPin, Sparkle, X, Clock,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useRouter } from "next/navigation";

/**
 * Academia hub — the canonical home for everything school-related.
 *
 *   - All classes (grid + create) at the top
 *   - Recent notes across all classes in the side rail / mid-section
 *   - Quick stats footer (note count, exam countdown)
 *
 * Replaces the old /classes landing page as the primary entry point;
 * /classes still works for direct linking but the navbar surfaces this.
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

interface RecentNote {
  id: string;
  title: string | null;
  preview: string;
  pinned: boolean;
  updatedAt: string;
  classId: string;
  className: string;
  classColor: string;
  classEmoji: string | null;
  classShortCode: string | null;
}

const PRESET_COLORS = [
  "#FFD700", "#4A90D9", "#A855F7", "#22C55E",
  "#EF4444", "#F97316", "#06B6D4", "#EAB308",
];

export default function AcademiaPage() {
  const router = useRouter();

  // Required onboarding gate. Hits before classes/notes load so we can
  // shortcut the redirect; SWR's deduping means there's no extra cost
  // when the user comes back through.
  const { data: gate, isLoading: gateLoading } = useSWR<{ onboarded: boolean }>(
    "/api/academia/onboarding", swrFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (gate && gate.onboarded === false) {
      router.replace("/academia/onboarding");
    }
  }, [gate, router]);

  const allowed = gate?.onboarded === true;

  const { data: classData, mutate: mutateClasses, isLoading: classesLoading } = useSWR<{ classes: ClassSummary[] }>(
    allowed ? "/api/classes" : null, swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const { data: notesData } = useSWR<{ notes: RecentNote[] }>(
    allowed ? "/api/classes/recent-notes" : null, swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const classes = classData?.classes ?? [];
  const notes = notesData?.notes ?? [];
  const [showCreate, setShowCreate] = useState(false);

  // Hold render until the gate resolves. Avoids flashing the hub before
  // the redirect kicks in for un-onboarded users.
  if (gateLoading || !allowed) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-navy text-cream flex items-center justify-center">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
        </div>
      </ProtectedRoute>
    );
  }

  const totalNotes = classes.reduce((sum, c) => sum + c.noteCount, 0);
  const totalExams = classes.reduce((sum, c) => sum + c.examCount, 0);
  const nextExam = classes
    .filter(c => c.nextExamDate)
    .sort((a, b) => (a.nextExamDate! < b.nextExamDate! ? -1 : 1))[0];
  const daysToNextExam = nextExam ? daysUntil(nextExam.nextExamDate!) : null;

  return (
    <ProtectedRoute>
      <div className="min-h-screen bg-navy text-cream pt-12">
        <SpaceBackground />
        <Navbar />

        <main className="relative z-10 max-w-[1180px] mx-auto px-4 sm:px-6 pt-6 pb-24">
          {/* ─── Header ─── */}
          <header className="mb-8">
            <div className="flex items-center gap-2 mb-2">
              <GraduationCap size={14} className="text-gold" weight="fill" />
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold">
                Academia
              </p>
            </div>
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <div>
                <h1 className="font-bebas text-4xl sm:text-5xl tracking-[0.06em] text-cream leading-none">
                  your classroom
                </h1>
                <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-cream/50 mt-3">
                  Classes, notes, plans — every school thing in one place.
                </p>
              </div>
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
          </header>

          {/* ─── Quick stats strip ─── */}
          {classes.length > 0 && (
            <div className="grid grid-cols-3 gap-2.5 mb-8">
              <StatTile
                label="Classes"
                value={classes.length}
                icon={<BookOpen size={14} weight="bold" />}
                color="#4A90D9"
              />
              <StatTile
                label="Notes"
                value={totalNotes}
                icon={<Note size={14} weight="bold" />}
                color="#A855F7"
              />
              <StatTile
                label={daysToNextExam !== null ? "Next exam" : "Exams"}
                value={daysToNextExam !== null
                  ? daysToNextExam <= 0 ? "Today" : `${daysToNextExam}d`
                  : totalExams}
                icon={<Target size={14} weight="bold" />}
                color="#EF4444"
                sublabel={daysToNextExam !== null && nextExam ? nextExam.name : undefined}
              />
            </div>
          )}

          {/* ─── Two-column layout: classes (2/3) | recent notes (1/3) ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-6">
            {/* Classes column */}
            <section>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-bebas text-xl text-cream tracking-wider">
                  YOUR CLASSES
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">
                  {classes.length} {classes.length === 1 ? "class" : "classes"}
                </span>
              </div>

              {classesLoading && classes.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[0, 1, 2, 3].map(i => (
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
            </section>

            {/* Recent notes column */}
            <aside>
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="font-bebas text-xl text-cream tracking-wider">
                  RECENT NOTES
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40">
                  {notes.length}
                </span>
              </div>

              {notes.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
                  <Note size={20} className="text-cream/30 mx-auto mb-2" />
                  <p className="text-[12px] text-cream/55 leading-snug mb-3">
                    No notes yet. Hit <kbd className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-white/[0.05] border border-white/[0.1]">⌘K</kbd> anywhere to drop one in.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {notes.map(n => <NoteRow key={n.id} note={n} />)}
                </div>
              )}
            </aside>
          </div>
        </main>

        {showCreate && (
          <CreateClassModal
            onClose={() => setShowCreate(false)}
            onCreated={() => { setShowCreate(false); void mutateClasses(); }}
          />
        )}
      </div>
    </ProtectedRoute>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Stat tile
// ─────────────────────────────────────────────────────────────────────────────
function StatTile({
  label, value, icon, color, sublabel,
}: {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color: string;
  sublabel?: string;
}) {
  return (
    <div
      className="rounded-[12px] border bg-white/[0.02] px-3 py-2.5 sm:px-4 sm:py-3"
      style={{ borderColor: `${color}30` }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="font-mono text-[9px] uppercase tracking-[0.22em]">{label}</span>
      </div>
      <p className="font-bebas text-2xl sm:text-3xl tracking-wider text-cream leading-none">
        {value}
      </p>
      {sublabel && (
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/40 mt-1 truncate">
          {sublabel}
        </p>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Class card
// ─────────────────────────────────────────────────────────────────────────────
function ClassCard({ cls }: { cls: ClassSummary }) {
  const days = cls.nextExamDate ? daysUntil(cls.nextExamDate) : null;

  return (
    <Link
      href={`/classes/${cls.id}`}
      className="group relative rounded-[14px] border border-white/[0.08] bg-white/[0.03]
        hover:bg-white/[0.05] hover:border-white/[0.15] transition-all duration-200
        p-5 flex flex-col gap-3 overflow-hidden"
    >
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
        {days !== null && days >= 0 && (
          <div
            className="shrink-0 rounded-full px-2.5 py-1 border font-mono text-[10px] uppercase tracking-[0.18em] tabular-nums"
            style={{
              color: cls.color,
              borderColor: `${cls.color}55`,
              backgroundColor: `${cls.color}12`,
            }}
          >
            {days === 0 ? "TODAY" : days === 1 ? "1 DAY" : `${days} DAYS`}
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
// Note row (recent-notes rail)
// ─────────────────────────────────────────────────────────────────────────────
function NoteRow({ note }: { note: RecentNote }) {
  return (
    <Link
      href={`/classes/${note.classId}`}
      className="group block rounded-[10px] border border-white/[0.06] bg-white/[0.02]
        hover:bg-white/[0.04] hover:border-white/[0.12] transition-all duration-200
        px-3 py-2.5"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <span
          className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: note.classColor }}
          aria-hidden="true"
        />
        {note.classEmoji && <span className="text-[11px]" aria-hidden="true">{note.classEmoji}</span>}
        <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/55 truncate">
          {note.classShortCode || note.className}
        </span>
        {note.pinned && (
          <PushPin size={10} weight="fill" className="text-gold shrink-0" />
        )}
        <span className="ml-auto font-mono text-[9px] text-cream/30 tabular-nums shrink-0">
          {timeAgo(note.updatedAt)}
        </span>
      </div>
      {note.title && (
        <p className="font-syne font-semibold text-[13px] text-cream leading-tight mb-0.5 truncate">
          {note.title}
        </p>
      )}
      <p className="text-[12px] text-cream/55 leading-snug line-clamp-2">
        {note.preview}
      </p>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty + create tiles
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
// Create class modal — same shape as /classes/page so behavior stays parallel.
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

        <div className="space-y-3">
          <Field label="Class name">
            <input
              autoFocus
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Organic Chemistry"
              className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[14px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60"
              maxLength={80}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Short code (optional)">
              <input
                value={shortCode}
                onChange={e => setShortCode(e.target.value.toUpperCase())}
                placeholder="CHEM 121"
                className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[13px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60 uppercase"
                maxLength={20}
              />
            </Field>
            <Field label="Term (optional)">
              <input
                value={term}
                onChange={e => setTerm(e.target.value)}
                placeholder="Spring 2026"
                className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[13px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60"
                maxLength={30}
              />
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <Field label="Color">
              <div className="flex flex-wrap gap-1.5">
                {PRESET_COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Color ${c}`}
                    className={`w-7 h-7 rounded-full border-2 transition-transform ${
                      color === c ? "scale-110 border-cream" : "border-white/[0.2] hover:border-cream/60"
                    }`}
                    style={{ background: c }}
                  />
                ))}
              </div>
            </Field>
            <Field label="Emoji">
              <input
                value={emoji}
                onChange={e => setEmoji(e.target.value.slice(0, 2))}
                placeholder="🧪"
                className="w-14 rounded-md bg-white/[0.04] border border-white/[0.1] px-2 py-2.5 text-[18px] text-center focus:outline-none focus:border-gold/60"
              />
            </Field>
          </div>

          {error && (
            <p className="text-[12px] text-red-400 font-mono">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="font-mono text-[11px] uppercase tracking-[0.22em] text-cream/60 hover:text-cream px-3 py-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || name.trim().length < 2}
            className="inline-flex items-center gap-2 rounded-full bg-gold text-navy disabled:opacity-50 disabled:cursor-not-allowed
              font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5 hover:bg-gold/90 transition-colors"
          >
            {submitting ? "Creating…" : "Create"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/50 mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00");
  return Math.ceil((target.getTime() - today.getTime()) / 86_400_000);
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d`;
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
