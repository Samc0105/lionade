"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import {
  Plus, Target, Note, ArrowRight, BookOpen, GraduationCap,
  PushPin, Sparkle, X, Clock, ArrowsClockwise, CalendarBlank,
  CaretLeft, CaretRight, Circle, CircleDashed, CheckCircle,
} from "@phosphor-icons/react";
import ProtectedRoute from "@/components/ProtectedRoute";
import Navbar from "@/components/Navbar";
import SpaceBackground from "@/components/SpaceBackground";
import { apiPatch, apiPost, swrFetcher } from "@/lib/api-client";
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

type AssignmentStatus = "todo" | "doing" | "done";

interface AgendaItem {
  id: string;
  kind: "exam" | "assignment";
  date: string; // YYYY-MM-DD
  title: string;
  status?: AssignmentStatus;
  classId: string;
  className: string;
  classColor: string;
  classEmoji: string | null;
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
  const { data: gate, error: gateError, isLoading: gateLoading, mutate: mutateGate } = useSWR<{ onboarded: boolean }>(
    "/api/academia/onboarding", swrFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false },
  );
  useEffect(() => {
    if (gate && gate.onboarded === false) {
      router.replace("/academia/onboarding");
    }
  }, [gate, router]);

  const allowed = gate?.onboarded === true;

  const { data: classData, error: classesError, mutate: mutateClasses, isLoading: classesLoading } = useSWR<{ classes: ClassSummary[] }>(
    allowed ? "/api/classes" : null, swrFetcher,
    { keepPreviousData: true },
  );
  const { data: notesData } = useSWR<{ notes: RecentNote[] }>(
    allowed ? "/api/classes/recent-notes" : null, swrFetcher,
    { keepPreviousData: true },
  );

  const classes = classData?.classes ?? [];
  const notes = notesData?.notes ?? [];
  const [showCreate, setShowCreate] = useState(false);

  // Gate fetch failed. With shouldRetryOnError off, one transient 500 used
  // to strand this page on an infinite spinner. Show a retry card instead.
  // Never fail open into the hub: the gate exists to route un-onboarded
  // users to /academia/onboarding, so on error the only way forward is retry.
  if (gateError) {
    return (
      <ProtectedRoute>
        <div className="min-h-screen bg-navy text-cream flex items-center justify-center px-4">
          <div className="w-full max-w-sm">
            <ErrorCard
              message="Couldn't open your classroom. Network hiccup, probably."
              onRetry={() => void mutateGate()}
            />
          </div>
        </div>
      </ProtectedRoute>
    );
  }

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
          <header className="mb-10">
            <div className="flex items-center gap-2 mb-3">
              <span className="inline-block w-6 h-px bg-gold/70" aria-hidden="true" />
              <GraduationCap size={13} className="text-gold" weight="fill" />
              <p className="font-mono text-[10px] uppercase tracking-[0.32em] text-gold">
                Academia
              </p>
            </div>
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div>
                <h1 className="font-bebas text-5xl sm:text-6xl tracking-[0.05em] text-cream leading-[0.95]">
                  your classroom
                </h1>
                <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-cream/55 mt-4">
                  School year, sharpened. Every class, note, and plan in one place.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCreate(true)}
                className="inline-flex items-center gap-2 rounded-full bg-gold text-navy hover:bg-gold/90
                  font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5
                  transition-transform duration-200 active:scale-[0.98]
                  shadow-[0_0_24px_rgba(255,215,0,0.18)]"
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

          {/* ─── This week + month calendar ─── */}
          {classes.length > 0 && <PlannerSection />}

          {/* ─── Two-column layout: classes (2/3) | recent notes (1/3) ─── */}
          <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr] gap-6">
            {/* Classes column */}
            <section>
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-bebas text-[22px] text-cream tracking-[0.18em] flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold" aria-hidden="true" />
                  YOUR CLASSES
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 tabular-nums">
                  {classes.length} {classes.length === 1 ? "class" : "classes"}
                </span>
              </div>

              {classesLoading && classes.length === 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {[0, 1, 2, 3].map(i => (
                    <div key={i} className="h-44 rounded-[14px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
                  ))}
                </div>
              ) : classesError && classes.length === 0 ? (
                // Error before empty: a failed fetch is not "no classes yet".
                // Stale keepPreviousData still renders the grid below.
                <ErrorCard
                  message="Couldn't load your classes. Network hiccup, probably."
                  onRetry={() => void mutateClasses()}
                />
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
              <div className="flex items-baseline justify-between mb-4">
                <h2 className="font-bebas text-[22px] text-cream tracking-[0.18em] flex items-center gap-2">
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-electric" aria-hidden="true" />
                  RECENT NOTES
                </h2>
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/40 tabular-nums">
                  {notes.length}
                </span>
              </div>

              {notes.length === 0 ? (
                <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
                  <Note size={22} className="text-electric/60 mx-auto mb-2" />
                  <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45 mb-2">
                    Quiet for now
                  </p>
                  <p className="text-[12px] text-cream/60 leading-snug">
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
// Error card — mirrors the DiscoverTab ErrorState treatment (red glass +
// retry pill). Used for both the onboarding gate and the classes fetch.
// ─────────────────────────────────────────────────────────────────────────────
function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
      <p className="font-syne text-sm text-red-300 mb-3">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
      >
        <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
        Try again
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Planner — THIS WEEK agenda + month calendar. One SWR fetch keyed by the
// visible month; the range covers the whole visible month AND at least the
// next 7 days so the week agenda is always populated even while paging months.
// ─────────────────────────────────────────────────────────────────────────────
function PlannerSection() {
  // First day of the currently-displayed calendar month (local midnight).
  const [monthAnchor, setMonthAnchor] = useState(() => firstOfMonth(new Date()));
  // Day selected in the calendar (drives the agenda view). null = THIS WEEK.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  const todayKey = useMemo(() => toKey(new Date()), []);

  // Fetch range: [first of visible month, max(end of visible month, today+7)].
  const { from, to } = useMemo(() => {
    const monthStart = firstOfMonth(monthAnchor);
    const monthEnd = endOfMonth(monthAnchor);
    const weekHorizon = addDays(new Date(), 7);
    const toDate = monthEnd.getTime() >= weekHorizon.getTime() ? monthEnd : weekHorizon;
    return { from: toKey(monthStart), to: toKey(toDate) };
  }, [monthAnchor]);

  const { data, error, isLoading, mutate } = useSWR<{ items: AgendaItem[] }>(
    `/api/academia/agenda?from=${from}&to=${to}`,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const items = data?.items ?? [];

  // Index items by day key for fast calendar-cell lookups.
  const byDay = useMemo(() => {
    const map = new Map<string, AgendaItem[]>();
    for (const it of items) {
      const arr = map.get(it.date);
      if (arr) arr.push(it);
      else map.set(it.date, [it]);
    }
    return map;
  }, [items]);

  // Optimistic status toggle for assignments, then revalidate.
  const cycleStatus = async (item: AgendaItem) => {
    if (item.kind !== "assignment") return;
    const next = nextStatus(item.status ?? "todo");
    const optimistic: { items: AgendaItem[] } = {
      items: items.map(i => (i.id === item.id ? { ...i, status: next } : i)),
    };
    try {
      await mutate(
        async () => {
          const r = await apiPatch(`/api/classes/assignments/${item.id}`, { status: next });
          if (!r.ok) throw new Error(r.error ?? "patch failed");
          return undefined; // fall through to revalidation
        },
        { optimisticData: optimistic, rollbackOnError: true, revalidate: true, populateCache: false },
      );
    } catch (e) {
      console.error("[academia:agenda] status toggle failed", e);
    }
  };

  return (
    <section className="mb-10">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.25fr] gap-6 items-start">
        {/* THIS WEEK / selected-day agenda */}
        <div>
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="font-bebas text-[22px] text-cream tracking-[0.18em] flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-gold" aria-hidden="true" />
              {selectedDay ? dayHeading(selectedDay, todayKey).toUpperCase() : "THIS WEEK"}
            </h2>
            {selectedDay && (
              <button
                type="button"
                onClick={() => setSelectedDay(null)}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/45 hover:text-cream transition-colors"
              >
                Back to week
              </button>
            )}
          </div>

          {isLoading && items.length === 0 ? (
            <div className="space-y-2.5">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-14 rounded-[12px] bg-white/[0.03] border border-white/[0.06] animate-pulse" />
              ))}
            </div>
          ) : error && items.length === 0 ? (
            <ErrorCard
              message="Couldn't load your agenda. Network hiccup, probably."
              onRetry={() => void mutate()}
            />
          ) : (
            <AgendaList
              items={items}
              todayKey={todayKey}
              selectedDay={selectedDay}
              byDay={byDay}
              onCycleStatus={cycleStatus}
            />
          )}
        </div>

        {/* Month calendar */}
        <MonthCalendar
          monthAnchor={monthAnchor}
          todayKey={todayKey}
          selectedDay={selectedDay}
          byDay={byDay}
          onPrev={() => { setMonthAnchor(addMonths(monthAnchor, -1)); }}
          onNext={() => { setMonthAnchor(addMonths(monthAnchor, 1)); }}
          onToday={() => { setMonthAnchor(firstOfMonth(new Date())); setSelectedDay(todayKey); }}
          onSelectDay={(key) => setSelectedDay(prev => (prev === key ? null : key))}
        />
      </div>
    </section>
  );
}

// Agenda list: when no day is selected, shows [today, today+7] grouped by day.
// When a day is selected, shows just that day's items.
function AgendaList({
  items, todayKey, selectedDay, byDay, onCycleStatus,
}: {
  items: AgendaItem[];
  todayKey: string;
  selectedDay: string | null;
  byDay: Map<string, AgendaItem[]>;
  onCycleStatus: (item: AgendaItem) => void;
}) {
  if (selectedDay) {
    const dayItems = (byDay.get(selectedDay) ?? []).slice().sort(sortItems);
    if (dayItems.length === 0) {
      return <AgendaEmpty selected />;
    }
    return (
      <div className="space-y-2">
        {dayItems.map(it => <AgendaRow key={it.id} item={it} onCycleStatus={onCycleStatus} />)}
      </div>
    );
  }

  // Week view: today .. today+7 inclusive.
  const horizon = toKey(addDays(new Date(), 7));
  const weekItems = items
    .filter(it => it.date >= todayKey && it.date <= horizon)
    .sort(sortItems);

  if (weekItems.length === 0) {
    return <AgendaEmpty />;
  }

  // Group consecutive items by day, preserving sorted order.
  const groups: { key: string; items: AgendaItem[] }[] = [];
  for (const it of weekItems) {
    const last = groups[groups.length - 1];
    if (last && last.key === it.date) last.items.push(it);
    else groups.push({ key: it.date, items: [it] });
  }

  return (
    <div className="space-y-4">
      {groups.map(g => (
        <div key={g.key}>
          <p className="font-mono text-[9px] uppercase tracking-[0.28em] text-cream/40 mb-2">
            {dayHeading(g.key, todayKey)}
          </p>
          <div className="space-y-2">
            {g.items.map(it => <AgendaRow key={it.id} item={it} onCycleStatus={onCycleStatus} />)}
          </div>
        </div>
      ))}
    </div>
  );
}

function AgendaRow({
  item, onCycleStatus,
}: {
  item: AgendaItem;
  onCycleStatus: (item: AgendaItem) => void;
}) {
  const isExam = item.kind === "exam";
  const status = item.status ?? "todo";
  const done = status === "done";

  return (
    <div
      className="group relative flex items-center gap-3 rounded-[12px] border bg-white/[0.02]
        hover:bg-white/[0.04] transition-colors duration-200 px-3 py-2.5 pl-[14px] overflow-hidden"
      style={{ boxShadow: `inset 2px 0 0 0 ${item.classColor}80` }}
    >
      <span
        className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
        style={{ background: item.classColor }}
        aria-hidden="true"
      />
      {item.classEmoji && <span className="text-[14px] shrink-0" aria-hidden="true">{item.classEmoji}</span>}

      <div className="min-w-0 flex-1">
        <p className={`font-syne font-semibold text-[13px] leading-tight truncate ${done ? "text-cream/45 line-through" : "text-cream"}`}>
          {item.title}
        </p>
        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/45 truncate mt-0.5">
          {item.className}
        </p>
      </div>

      {isExam ? (
        <span
          className="shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em]"
          style={{ color: "#EF4444", borderColor: "#EF444455", backgroundColor: "#EF444412" }}
        >
          <Target size={10} weight="bold" /> Exam
        </span>
      ) : (
        <StatusButton status={status} color={item.classColor} onClick={() => onCycleStatus(item)} />
      )}
    </div>
  );
}

function StatusButton({
  status, color, onClick,
}: {
  status: AssignmentStatus;
  color: string;
  onClick: () => void;
}) {
  const meta = {
    todo: { label: "To do", Icon: Circle },
    doing: { label: "Doing", Icon: CircleDashed },
    done: { label: "Done", Icon: CheckCircle },
  }[status];
  const Icon = meta.Icon;
  const active = status !== "todo";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Status: ${meta.label}. Click to advance.`}
      title={`${meta.label} — click to advance`}
      className="shrink-0 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-[0.18em] transition-colors duration-200"
      style={{
        color: active ? color : "rgba(238,244,255,0.55)",
        borderColor: active ? `${color}55` : "rgba(255,255,255,0.12)",
        backgroundColor: active ? `${color}12` : "rgba(255,255,255,0.02)",
      }}
    >
      <Icon size={11} weight={status === "done" ? "fill" : "bold"} /> {meta.label}
    </button>
  );
}

function AgendaEmpty({ selected }: { selected?: boolean }) {
  return (
    <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center">
      <CalendarBlank size={22} className="text-gold/60 mx-auto mb-2" />
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/45 mb-2">
        {selected ? "Clear day" : "All clear"}
      </p>
      <p className="text-[12px] text-cream/60 leading-snug">
        {selected
          ? "Nothing scheduled for this day."
          : "Nothing due this week. Add an exam date or assignment to see it here."}
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Month calendar — plain date-math grid, Sunday-first (US), GPU-only hover.
// ─────────────────────────────────────────────────────────────────────────────
const WEEKDAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MAX_DOTS = 3;

function MonthCalendar({
  monthAnchor, todayKey, selectedDay, byDay,
  onPrev, onNext, onToday, onSelectDay,
}: {
  monthAnchor: Date;
  todayKey: string;
  selectedDay: string | null;
  byDay: Map<string, AgendaItem[]>;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  onSelectDay: (key: string) => void;
}) {
  // Build a 6-row x 7-col grid starting on the Sunday on/before the 1st.
  const cells = useMemo(() => buildMonthGrid(monthAnchor), [monthAnchor]);
  const monthLabel = monthAnchor.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const visibleMonth = monthAnchor.getMonth();

  return (
    <div className="rounded-[16px] border border-white/[0.08] bg-white/[0.02] p-4 sm:p-5">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <CalendarBlank size={14} className="text-gold" weight="fill" aria-hidden="true" />
          <span className="font-bebas text-[20px] tracking-[0.1em] text-cream leading-none">
            {monthLabel}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={onToday}
            className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/55 hover:text-gold transition-colors px-2 py-1 rounded-full border border-white/[0.1] hover:border-gold/40"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous month"
            className="grid place-items-center w-7 h-7 rounded-full border border-white/[0.1] text-cream/60 hover:text-cream hover:border-white/[0.25] transition-colors"
          >
            <CaretLeft size={13} weight="bold" />
          </button>
          <button
            type="button"
            onClick={onNext}
            aria-label="Next month"
            className="grid place-items-center w-7 h-7 rounded-full border border-white/[0.1] text-cream/60 hover:text-cream hover:border-white/[0.25] transition-colors"
          >
            <CaretRight size={13} weight="bold" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 mb-1">
        {WEEKDAY_LABELS.map((d, i) => (
          <div key={i} className="text-center font-mono text-[9px] uppercase tracking-[0.18em] text-cream/35 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map(cell => (
          <CalendarCell
            key={cell.key}
            cell={cell}
            inMonth={cell.month === visibleMonth}
            isToday={cell.key === todayKey}
            isSelected={cell.key === selectedDay}
            dayItems={byDay.get(cell.key) ?? []}
            onSelect={() => onSelectDay(cell.key)}
          />
        ))}
      </div>
    </div>
  );
}

function CalendarCell({
  cell, inMonth, isToday, isSelected, dayItems, onSelect,
}: {
  cell: GridCell;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  dayItems: AgendaItem[];
  onSelect: () => void;
}) {
  const sorted = dayItems.slice().sort(sortItems);
  const shown = sorted.slice(0, MAX_DOTS);
  const extra = sorted.length - shown.length;
  const hasItems = sorted.length > 0;

  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={!hasItems && !inMonth}
      aria-label={`${cell.label}${hasItems ? `, ${sorted.length} item${sorted.length === 1 ? "" : "s"}` : ""}`}
      aria-pressed={isSelected}
      className={`relative aspect-square rounded-[10px] border p-1 flex flex-col items-center justify-start gap-1
        transition-colors duration-150 will-change-transform
        ${inMonth ? "bg-white/[0.02]" : "bg-transparent opacity-40"}
        ${isSelected ? "border-electric/70 bg-electric/[0.08]" : isToday ? "border-gold/70" : "border-white/[0.06]"}
        ${hasItems ? "hover:bg-white/[0.06]" : "hover:bg-white/[0.03]"}
        ${!hasItems && !inMonth ? "cursor-default" : ""}`}
    >
      <span
        className={`font-mono text-[10px] tabular-nums leading-none mt-0.5
          ${isToday ? "text-gold font-bold" : inMonth ? "text-cream/75" : "text-cream/40"}`}
      >
        {cell.dayOfMonth}
      </span>
      {hasItems && (
        <span className="flex items-center justify-center gap-0.5 flex-wrap leading-none">
          {shown.map(it => (
            it.kind === "exam" ? (
              <span
                key={it.id}
                className="inline-block w-1.5 h-1.5 rounded-full ring-1"
                style={{ background: it.classColor, boxShadow: `0 0 0 1px #EF444499` }}
                aria-hidden="true"
              />
            ) : (
              <span
                key={it.id}
                className="inline-block w-1.5 h-1.5 rounded-full"
                style={{ background: it.classColor, opacity: it.status === "done" ? 0.4 : 1 }}
                aria-hidden="true"
              />
            )
          ))}
          {extra > 0 && (
            <span className="font-mono text-[8px] text-cream/45 tabular-nums leading-none">+{extra}</span>
          )}
        </span>
      )}
    </button>
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
      className="relative rounded-[12px] border px-3 py-2.5 sm:px-4 sm:py-3 overflow-hidden"
      style={{
        borderColor: `${color}30`,
        background: `linear-gradient(135deg, ${color}0C 0%, rgba(255,255,255,0.02) 100%)`,
      }}
    >
      <div className="flex items-center gap-1.5 mb-1" style={{ color }}>
        {icon}
        <span className="font-mono text-[9px] uppercase tracking-[0.22em]">{label}</span>
      </div>
      <p className="font-bebas text-2xl sm:text-[34px] tracking-wider text-cream leading-none tabular-nums">
        {value}
      </p>
      {sublabel && (
        <p className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/45 mt-1 truncate">
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
  const hasPct = typeof cls.overallDisplayPct === "number" && cls.overallDisplayPct > 0;

  return (
    <Link
      href={`/classes/${cls.id}`}
      className="group relative rounded-[14px] border bg-white/[0.03]
        hover:bg-white/[0.05] transition-all duration-200
        p-5 flex flex-col gap-3 overflow-hidden
        will-change-transform motion-safe:hover:-translate-y-0.5"
      style={{
        background: `linear-gradient(135deg, ${cls.color}10 0%, ${cls.color}05 100%), rgba(255,255,255,0.03)`,
        borderColor: `${cls.color}28`,
      }}
    >
      <span
        className="absolute left-0 top-0 bottom-0 w-[3px]"
        style={{ background: `linear-gradient(180deg, ${cls.color}, ${cls.color}40)` }}
        aria-hidden="true"
      />
      <span
        className="absolute top-0 left-0 right-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${cls.color}60, transparent)` }}
        aria-hidden="true"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          {cls.emoji && (
            <span className="text-[26px] leading-none mt-0.5 shrink-0" aria-hidden="true">
              {cls.emoji}
            </span>
          )}
          <div className="min-w-0">
            <h3 className="font-bebas text-[26px] tracking-wider text-cream leading-tight truncate">
              {cls.name}
            </h3>
            {(cls.shortCode || cls.term) && (
              <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/45 truncate mt-0.5">
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

      <div className="flex items-center gap-3 mt-auto font-mono text-[10px] uppercase tracking-[0.2em] text-cream/50 tabular-nums">
        <span className="flex items-center gap-1">
          <Target size={11} weight="bold" /> {cls.examCount} {cls.examCount === 1 ? "exam" : "exams"}
        </span>
        <span className="flex items-center gap-1">
          <Note size={11} weight="bold" /> {cls.noteCount} {cls.noteCount === 1 ? "note" : "notes"}
        </span>
        {hasPct && (
          <span
            className="flex items-center gap-1 rounded-full border px-1.5 py-0.5 tabular-nums"
            style={{ borderColor: `${cls.color}40`, color: cls.color }}
          >
            {cls.overallDisplayPct.toFixed(0)}%
          </span>
        )}
        <ArrowRight
          size={12}
          weight="bold"
          className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity motion-safe:group-hover:translate-x-0.5"
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
      className="group relative block rounded-[10px] border border-white/[0.06] bg-white/[0.02]
        hover:bg-white/[0.04] hover:border-white/[0.12] transition-all duration-200
        px-3 py-2.5 pl-[14px] overflow-hidden"
      style={{ boxShadow: `inset 2px 0 0 0 ${note.classColor}80` }}
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
    <div className="rounded-[14px] border border-dashed border-gold/25 bg-gradient-to-br from-gold/[0.04] to-transparent p-10 text-center">
      <BookOpen size={28} className="text-gold/70 mx-auto mb-3" />
      <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/80 mb-2">
        Blank slate
      </p>
      <h2 className="font-bebas text-[30px] tracking-wider text-cream mb-2 leading-tight">
        No classes yet
      </h2>
      <p className="text-[13px] text-cream/60 max-w-md mx-auto mb-5 leading-relaxed">
        Spin up a notebook for each class you&apos;re taking. Drop your exam dates in and
        Lionade builds the study plan around them.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="inline-flex items-center gap-2 rounded-full bg-gold text-navy
          font-mono text-[11px] uppercase tracking-[0.25em] px-5 py-2.5
          hover:bg-gold/90 transition-colors shadow-[0_0_24px_rgba(255,215,0,0.22)]"
      >
        <Plus size={12} weight="bold" /> Add your first class
      </button>
    </div>
  );
}

function CreateTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-[14px] border border-dashed border-white/[0.1] bg-white/[0.01]
        hover:bg-gold/[0.04] hover:border-gold/40 transition-colors
        p-5 flex flex-col items-center justify-center gap-2 text-cream/50 hover:text-gold
        min-h-[150px]"
    >
      <span className="grid place-items-center w-10 h-10 rounded-full border border-current/30 group-hover:border-gold/60 transition-colors">
        <Plus size={18} weight="bold" />
      </span>
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
      });
      if (!r.ok || !r.data?.classId) {
        console.error("[academia:create-class] failed", r.error);
        setError("Couldn't create class. Try again.");
        setSubmitting(false);
        return;
      }
      onCreated();
      router.push(`/classes/${r.data.classId}`);
    } catch (e) {
      console.error("[academia:create-class] threw", e);
      setError("Network's being weird. Try again.");
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

        <div className="flex items-center gap-2 mb-3">
          <span className="inline-block w-5 h-px bg-gold/70" aria-hidden="true" />
          <Sparkle size={13} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.32em] text-gold">
            New class
          </span>
        </div>
        <h3 className="font-bebas text-[32px] tracking-wider text-cream leading-[0.95] mb-5">
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

// ── Calendar date math (all local-time, midnight-anchored) ────────────────────
interface GridCell {
  key: string;        // YYYY-MM-DD
  dayOfMonth: number; // 1..31
  month: number;      // 0..11 (used to gray out spillover days)
  label: string;      // accessible "Mon, Jun 9"
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() + n);
  return r;
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

// 6x7 grid starting on the Sunday on/before the 1st of the anchor's month.
function buildMonthGrid(anchor: Date): GridCell[] {
  const first = firstOfMonth(anchor);
  const start = addDays(first, -first.getDay()); // back up to Sunday
  const cells: GridCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(start, i);
    cells.push({
      key: toKey(d),
      dayOfMonth: d.getDate(),
      month: d.getMonth(),
      label: d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" }),
    });
  }
  return cells;
}

// "Today" / "Tomorrow" / "Mon, Jun 16" for an agenda day heading.
function dayHeading(key: string, todayKey: string): string {
  if (key === todayKey) return "Today";
  if (key === toKey(addDays(new Date(), 1))) return "Tomorrow";
  return new Date(key + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

// Exams sort before assignments on a given day; otherwise by title.
function sortItems(a: AgendaItem, b: AgendaItem): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.kind !== b.kind) return a.kind === "exam" ? -1 : 1;
  return a.title.localeCompare(b.title);
}

function nextStatus(s: AssignmentStatus): AssignmentStatus {
  return s === "todo" ? "doing" : s === "doing" ? "done" : "todo";
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
