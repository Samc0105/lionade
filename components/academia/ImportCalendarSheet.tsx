"use client";

import { useMemo, useState } from "react";
import {
  CalendarPlus, ArrowsClockwise, ArrowRight, ArrowLeft,
  CheckCircle, Circle, WarningCircle, CalendarBlank,
} from "@phosphor-icons/react";
import BottomSheet from "@/components/ui/BottomSheet";
import { apiPost } from "@/lib/api-client";
import { toastSuccess } from "@/lib/toast";

/**
 * ImportCalendarSheet — power-user flow to pull assignment + exam dates from an
 * external calendar feed (.ics) into a Lionade class.
 *
 * Frozen backend contract (POST /api/academia/import-ics):
 *   PREVIEW: { url } -> { events: [{ title, date }], count, truncated }  (400 + safe msg on bad/blocked URL)
 *   COMMIT:  { classId, events: [{ title, date }] } -> { created }
 *
 * Steps: paste -> previewing -> (preview-error | preview-ready) -> committing -> done.
 * Reuses BottomSheet (slide-up glass, esc/swipe/scrim close, reduced-motion safe).
 * Matches the Academia hub's dark/glassmorphism + font-bebas treatment. No em-dashes.
 */

interface ImportClass {
  id: string;
  name: string;
  color: string;
  emoji: string | null;
}

interface PreviewEvent {
  title: string;
  date: string; // YYYY-MM-DD
}

interface PreviewResponse {
  events: PreviewEvent[];
  count: number;
  truncated: boolean;
}

type Phase =
  | "paste"
  | "previewing"
  | "preview-error"
  | "preview-ready"
  | "committing";

export default function ImportCalendarSheet({
  open,
  onClose,
  classes,
  onImported,
}: {
  open: boolean;
  onClose: () => void;
  classes: ImportClass[];
  /** Called after a successful commit so the caller can refresh the agenda SWR keys. */
  onImported: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("paste");
  const [url, setUrl] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [events, setEvents] = useState<PreviewEvent[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  // Preselect the only class when there's exactly one.
  const [classId, setClassId] = useState<string | null>(
    classes.length === 1 ? classes[0].id : null,
  );

  const selectedClass = useMemo(
    () => classes.find(c => c.id === classId) ?? null,
    [classes, classId],
  );

  const selectedCount = selected.size;
  const canImport = selectedCount > 0 && classId !== null && phase === "preview-ready";

  // Full reset to the paste step. Called on close and on "try a different link".
  function reset() {
    setPhase("paste");
    setUrl("");
    setErrorMsg(null);
    setEvents([]);
    setTruncated(false);
    setSelected(new Set());
    setClassId(classes.length === 1 ? classes[0].id : null);
  }

  function handleClose() {
    // Never strand a half-finished flow: a fresh open starts clean.
    reset();
    onClose();
  }

  async function runPreview() {
    const trimmed = url.trim();
    if (!trimmed) {
      setErrorMsg("Paste a calendar feed link first.");
      setPhase("preview-error");
      return;
    }
    setPhase("previewing");
    setErrorMsg(null);
    try {
      const r = await apiPost<PreviewResponse>("/api/academia/import-ics", { url: trimmed });
      if (!r.ok || !r.data) {
        setErrorMsg(r.error || "We couldn't read that feed. Check the link and try again.");
        setPhase("preview-error");
        return;
      }
      const parsed = r.data.events ?? [];
      setEvents(parsed);
      setTruncated(Boolean(r.data.truncated));
      // All events on by default.
      setSelected(new Set(parsed.map((_, i) => i)));
      setPhase("preview-ready");
    } catch (e) {
      console.error("[academia:import-ics] preview threw", e);
      setErrorMsg("Network's being weird. Try again.");
      setPhase("preview-error");
    }
  }

  async function runCommit() {
    if (!canImport || !classId) return;
    const payload = events.filter((_, i) => selected.has(i));
    setPhase("committing");
    try {
      const r = await apiPost<{ created: number }>("/api/academia/import-ics", {
        classId,
        events: payload,
      });
      if (!r.ok || !r.data) {
        setErrorMsg(r.error || "Couldn't import those events. Try again.");
        setPhase("preview-ready");
        return;
      }
      const created = r.data.created ?? payload.length;
      toastSuccess(`Imported ${created} ${created === 1 ? "event" : "events"}`);
      onImported();
      handleClose();
    } catch (e) {
      console.error("[academia:import-ics] commit threw", e);
      setErrorMsg("Network's being weird. Try again.");
      setPhase("preview-ready");
    }
  }

  function toggleEvent(i: number) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  function toggleAll() {
    setSelected(prev => (prev.size === events.length ? new Set() : new Set(events.map((_, i) => i))));
  }

  return (
    <BottomSheet open={open} onClose={handleClose} ariaLabel="Import calendar">
      {/* Eyebrow + heading */}
      <div className="flex items-center gap-2 mb-2.5">
        <span className="inline-block w-5 h-px bg-gold/70" aria-hidden="true" />
        <CalendarPlus size={13} className="text-gold" weight="fill" />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.32em] text-gold">
          Import calendar
        </span>
      </div>

      {(phase === "paste" || phase === "previewing" || phase === "preview-error") && (
        <PasteStep
          phase={phase}
          url={url}
          errorMsg={errorMsg}
          onUrlChange={setUrl}
          onPreview={runPreview}
        />
      )}

      {(phase === "preview-ready" || phase === "committing") && (
        <PreviewStep
          events={events}
          truncated={truncated}
          selected={selected}
          selectedCount={selectedCount}
          classes={classes}
          classId={classId}
          selectedClass={selectedClass}
          committing={phase === "committing"}
          canImport={canImport}
          errorMsg={errorMsg}
          onToggleEvent={toggleEvent}
          onToggleAll={toggleAll}
          onSelectClass={setClassId}
          onBack={reset}
          onCommit={runCommit}
        />
      )}
    </BottomSheet>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 1 — paste a feed URL.
// ─────────────────────────────────────────────────────────────────────────────
function PasteStep({
  phase, url, errorMsg, onUrlChange, onPreview,
}: {
  phase: "paste" | "previewing" | "preview-error";
  url: string;
  errorMsg: string | null;
  onUrlChange: (v: string) => void;
  onPreview: () => void;
}) {
  const busy = phase === "previewing";

  return (
    <div>
      <h3 className="font-bebas text-[30px] tracking-wider text-cream leading-[0.95] mb-2">
        pull in your dates
      </h3>
      <p className="text-[13px] text-cream/65 leading-relaxed mb-1.5">
        Paste your calendar feed URL from Canvas, Google Calendar, Outlook, or Apple Calendar.
        We import the assignment and exam dates.
      </p>
      <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-cream/40 mb-5">
        In Canvas: Calendar then Calendar Feed, copy the link.
      </p>

      <label className="block mb-2">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/50 mb-1.5">
          Feed URL
        </span>
        <input
          autoFocus
          type="url"
          inputMode="url"
          value={url}
          onChange={e => onUrlChange(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !busy) onPreview(); }}
          placeholder="https://your-school.instructure.com/feeds/calendars/..."
          disabled={busy}
          className="w-full rounded-md bg-white/[0.04] border border-white/[0.1] px-3 py-2.5 text-[13px] text-cream placeholder:text-cream/30 focus:outline-none focus:border-gold/60 disabled:opacity-60"
        />
      </label>

      {phase === "preview-error" && errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2.5 mb-3">
          <WarningCircle size={15} weight="fill" className="text-red-300 shrink-0 mt-0.5" />
          <p className="font-syne text-[12.5px] text-red-200 leading-snug">
            {errorMsg} Try a different link.
          </p>
        </div>
      )}

      <div className="flex justify-end mt-4">
        <button
          type="button"
          onClick={onPreview}
          disabled={busy || url.trim().length === 0}
          className="inline-flex items-center gap-2 rounded-full bg-gold text-navy disabled:opacity-50 disabled:cursor-not-allowed
            font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5 hover:bg-gold/90 transition-colors"
        >
          {busy ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-navy/40 border-t-navy animate-spin" />
              Reading feed
            </>
          ) : (
            <>
              <ArrowsClockwise size={12} weight="bold" /> Preview
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Step 2/3 — review parsed events, pick a class, commit.
// ─────────────────────────────────────────────────────────────────────────────
function PreviewStep({
  events, truncated, selected, selectedCount, classes, classId, selectedClass,
  committing, canImport, errorMsg, onToggleEvent, onToggleAll, onSelectClass, onBack, onCommit,
}: {
  events: PreviewEvent[];
  truncated: boolean;
  selected: Set<number>;
  selectedCount: number;
  classes: ImportClass[];
  classId: string | null;
  selectedClass: ImportClass | null;
  committing: boolean;
  canImport: boolean;
  errorMsg: string | null;
  onToggleEvent: (i: number) => void;
  onToggleAll: () => void;
  onSelectClass: (id: string) => void;
  onBack: () => void;
  onCommit: () => void;
}) {
  // Empty parse result.
  if (events.length === 0) {
    return (
      <div>
        <h3 className="font-bebas text-[30px] tracking-wider text-cream leading-[0.95] mb-2">
          nothing to import
        </h3>
        <div className="rounded-[14px] border border-dashed border-white/[0.08] bg-white/[0.02] p-6 text-center mb-4">
          <CalendarBlank size={22} className="text-gold/60 mx-auto mb-2" />
          <p className="text-[12.5px] text-cream/60 leading-snug">
            No upcoming dates found in that feed.
          </p>
        </div>
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-cream/70 hover:text-cream px-3 py-2 transition-colors"
          >
            <ArrowLeft size={12} weight="bold" /> Try another link
          </button>
        </div>
      </div>
    );
  }

  const allOn = selectedCount === events.length;

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h3 className="font-bebas text-[30px] tracking-wider text-cream leading-[0.95]">
          review what we found
        </h3>
        <button
          type="button"
          onClick={onToggleAll}
          disabled={committing}
          className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/55 hover:text-gold transition-colors shrink-0 disabled:opacity-50"
        >
          {allOn ? "Clear all" : "Select all"}
        </button>
      </div>
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-4">
        {selectedCount} of {events.length} selected
        {truncated ? " · Showing first 200" : ""}
      </p>

      {/* Class selector — imported events attach to one class. */}
      <div className="mb-4">
        <span className="block font-mono text-[9.5px] uppercase tracking-[0.25em] text-cream/50 mb-2">
          Add to class
        </span>
        <div className="flex flex-wrap gap-2">
          {classes.map(c => {
            const active = c.id === classId;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelectClass(c.id)}
                disabled={committing}
                aria-pressed={active}
                className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 transition-colors disabled:opacity-50"
                style={{
                  borderColor: active ? `${c.color}80` : "rgba(255,255,255,0.1)",
                  backgroundColor: active ? `${c.color}1f` : "rgba(255,255,255,0.02)",
                }}
              >
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
                  style={{ background: c.color, opacity: active ? 1 : 0.55 }}
                  aria-hidden="true"
                />
                {c.emoji && <span className="text-[12px]" aria-hidden="true">{c.emoji}</span>}
                <span
                  className="font-mono text-[10px] uppercase tracking-[0.14em] truncate max-w-[140px]"
                  style={{ color: active ? c.color : "rgba(238,244,255,0.7)" }}
                >
                  {c.name}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Event list */}
      <div className="space-y-1.5 max-h-[38vh] overflow-y-auto -mx-1 px-1 mb-1">
        {events.map((ev, i) => {
          const on = selected.has(i);
          return (
            <button
              key={`${ev.date}-${ev.title}-${i}`}
              type="button"
              onClick={() => onToggleEvent(i)}
              disabled={committing}
              aria-pressed={on}
              className={`w-full flex items-center gap-3 rounded-[10px] border px-3 py-2.5 text-left transition-colors disabled:opacity-50
                ${on
                  ? "border-gold/35 bg-gold/[0.06]"
                  : "border-white/[0.07] bg-white/[0.02] hover:bg-white/[0.04]"}`}
            >
              {on
                ? <CheckCircle size={17} weight="fill" className="text-gold shrink-0" />
                : <Circle size={17} weight="bold" className="text-cream/35 shrink-0" />}
              <span className="font-mono text-[10px] tabular-nums text-cream/55 shrink-0 w-[58px]">
                {formatDate(ev.date)}
              </span>
              <span className={`font-syne text-[13px] leading-tight truncate ${on ? "text-cream" : "text-cream/65"}`}>
                {ev.title}
              </span>
            </button>
          );
        })}
      </div>

      {errorMsg && (
        <div className="flex items-start gap-2 rounded-md border border-red-400/30 bg-red-400/5 px-3 py-2.5 mt-3">
          <WarningCircle size={15} weight="fill" className="text-red-300 shrink-0 mt-0.5" />
          <p className="font-syne text-[12.5px] text-red-200 leading-snug">{errorMsg}</p>
        </div>
      )}

      <div className="flex items-center justify-between gap-3 mt-4">
        <button
          type="button"
          onClick={onBack}
          disabled={committing}
          className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.22em] text-cream/60 hover:text-cream px-3 py-2 transition-colors disabled:opacity-50"
        >
          <ArrowLeft size={12} weight="bold" /> Different link
        </button>
        <button
          type="button"
          onClick={onCommit}
          disabled={!canImport || committing}
          className="inline-flex items-center gap-2 rounded-full bg-gold text-navy disabled:opacity-50 disabled:cursor-not-allowed
            font-mono text-[11px] uppercase tracking-[0.25em] px-4 py-2.5 hover:bg-gold/90 transition-colors"
        >
          {committing ? (
            <>
              <span className="w-3.5 h-3.5 rounded-full border-2 border-navy/40 border-t-navy animate-spin" />
              Importing
            </>
          ) : (
            <>
              Import {selectedCount} {selectedCount === 1 ? "event" : "events"}
              {selectedClass ? ` to ${shorten(selectedClass.name)}` : ""}
              <ArrowRight size={12} weight="bold" />
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(key: string): string {
  // key is YYYY-MM-DD; render local-safe "Jun 16".
  return new Date(key + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric",
  });
}

function shorten(name: string): string {
  return name.length > 18 ? `${name.slice(0, 17)}…` : name;
}
