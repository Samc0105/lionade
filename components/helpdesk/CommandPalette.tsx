"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MagnifyingGlass,
  X,
  ArrowRight,
  CalendarBlank,
  Lightning,
  Trophy,
  Shuffle,
  Flask,
  Moon,
  GraduationCap,
  Target,
  ChartLineUp,
  Scroll,
  UsersThree,
  BookOpen,
  ChatsCircle,
  Compass,
  Medal,
  type Icon,
} from "@phosphor-icons/react";
import { TRACKS } from "@/lib/helpdesk/tracks";
import { trackIconFor } from "@/components/helpdesk/icons";

// CommandPalette (Idea 35): a keyboard first quick nav for the TechHub hub.
//
// Cmd+K (Mac) or Ctrl+K (Windows, Linux) opens a fuzzy filtered overlay over
// every TechHub destination: each career track, every mode, and the standalone
// pages (achievements, stats, weak spots, exam, class, knowledge base, manager
// 1:1, placement). Arrow keys move the selection, Enter opens it, Escape closes.
//
// Pure navigation. It reads no localStorage and no server state and grants
// nothing, so there is no value to flash and the economy stays server
// authoritative. Web only, mounted once at the hub in app/learn/techhub/page.tsx.
//
// Note on the Cmd+K override: the app shell mounts a global Quick Note Cmd+K
// handler (components/QuickNoteShortcut.tsx) that listens on document in the
// bubble phase. We register on window in the CAPTURE phase and stop propagation
// for Cmd+K, so on the TechHub hub the keystroke opens this palette instead of
// the Quick Note panel. The capture listener fires before the document bubble
// listener, so Quick Note never sees the event here.

type Group = "Track" | "Mode" | "More";

interface Dest {
  id: string;
  label: string;
  hint: string;
  href: string;
  color: string;
  icon: Icon;
  group: Group;
  keywords: string;
}

const GROUP_LABELS: Record<Group, string> = {
  Track: "Career tracks",
  Mode: "Modes",
  More: "More",
};

// Tracks come straight from the same source the hub cards use, so the palette
// can never drift from the live track list.
const TRACK_DESTS: Dest[] = TRACKS.map(
  (t): Dest => ({
    id: `track-${t.id}`,
    label: t.name,
    hint: t.tagline,
    href: `/learn/techhub/${t.id}`,
    color: t.color,
    icon: trackIconFor(t.icon),
    group: "Track",
    keywords: `${t.id} ${t.blurb} track career`,
  }),
);

const MODE_DESTS: Dest[] = [
  {
    id: "mode-combo",
    label: "Daily Combo",
    hint: "Today's mix of tickets and mutators.",
    href: "/learn/techhub/surprise?daily=1",
    color: "#FFD700",
    icon: CalendarBlank,
    group: "Mode",
    keywords: "daily today combo",
  },
  {
    id: "mode-chaos",
    label: "Daily Chaos",
    hint: "Today's brutal stacked gauntlet.",
    href: "/learn/techhub/surprise?daily=1&chaos=1",
    color: "#F87171",
    icon: Lightning,
    group: "Mode",
    keywords: "daily chaos brutal gauntlet stacked",
  },
  {
    id: "mode-weekly",
    label: "Weekly Challenge",
    hint: "This week's shared challenge.",
    href: "/learn/techhub/surprise?weekly=1",
    color: "#C9A2F2",
    icon: Trophy,
    group: "Mode",
    keywords: "weekly week challenge shared",
  },
  {
    id: "mode-surprise",
    label: "Surprise Shift",
    hint: "A fresh draw of tickets and random modifiers.",
    href: "/learn/techhub/surprise",
    color: "#C9A2F2",
    icon: Shuffle,
    group: "Mode",
    keywords: "surprise random shift",
  },
  {
    id: "mode-lab",
    label: "Mutator Lab",
    hint: "Pick the track, size, and modifiers. Save your combos.",
    href: "/learn/techhub/lab",
    color: "#C9A2F2",
    icon: Flask,
    group: "Mode",
    keywords: "mutator lab build custom modifiers",
  },
  {
    id: "mode-nightshift",
    label: "Night Shift",
    hint: "Alone in the SOC. Catch the intruder, survive til 6 AM.",
    href: "/learn/techhub/nightshift",
    color: "#9DB4E0",
    icon: Moon,
    group: "Mode",
    keywords: "night shift soc monitor intruder",
  },
  {
    id: "mode-tutorial",
    label: "Tutorial",
    hint: "Three easy tickets to learn the desk. No clock pressure.",
    href: "/learn/techhub/tutorial",
    color: "#2BBE6B",
    icon: GraduationCap,
    group: "Mode",
    keywords: "tutorial new start learn onboarding",
  },
];

const MORE_DESTS: Dest[] = [
  {
    id: "more-achievements",
    label: "Achievements",
    hint: "Badges and unlocks you have earned across the desk.",
    href: "/learn/techhub/achievements",
    color: "#FFD700",
    icon: Medal,
    group: "More",
    keywords: "achievements badges unlocks trophies",
  },
  {
    id: "more-stats",
    label: "Your Stats",
    hint: "Per track performance, best scores, and weak concepts.",
    href: "/learn/techhub/stats",
    color: "#4A90D9",
    icon: ChartLineUp,
    group: "More",
    keywords: "stats performance dashboard records",
  },
  {
    id: "more-review",
    label: "Weak Spots",
    hint: "Target the concepts you miss most.",
    href: "/learn/techhub/review",
    color: "#C9A2F2",
    icon: Target,
    group: "More",
    keywords: "weak spots review practice",
  },
  {
    id: "more-exam",
    label: "Certification Exam",
    hint: "One timed exam across every track. Earn a certificate.",
    href: "/learn/techhub/exam",
    color: "#FFD700",
    icon: Scroll,
    group: "More",
    keywords: "exam certification certificate test",
  },
  {
    id: "more-class",
    label: "Class Challenge",
    hint: "Set one shift for your class or crew. Share the link.",
    href: "/learn/techhub/class",
    color: "#FFD700",
    icon: UsersThree,
    group: "More",
    keywords: "class challenge teacher classroom team",
  },
  {
    id: "more-kb",
    label: "Knowledge Base",
    hint: "Search every KB article you meet on the desk.",
    href: "/learn/techhub/kb",
    color: "#4A90D9",
    icon: BookOpen,
    group: "More",
    keywords: "knowledge base kb articles study search",
  },
  {
    id: "more-oneonone",
    label: "Manager 1:1",
    hint: "Periodic check ins with goals from your weakest concepts.",
    href: "/learn/techhub/oneonone",
    color: "#FFD700",
    icon: ChatsCircle,
    group: "More",
    keywords: "manager one on one review goals oneonone",
  },
  {
    id: "more-placement",
    label: "Placement Test",
    hint: "Find your starting level before you climb the ladder.",
    href: "/learn/techhub/placement",
    color: "#22D3EE",
    icon: Compass,
    group: "More",
    keywords: "placement test level assessment start",
  },
];

const DESTINATIONS: Dest[] = [...TRACK_DESTS, ...MODE_DESTS, ...MORE_DESTS];

// Lightweight subsequence fuzzy score. Returns a score (higher is better) when
// every character of the query appears in order in the text, otherwise -1.
// Rewards matches at the start of a word and contiguous runs so the closest
// label floats to the top.
function fuzzyScore(query: string, text: string): number {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q.length === 0) return 0;
  let qi = 0;
  let score = 0;
  let run = 0;
  let prev = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      const atWordStart = ti === 0 || t[ti - 1] === " " || t[ti - 1] === "/";
      let pts = 1;
      if (atWordStart) pts += 3;
      if (prev === ti - 1) {
        run += 1;
        pts += run * 2;
      } else {
        run = 0;
      }
      score += pts;
      prev = ti;
      qi += 1;
    }
  }
  return qi === q.length ? score : -1;
}

// Score a destination by the best of its label and its metadata, weighting a
// label hit above a hint or keyword hit so name matches rank first.
function scoreDest(query: string, d: Dest): number {
  const labelScore = fuzzyScore(query, d.label);
  if (labelScore >= 0) return labelScore + 100;
  const metaScore = fuzzyScore(query, `${d.hint} ${d.keywords} ${GROUP_LABELS[d.group]}`);
  return metaScore;
}

export default function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  // Default to "Ctrl" so the server render and first client render agree (no
  // hydration mismatch); swap to the command glyph after mount on a Mac.
  const [modKey, setModKey] = useState("Ctrl");

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const q = query.trim();
  const visible = useMemo<Dest[]>(() => {
    if (!q) return DESTINATIONS;
    return DESTINATIONS.map((d) => ({ d, s: scoreDest(q, d) }))
      .filter((x) => x.s >= 0)
      .sort((a, b) => b.s - a.s)
      .map((x) => x.d);
  }, [q]);

  // Detect the platform once on the client for the keycap hint.
  useEffect(() => {
    const ua = typeof navigator !== "undefined" ? `${navigator.platform} ${navigator.userAgent}` : "";
    if (/Mac|iPhone|iPad|iPod/i.test(ua)) setModKey("⌘");
  }, []);

  // Global Cmd+K / Ctrl+K toggle. Capture phase + stopPropagation so it wins
  // over the app shell's Quick Note handler (which listens on document in the
  // bubble phase) while the hub is mounted.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        e.stopPropagation();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  // On open: reset the search, remember where focus was, lock body scroll, and
  // move focus into the input. On close (cleanup): unlock scroll and restore
  // focus to the trigger, mirroring the dialog a11y pattern in ConfirmModal.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    const restoreTo = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const raf = requestAnimationFrame(() => inputRef.current?.focus());
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.overflow = prevOverflow;
      restoreTo?.focus?.();
    };
  }, [open]);

  // Keep the highlighted row in view as the selection moves. block "nearest"
  // with the default (instant) behavior, so nothing animates under reduced
  // motion.
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  // All in-overlay keys are handled here. Focus stays locked on the input (the
  // options are not tab stops), so Tab is trapped by simply swallowing it.
  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Tab") {
      e.preventDefault();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (visible.length > 0) setActive((a) => (a + 1) % visible.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (visible.length > 0) setActive((a) => (a - 1 + visible.length) % visible.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const dest = visible[active];
      if (dest) go(dest.href);
    }
  };

  return (
    <>
      {/* Hint button. Keyboard first, so it shows on pointer + keyboard sized
          screens (sm and up) and sits bottom left, clear of the global dock at
          bottom right. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open quick navigation"
        aria-keyshortcuts="Meta+K Control+K"
        className="hidden sm:inline-flex fixed bottom-4 left-4 z-40 items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] backdrop-blur-md px-3 py-2 text-cream/60 hover:text-cream hover:bg-white/[0.08] transition-colors"
      >
        <MagnifyingGlass size={14} weight="bold" aria-hidden="true" />
        <span className="font-mono text-[10px] uppercase tracking-[0.15em]">Quick nav</span>
        <span className="flex items-center gap-0.5" aria-hidden="true">
          <kbd className="font-mono text-[9px] not-italic px-1 py-0.5 rounded bg-white/10 text-cream/70 leading-none">{modKey}</kbd>
          <kbd className="font-mono text-[9px] not-italic px-1 py-0.5 rounded bg-white/10 text-cream/70 leading-none">K</kbd>
        </span>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-start justify-center p-4 pt-[12vh] bg-black/70 backdrop-blur-sm animate-fade-in"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="TechHub quick navigation"
            className="w-full max-w-lg rounded-2xl border border-white/[0.1] overflow-hidden animate-slide-up shadow-2xl shadow-black/50"
            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.98), rgba(6,12,24,0.98))" }}
          >
            {/* Search row */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-white/[0.07]">
              <MagnifyingGlass size={18} className="text-cream/40 flex-shrink-0" aria-hidden="true" />
              <input
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={true}
                aria-controls="techhub-cmd-list"
                aria-autocomplete="list"
                aria-activedescendant={visible.length > 0 ? `techhub-cmd-opt-${active}` : undefined}
                aria-label="Search TechHub destinations"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setActive(0);
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Jump to a track, mode, or page..."
                className="flex-1 bg-transparent outline-none text-cream placeholder:text-cream/35 text-sm"
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setOpen(false)}
                aria-label="Close quick navigation"
                className="grid place-items-center w-7 h-7 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.06] flex-shrink-0 transition-colors"
              >
                <X size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>

            {/* Results */}
            <div
              ref={listRef}
              id="techhub-cmd-list"
              role="listbox"
              aria-label="TechHub destinations"
              className="max-h-[55vh] overflow-y-auto py-1"
            >
              {visible.length === 0 ? (
                <div className="px-4 py-10 text-center text-cream/45 text-sm">No matches. Try another word.</div>
              ) : (
                visible.map((d, i) => {
                  const IconCmp = d.icon;
                  const isActive = i === active;
                  const showHeader = !q && (i === 0 || visible[i - 1].group !== d.group);
                  return (
                    <Fragment key={d.id}>
                      {showHeader && (
                        <div className="px-4 pt-3 pb-1 font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40">
                          {GROUP_LABELS[d.group]}
                        </div>
                      )}
                      <button
                        type="button"
                        role="option"
                        id={`techhub-cmd-opt-${i}`}
                        data-idx={i}
                        aria-selected={isActive}
                        tabIndex={-1}
                        onClick={() => go(d.href)}
                        onMouseMove={() => setActive(i)}
                        className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isActive ? "bg-white/[0.07]" : "hover:bg-white/[0.04]"
                        }`}
                        style={{ boxShadow: isActive ? `inset 2px 0 0 ${d.color}` : undefined }}
                      >
                        <span
                          className="flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0"
                          style={{ background: `${d.color}1a`, border: `1px solid ${d.color}40` }}
                        >
                          <IconCmp size={16} weight="fill" color={d.color} aria-hidden="true" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block text-sm text-cream font-semibold truncate">{d.label}</span>
                          <span className="block text-[11px] text-cream/50 truncate">{d.hint}</span>
                        </span>
                        {isActive && <ArrowRight size={14} weight="bold" color={d.color} aria-hidden="true" className="flex-shrink-0" />}
                      </button>
                    </Fragment>
                  );
                })
              )}
            </div>

            {/* Footer hint */}
            <div className="flex items-center gap-3 px-4 py-2 border-t border-white/[0.07] font-mono text-[9px] uppercase tracking-[0.15em] text-cream/35">
              <span>Up Down to move</span>
              <span>Enter to open</span>
              <span>Esc to close</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
