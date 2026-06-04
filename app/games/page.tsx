"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import AmbientOrbs from "@/components/AmbientOrbs";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { apiPost, apiGet } from "@/lib/api-client";
import { useHeartbeat } from "@/lib/use-heartbeat";
import {
  Brain,
  Lightning,
  Target,
  Fire,
  BookOpen,
  Trophy,
  Dna,
  Flask,
  Binoculars,
  Calculator,
  Scroll,
  Globe,
  Bank,
  StarFour,
  Check,
  X as XIcon,
  TextAa,
  Cards,
  Calendar,
  FileText,
  PaintBrush,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

// ── Types ────────────────────────────────────────────────────

type GameMode = "menu" | "roardle" | "flashcards" | "timeline" | "party";
type TabMode = "quickplay" | "library";

interface PdfContent {
  vocabulary: { term: string; definition: string }[];
  facts: { statement: string; isTrue: boolean }[];
  concepts: { question: string; answer: string; options: string[] }[];
  timeline: { event: string; date: string; year: number }[];
  keyTerms: string[];
}

// ── Word Banks ───────────────────────────────────────────────

const WORD_BANK: Record<number, string[]> = {
  4: ["cell","atom","gene","bond","mass","wave","ions","acid","base","mole","volt","flux","dome","rift","core","zinc","iron","fern","seed","root","stem","leaf","bark","soil","sand","clay","rock","lava","wind","rain","tide","moon","mars","star","nova","dark","heat","cold","watt","ohms"],
  5: ["orbit","atoms","genes","cells","force","light","waves","bonds","acids","bases","moles","volts","power","earth","water","plant","fungi","virus","blood","brain","heart","liver","lungs","spine","nerve","lymph","organ","biome","ocean","plate","fault","magma","comet","solar","lunar","ozone","storm","cloud","crust","delta"],
  6: ["carbon","oxygen","neuron","enzyme","plasma","genome","photon","proton","matter","energy","fusion","fision","motion","vector","tensor","quasar","galaxy","system","planet","nature","fossil","embryo","tissue","muscle","immune","mitral","cortex","fungal","biotic","tundra","desert","island","crater","mantle","ionize","charge","radius","prisms"],
};

const FLASHCARD_TERMS = [
  { term: "Photosynthesis", def: "Process by which plants convert light energy into chemical energy (glucose) using CO2 and water" },
  { term: "Mitosis", def: "Cell division that produces two identical daughter cells with the same number of chromosomes" },
  { term: "Osmosis", def: "Movement of water molecules through a semipermeable membrane from low to high solute concentration" },
  { term: "Covalent Bond", def: "Chemical bond formed by the sharing of electron pairs between atoms" },
  { term: "Tectonic Plates", def: "Large segments of Earth's lithosphere that move, float, and interact on the asthenosphere" },
  { term: "Natural Selection", def: "Process where organisms with favorable traits are more likely to survive and reproduce" },
  { term: "Kinetic Energy", def: "Energy possessed by an object due to its motion, calculated as ½mv²" },
  { term: "Ecosystem", def: "Community of living organisms interacting with their physical environment as a system" },
  { term: "Ionic Bond", def: "Chemical bond formed by the transfer of electrons from one atom to another" },
  { term: "Homeostasis", def: "Maintenance of stable internal conditions in an organism despite external changes" },
  { term: "Entropy", def: "Measure of disorder or randomness in a system; tends to increase over time" },
  { term: "Catalyst", def: "Substance that speeds up a chemical reaction without being consumed in the process" },
];

const TIMELINE_EVENTS = [
  { event: "Big Bang", year: -13800000000, date: "13.8 billion years ago" },
  { event: "Earth formed", year: -4500000000, date: "4.5 billion years ago" },
  { event: "First life on Earth", year: -3500000000, date: "3.5 billion years ago" },
  { event: "Dinosaurs appear", year: -230000000, date: "230 million years ago" },
  { event: "Dinosaur extinction", year: -66000000, date: "66 million years ago" },
  { event: "First humans", year: -300000, date: "300,000 years ago" },
  { event: "Newton's Principia", year: 1687, date: "1687" },
  { event: "Discovery of DNA structure", year: 1953, date: "1953" },
];

// ── Daily Limits ─────────────────────────────────────────────

function getDailyPlays(gameType: string): number {
  if (typeof window === "undefined") return 0;
  const key = `lionade_plays_${gameType}_${new Date().toISOString().split("T")[0]}`;
  return parseInt(localStorage.getItem(key) ?? "0");
}

function incrementDailyPlays(gameType: string) {
  if (typeof window === "undefined") return;
  const key = `lionade_plays_${gameType}_${new Date().toISOString().split("T")[0]}`;
  const current = parseInt(localStorage.getItem(key) ?? "0");
  localStorage.setItem(key, String(current + 1));
}

const DAILY_LIMITS: Record<string, number> = { roardle: 3, flashcards: 999, timeline: 3, party: 999 };

// ── Component ────────────────────────────────────────────────

export default function GamesPage() {
  const router = useRouter();
  const { user } = useAuth();

  // Back-compat: ?mode=blitz used to auto-open Blitz from /games. Blitz
  // now lives at /compete/blitz, so forward those links.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (new URLSearchParams(window.location.search).get("mode") === "blitz") {
      router.replace("/compete/blitz");
    }
  }, [router]);
  const { stats, mutate: mutateStats } = useUserStats(user?.id);

  const [tab, setTab] = useState<TabMode>("quickplay");
  const [game, setGame] = useState<GameMode>("menu");
  const [fangsEarned, setFangsEarned] = useState<number | null>(null);

  // PDF state
  const [pdfContent, setPdfContent] = useState<PdfContent | null>(null);
  const [pdfName, setPdfName] = useState<string | null>(null);
  const [pdfProcessing, setPdfProcessing] = useState(false);
  const [pdfError, setPdfError] = useState("");

  // Roardle state
  const [wordLength, setWordLength] = useState(5);
  const [roardleWord, setRoardleWord] = useState("");
  const [roardleGuesses, setRoardleGuesses] = useState<string[]>([]);
  const [roardleInput, setRoardleInput] = useState("");
  const [roardleError, setRoardleError] = useState("");
  const [roardleOver, setRoardleOver] = useState(false);
  const [roardleWon, setRoardleWon] = useState(false);


  // Flashcard state
  const [fcIdx, setFcIdx] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcKnew, setFcKnew] = useState(0);
  const [fcOver, setFcOver] = useState(false);
  const [fcCards, setFcCards] = useState<{ term: string; def: string }[]>([]);

  // Timeline state
  const [tlEvents, setTlEvents] = useState<typeof TIMELINE_EVENTS>([]);
  const [tlOrder, setTlOrder] = useState<number[]>([]);
  const [tlSubmitted, setTlSubmitted] = useState(false);
  const [tlScore, setTlScore] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Tier 3 — refresh-resumable state for Roardle + Timeline. Each game gets
  // its own slot in `quiz_session_state` (game_type='roardle' | 'timeline').
  // We hydrate on mount, autosave on meaningful changes (debounced 500ms),
  // and clear on game-over. Flashcards is intentionally NOT persisted — it's
  // a quick-flip ritual where resume doesn't add value.
  const roardleHydratedRef = useRef(false);
  const timelineHydratedRef = useRef(false);
  const [roardleResume, setRoardleResume] = useState<null | {
    wordLength: number; targetWord: string; guesses: string[];
  }>(null);
  const [timelineResume, setTimelineResume] = useState<null | {
    events: typeof TIMELINE_EVENTS; order: number[];
  }>(null);
  const roardleSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timelineSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Heartbeat — pings while a Roardle or Timeline game is in progress. Uses
  // user-id as the surface id (these games don't have session rows).
  useHeartbeat(
    (game === "roardle" || game === "timeline") && user?.id ? "quiz" : null,
    user?.id ?? null,
  );

  // Hydrate Roardle resume state on mount. We prompt rather than auto-
  // resume because the user might want a fresh word.
  useEffect(() => {
    if (!user || roardleHydratedRef.current) return;
    roardleHydratedRef.current = true;
    (async () => {
      type StateResp = {
        state: { targetWord?: string; guesses?: string[]; wordLength?: number; won?: boolean } | null;
      };
      const r = await apiGet<StateResp>("/api/quiz/state?game_type=roardle");
      const s = r.ok ? r.data?.state : null;
      if (s?.targetWord && Array.isArray(s.guesses) && !s.won && s.guesses.length < 6) {
        setRoardleResume({
          wordLength: s.wordLength ?? s.targetWord.length,
          targetWord: s.targetWord,
          guesses: s.guesses,
        });
      }
    })();
  }, [user]);

  // Hydrate Timeline resume state on mount.
  useEffect(() => {
    if (!user || timelineHydratedRef.current) return;
    timelineHydratedRef.current = true;
    (async () => {
      type StateResp = {
        state: { events?: typeof TIMELINE_EVENTS; order?: number[]; correctlyPlacedCount?: number } | null;
      };
      const r = await apiGet<StateResp>("/api/quiz/state?game_type=timeline");
      const s = r.ok ? r.data?.state : null;
      if (s?.events && s.events.length > 0 && Array.isArray(s.order)) {
        setTimelineResume({ events: s.events, order: s.order });
      }
    })();
  }, [user]);

  // Autosave Roardle while a round is live.
  useEffect(() => {
    if (game !== "roardle" || !roardleWord || roardleOver) return;
    if (roardleSaveTimerRef.current) clearTimeout(roardleSaveTimerRef.current);
    roardleSaveTimerRef.current = setTimeout(() => {
      void apiPost("/api/quiz/state", {
        game_type: "roardle",
        state: {
          wordLength,
          targetWord: roardleWord,
          guesses: roardleGuesses,
          won: roardleWon,
        },
      });
    }, 500);
    return () => {
      if (roardleSaveTimerRef.current) clearTimeout(roardleSaveTimerRef.current);
    };
  }, [game, roardleWord, roardleGuesses, roardleOver, roardleWon, wordLength]);

  // Autosave Timeline while a round is live (unsubmitted).
  useEffect(() => {
    if (game !== "timeline" || tlEvents.length === 0 || tlSubmitted) return;
    if (timelineSaveTimerRef.current) clearTimeout(timelineSaveTimerRef.current);
    timelineSaveTimerRef.current = setTimeout(() => {
      void apiPost("/api/quiz/state", {
        game_type: "timeline",
        state: {
          events: tlEvents,
          order: tlOrder,
          correctlyPlacedCount: 0,  // computed only at submit time
        },
      });
    }, 500);
    return () => {
      if (timelineSaveTimerRef.current) clearTimeout(timelineSaveTimerRef.current);
    };
  }, [game, tlEvents, tlOrder, tlSubmitted]);

  // Clear Roardle state row when a round ends (win or out-of-guesses).
  useEffect(() => {
    if (game === "roardle" && roardleOver) {
      void apiPost("/api/quiz/state", { game_type: "roardle", state: null });
    }
  }, [game, roardleOver]);

  // Clear Timeline state row on submit.
  useEffect(() => {
    if (game === "timeline" && tlSubmitted) {
      void apiPost("/api/quiz/state", { game_type: "timeline", state: null });
    }
  }, [game, tlSubmitted]);

  // Load PDF + blitz best from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("lionade_pdf_content");
      const name = localStorage.getItem("lionade_pdf_name");
      if (saved && name) {
        setPdfContent(JSON.parse(saved));
        setPdfName(name);
      }
    } catch { /* ignore */ }
  }, []);

  // ── Award Fangs ────────────────────────────────────────────
  const awardFangs = useCallback(async (amount: number, gameType: string) => {
    if (!user?.id || amount <= 0) return;
    setFangsEarned(amount);
    await apiPost("/api/games/reward", { amount, gameType });
    mutateUserStats(user.id);
    mutateStats?.();
  }, [user?.id, mutateStats]);

  // ── PDF Upload ─────────────────────────────────────────────
  const handlePdfUpload = useCallback(async (file: File) => {
    if (!file.name.endsWith(".pdf")) { setPdfError("Only PDF files accepted"); return; }
    if (file.size > 10 * 1024 * 1024) { setPdfError("Max file size is 10MB"); return; }

    setPdfProcessing(true);
    setPdfError("");

    try {
      // Extract text using FileReader
      const arrayBuffer = await file.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      let text = "";
      const decoder = new TextDecoder("utf-8", { fatal: false });
      const raw = decoder.decode(uint8);

      const textMatches = raw.match(/\(([^)]{2,})\)/g);
      if (textMatches) {
        text = textMatches.map(m => m.slice(1, -1)).join(" ");
      }
      if (text.length < 100) {
        text = raw.replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ").trim();
      }

      if (text.length < 50) {
        setPdfError("Could not extract enough text from PDF. Try a text-based PDF.");
        setPdfProcessing(false);
        return;
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res = await apiPost<{ content?: any }>("/api/games/pdf", {
        text: text.slice(0, 12000),
      });
      if (!res.ok) {
        setPdfError(res.error ?? "Failed to process PDF");
      } else if (res.data?.content) {
        setPdfContent(res.data.content);
        setPdfName(file.name);
        localStorage.setItem("lionade_pdf_content", JSON.stringify(res.data.content));
        localStorage.setItem("lionade_pdf_name", file.name);
      }
    } catch {
      setPdfError("Failed to process PDF");
    }
    setPdfProcessing(false);
  }, []);

  // ── Start Roardle ──────────────────────────────────────────
  const startRoardle = useCallback(() => {
    const source = tab === "library" && pdfContent?.keyTerms?.length
      ? pdfContent.keyTerms.filter(w => w.length === wordLength)
      : WORD_BANK[wordLength] ?? WORD_BANK[5];

    if (source.length === 0) { return; }
    const word = source[Math.floor(Math.random() * source.length)].toUpperCase();
    setRoardleWord(word);
    setRoardleGuesses([]);
    setRoardleInput("");
    setRoardleOver(false);
    setRoardleWon(false);
    setFangsEarned(null);
    setGame("roardle");
    incrementDailyPlays("roardle");
  }, [tab, pdfContent, wordLength]);

  const submitRoardleGuess = useCallback(() => {
    const guess = roardleInput.toUpperCase().trim();
    if (guess.length !== wordLength || roardleOver) return;

    // Validate against the word bank — only real study words are accepted
    const validWords = new Set(
      (WORD_BANK[wordLength] ?? []).map((w) => w.toUpperCase()),
    );
    if (!validWords.has(guess)) {
      setRoardleError("Not in word list");
      setTimeout(() => setRoardleError(""), 1500);
      return;
    }

    setRoardleError("");
    const newGuesses = [...roardleGuesses, guess];
    setRoardleGuesses(newGuesses);
    setRoardleInput("");

    if (guess === roardleWord) {
      setRoardleWon(true);
      setRoardleOver(true);
      const baseFangs = wordLength === 4 ? 10 : wordLength === 5 ? 15 : 20;
      const bonus = Math.max(0, (6 - newGuesses.length) * 3);
      awardFangs(baseFangs + bonus, "roardle");
    } else if (newGuesses.length >= 6) {
      setRoardleOver(true);
    }
  }, [roardleInput, wordLength, roardleOver, roardleGuesses, roardleWord, awardFangs]);

  // ── Physical keyboard input for Roardle ────────────────────
  // Lets the player type with their computer keyboard while Roardle is the
  // active game and the round isn't over. Stays scoped: ignores modifier
  // combos (Cmd/Ctrl/Alt/Meta shortcuts), ignores keystrokes aimed at a
  // text field/editable, and tears down on unmount or when leaving the game.
  useEffect(() => {
    if (game !== "roardle" || roardleOver) return;
    const handler = (e: KeyboardEvent) => {
      // Don't hijack browser/OS shortcuts.
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      // Don't steal keys while typing in an input/textarea/contentEditable.
      const t = e.target as HTMLElement | null;
      if (t) {
        const tag = t.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable) return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        submitRoardleGuess();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        setRoardleInput(prev => prev.slice(0, -1));
      } else if (/^[a-zA-Z]$/.test(e.key)) {
        e.preventDefault();
        setRoardleInput(prev => (prev.length < wordLength ? prev + e.key.toUpperCase() : prev));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [game, roardleOver, wordLength, submitRoardleGuess]);

  // ── Start Flashcards ───────────────────────────────────────
  const startFlashcards = useCallback(() => {
    const source = tab === "library" && pdfContent?.vocabulary?.length
      ? pdfContent.vocabulary.map(v => ({ term: v.term, def: v.definition }))
      : [...FLASHCARD_TERMS];

    setFcCards(source.sort(() => Math.random() - 0.5).slice(0, 12));
    setFcIdx(0);
    setFcFlipped(false);
    setFcKnew(0);
    setFcOver(false);
    setFangsEarned(null);
    setGame("flashcards");
  }, [tab, pdfContent]);

  const fcAnswer = useCallback((knew: boolean) => {
    if (knew) setFcKnew(k => k + 1);
    setFcFlipped(false);

    if (fcIdx + 1 < fcCards.length) {
      setTimeout(() => setFcIdx(i => i + 1), 200);
    } else {
      setFcOver(true);
      const pct = (fcKnew + (knew ? 1 : 0)) / fcCards.length;
      const fangs = Math.round(pct * 15);
      if (fangs > 0) awardFangs(fangs, "flashcards");
    }
  }, [fcIdx, fcCards, fcKnew, awardFangs]);

  // ── Start Timeline ─────────────────────────────────────────
  const startTimeline = useCallback(() => {
    const source = tab === "library" && pdfContent?.timeline?.length
      ? pdfContent.timeline
      : [...TIMELINE_EVENTS];

    const events = source.sort(() => Math.random() - 0.5).slice(0, 6);
    setTlEvents(events);
    setTlOrder(events.map((_, i) => i));
    setTlSubmitted(false);
    setTlScore(0);
    setFangsEarned(null);
    setGame("timeline");
    incrementDailyPlays("timeline");
  }, [tab, pdfContent]);

  const submitTimeline = useCallback(() => {
    const sorted = [...tlEvents].sort((a, b) => a.year - b.year);
    let correct = 0;
    tlOrder.forEach((orderIdx, pos) => {
      if (tlEvents[orderIdx].year === sorted[pos].year) correct++;
    });
    setTlScore(correct);
    setTlSubmitted(true);
    if (correct > 0) awardFangs(correct * 3, "timeline");
  }, [tlEvents, tlOrder, awardFangs]);

  const moveTimelineItem = useCallback((from: number, to: number) => {
    setTlOrder(prev => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
  }, []);

  // ── Back to menu ───────────────────────────────────────────
  const backToMenu = useCallback(() => {
    setGame("menu");
    setFangsEarned(null);
  }, []);

  // ── Letter feedback for Roardle ────────────────────────────
  // Standard Wordle scoring with correct duplicate-letter handling:
  // two passes: color greens (correct position) first, then allocate
  // yellows only up to the count of each letter remaining in the answer
  // after greens are accounted for. Surplus duplicate guesses go gray.
  // The naive "target.includes(letter)" check is wrong for duplicates.
  function getRowStatuses(guess: string, target: string): ("correct" | "present" | "absent")[] {
    const n = guess.length;
    const result: ("correct" | "present" | "absent")[] = new Array(n).fill("absent");
    // Count how many of each letter remain available in the target.
    const remaining: Record<string, number> = {};
    for (const ch of target) remaining[ch] = (remaining[ch] ?? 0) + 1;
    // Pass 1: greens consume their letter from the pool.
    for (let i = 0; i < n; i++) {
      if (guess[i] === target[i]) {
        result[i] = "correct";
        remaining[guess[i]] -= 1;
      }
    }
    // Pass 2: yellows only while the letter still has remaining count.
    for (let i = 0; i < n; i++) {
      if (result[i] === "correct") continue;
      const ch = guess[i];
      if ((remaining[ch] ?? 0) > 0) {
        result[i] = "present";
        remaining[ch] -= 1;
      }
    }
    return result;
  }

  function getKeyboardStatus(): Record<string, "correct" | "present" | "absent" | "unused"> {
    const map: Record<string, "correct" | "present" | "absent" | "unused"> = {};
    "QWERTYUIOPASDFGHJKLZXCVBNM".split("").forEach(l => map[l] = "unused");
    for (const guess of roardleGuesses) {
      const statuses = getRowStatuses(guess, roardleWord);
      for (let i = 0; i < guess.length; i++) {
        const s = statuses[i];
        // A key shows its best-known state: green > yellow > gray > unused.
        if (s === "correct") map[guess[i]] = "correct";
        else if (s === "present" && map[guess[i]] !== "correct") map[guess[i]] = "present";
        else if (s === "absent" && map[guess[i]] === "unused") map[guess[i]] = "absent";
      }
    }
    return map;
  }

  const tileColor = (status: string) => {
    if (status === "correct") return "var(--game-correct, #22C55E)";
    if (status === "present") return "var(--game-present, #EAB308)";
    return "var(--game-absent, rgba(255,255,255,0.1))";
  };

  // ══════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════

  // ── ROARDLE ─────────────────────────────────────────────
  if (game === "roardle") {
    const kbStatus = getKeyboardStatus();
    const kbRows = ["QWERTYUIOP", "ASDFGHJKL", "ZXCVBNM"];

    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <button onClick={backToMenu} className="text-cream/40 text-sm mb-4 hover:text-cream/60 transition">← Back</button>
            <h2 className="font-bebas text-4xl text-cream tracking-wider text-center mb-1">ROARDLE</h2>
            <p className="text-cream/30 text-xs text-center mb-2">{wordLength} letters · {6 - roardleGuesses.length} guesses left</p>
            {roardleError && (
              <p className="text-red-400 text-xs text-center mb-2 animate-slide-up font-syne font-semibold">
                {roardleError}
              </p>
            )}

            {/* Grid */}
            <div className="space-y-2 mb-6">
              {Array.from({ length: 6 }).map((_, row) => {
                const guess = roardleGuesses[row] ?? "";
                const isCurrentRow = row === roardleGuesses.length && !roardleOver;
                // Score the whole row once (duplicate-aware) rather than per cell.
                const rowStatuses = guess ? getRowStatuses(guess, roardleWord) : null;
                return (
                  <div key={row} className="flex justify-center gap-1.5">
                    {Array.from({ length: wordLength }).map((_, col) => {
                      const letter = isCurrentRow ? (roardleInput[col] ?? "") : (guess[col] ?? "");
                      const status = rowStatuses ? rowStatuses[col] : null;
                      // Non-color cue so feedback is not color-only (a11y).
                      const cue = status === "correct" ? "correct position" : status === "present" ? "wrong position" : status === "absent" ? "not in word" : "";
                      return (
                        <div key={col}
                          aria-label={status ? `${letter || "blank"}, ${cue}` : undefined}
                          className="relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center font-bebas text-2xl rounded-lg border transition-all duration-300"
                          style={{
                            background: status ? tileColor(status) : "var(--game-tile-bg, rgba(255,255,255,0.05))",
                            borderColor: status ? "transparent" : isCurrentRow && roardleInput[col] ? "var(--game-tile-active, rgba(255,255,255,0.3))" : "var(--game-tile-border, rgba(255,255,255,0.1))",
                            color: status ? "#fff" : "var(--game-tile-text, #EEF4FF)",
                          }}>
                          {letter}
                          {status && (
                            <span aria-hidden className="absolute bottom-0.5 right-1 text-[9px] leading-none font-syne opacity-80">
                              {status === "correct" ? "●" : status === "present" ? "◐" : "○"}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            {/* Result */}
            {roardleOver && (
              <div className="text-center mb-6 animate-slide-up">
                <p className="font-bebas text-2xl" style={{ color: roardleWon ? "#22C55E" : "#EF4444" }}>
                  {roardleWon ? "NICE!" : `The word was ${roardleWord}`}
                </p>
                {fangsEarned !== null && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                  </div>
                )}
                <button onClick={backToMenu} className="mt-4 btn-gold px-6 py-2 rounded-lg text-sm">Play Again</button>
              </div>
            )}

            {/* Keyboard */}
            <div className="space-y-1.5">
              {kbRows.map((row, ri) => (
                <div key={ri} className="flex justify-center gap-1">
                  {ri === 2 && (
                    <button onClick={submitRoardleGuess}
                      className="px-3 py-3 rounded-lg text-xs font-bold"
                      style={{ background: "var(--game-key-bg, rgba(255,255,255,0.1))", color: "var(--game-key-text, #EEF4FF)" }}>
                      ENTER
                    </button>
                  )}
                  {row.split("").map(key => {
                    const s = kbStatus[key];
                    return (
                      <button key={key}
                        onClick={() => { if (roardleInput.length < wordLength && !roardleOver) setRoardleInput(prev => prev + key); }}
                        className="w-8 h-10 sm:w-9 sm:h-11 rounded-lg font-bebas text-sm transition-all"
                        style={{
                          background: s === "correct" ? "#22C55E" : s === "present" ? "#EAB308" : s === "absent" ? "rgba(255,255,255,0.05)" : "var(--game-key-bg, rgba(255,255,255,0.1))",
                          color: s && s !== "unused" ? "#fff" : "var(--game-key-text, #EEF4FF)",
                        }}>
                        {key}
                      </button>
                    );
                  })}
                  {ri === 2 && (
                    <button onClick={() => setRoardleInput(prev => prev.slice(0, -1))}
                      className="px-3 py-3 rounded-lg text-xs font-bold"
                      style={{ background: "var(--game-key-bg, rgba(255,255,255,0.1))", color: "var(--game-key-text, #EEF4FF)" }}>
                      ⌫
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ── FLASH CARDS ─────────────────────────────────────────
  if (game === "flashcards") {
    const card = fcCards[fcIdx];
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <button onClick={backToMenu} className="text-cream/40 text-sm mb-4 hover:text-cream/60 transition">← Back</button>

            {!fcOver ? (
              <>
                <p className="text-cream/30 text-xs text-center mb-6">{fcIdx + 1} / {fcCards.length}</p>

                {/* Card */}
                <div onClick={() => setFcFlipped(!fcFlipped)}
                  className="relative w-full aspect-[3/2] rounded-2xl cursor-pointer mb-6 transition-transform duration-500"
                  style={{ perspective: "1000px" }}>
                  <div className="w-full h-full relative" style={{
                    transformStyle: "preserve-3d",
                    transition: "transform 0.5s",
                    transform: fcFlipped ? "rotateY(180deg)" : "rotateY(0deg)",
                  }}>
                    {/* Front */}
                    <div className="absolute inset-0 flex items-center justify-center p-6 rounded-2xl"
                      style={{
                        backfaceVisibility: "hidden",
                        background: "var(--game-card-bg, linear-gradient(135deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.02) 100%))",
                        border: "1px solid var(--game-card-border, rgba(255,255,255,0.1))",
                      }}>
                      <p className="font-bebas text-3xl text-cream tracking-wider text-center">{card?.term}</p>
                    </div>
                    {/* Back */}
                    <div className="absolute inset-0 flex items-center justify-center p-6 rounded-2xl"
                      style={{
                        backfaceVisibility: "hidden",
                        transform: "rotateY(180deg)",
                        background: "var(--game-card-bg, linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(74,144,217,0.02) 100%))",
                        border: "1px solid rgba(74,144,217,0.2)",
                      }}>
                      <p className="text-cream text-sm leading-relaxed text-center">{card?.def}</p>
                    </div>
                  </div>
                </div>

                <p className="text-cream/20 text-xs text-center mb-4">{fcFlipped ? "Did you know it?" : "Tap to flip"}</p>

                {fcFlipped && (
                  <div className="flex gap-3">
                    <button onClick={() => fcAnswer(false)} className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                      style={{ background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.25)", color: "#EF4444" }}>
                      Didn&apos;t Know
                    </button>
                    <button onClick={() => fcAnswer(true)} className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                      style={{ background: "rgba(34,197,94,0.1)", border: "1px solid rgba(34,197,94,0.25)", color: "#22C55E" }}>
                      Knew It!
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center animate-slide-up">
                <h2 className="font-bebas text-4xl text-cream tracking-wider mb-2">COMPLETE!</h2>
                <p className="font-bebas text-6xl text-gold mb-1">{Math.round((fcKnew / fcCards.length) * 100)}%</p>
                <p className="text-cream/40 text-sm mb-4">{fcKnew} / {fcCards.length} known</p>
                {fangsEarned !== null && (
                  <div className="flex items-center justify-center gap-1.5 mb-6">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                  </div>
                )}
                <button onClick={backToMenu} className="btn-gold px-6 py-2 rounded-lg text-sm">Back to Games</button>
              </div>
            )}
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ── TIMELINE DROP ───────────────────────────────────────
  if (game === "timeline") {
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <button onClick={backToMenu} className="text-cream/40 text-sm mb-4 hover:text-cream/60 transition">← Back</button>
            <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-1">TIMELINE DROP</h2>
            <p className="text-cream/30 text-xs text-center mb-6">Drag events into chronological order (earliest first)</p>

            <div className="space-y-2 mb-6">
              {tlOrder.map((eventIdx, pos) => {
                const ev = tlEvents[eventIdx];
                const isCorrect = tlSubmitted && ev.year === [...tlEvents].sort((a, b) => a.year - b.year)[pos]?.year;
                return (
                  <div
                    key={eventIdx}
                    draggable={!tlSubmitted}
                    onDragStart={() => setDragIdx(pos)}
                    onDragOver={e => e.preventDefault()}
                    onDrop={() => { if (dragIdx !== null && dragIdx !== pos) moveTimelineItem(dragIdx, pos); setDragIdx(null); }}
                    className="flex items-center gap-3 p-3 rounded-xl cursor-grab active:cursor-grabbing transition-all"
                    style={{
                      background: tlSubmitted
                        ? isCorrect ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"
                        : "var(--game-card-bg, rgba(255,255,255,0.04))",
                      border: `1px solid ${tlSubmitted ? (isCorrect ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)") : "var(--game-card-border, rgba(255,255,255,0.08))"}`,
                    }}>
                    <span className="font-bebas text-lg text-cream/30 w-6">{pos + 1}</span>
                    <div className="flex-1">
                      <p className="text-cream text-sm font-semibold">{ev.event}</p>
                      {tlSubmitted && <p className="text-cream/40 text-xs mt-0.5">{ev.date}</p>}
                    </div>
                    {tlSubmitted && (
                      <span className="text-lg flex items-center">
                        {isCorrect ? (
                          <Check size={20} weight="bold" aria-hidden="true" />
                        ) : (
                          <XIcon size={20} weight="bold" aria-hidden="true" />
                        )}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>

            {!tlSubmitted ? (
              <button onClick={submitTimeline} className="btn-gold w-full py-3 rounded-xl text-sm">Submit Order</button>
            ) : (
              <div className="text-center animate-slide-up">
                <p className="font-bebas text-2xl text-cream mb-1">{tlScore} / {tlEvents.length} correct</p>
                {fangsEarned !== null && (
                  <div className="flex items-center justify-center gap-1.5 mb-4">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                  </div>
                )}
                <button onClick={backToMenu} className="btn-gold px-6 py-2 rounded-lg text-sm">Back to Games</button>
              </div>
            )}
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ══════════════════════════════════════════════════════════
  // MENU
  // ══════════════════════════════════════════════════════════

  const GAMES: { id: GameMode; name: string; Icon: PhosphorIcon; desc: string; fangs: string; limit: number; start: () => void; color: string; pos: string }[] = [
    { id: "roardle" as GameMode, name: "ROARDLE", Icon: TextAa, desc: "Guess the science word", fangs: `${wordLength === 4 ? 10 : wordLength === 5 ? 15 : 20}+`, limit: DAILY_LIMITS.roardle, start: startRoardle, color: "#00BFFF", pos: "top-0 left-0" },
    { id: "party" as GameMode, name: "LIONADE PARTY", Icon: PaintBrush, desc: "Sketch + Bluff with friends", fangs: "—", limit: DAILY_LIMITS.party, start: () => router.push("/games/party"), color: "#EC4899", pos: "top-0 right-0" },
    { id: "flashcards" as GameMode, name: "FLASH CARDS", Icon: Cards, desc: "Flip, learn, repeat", fangs: "15", limit: DAILY_LIMITS.flashcards, start: startFlashcards, color: "#9B59B6", pos: "bottom-0 left-0" },
    { id: "timeline" as GameMode, name: "TIMELINE DROP", Icon: Calendar, desc: "Order events in time", fangs: "3×", limit: DAILY_LIMITS.timeline, start: startTimeline, color: "#00C851", pos: "bottom-0 right-0" },
  ];

  // Helper to build rgba from hex
  const hexToRgba = (hex: string, a: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  // Mini-animation component per game id — rendered inside each ticket.
  const GameMini = ({ id }: { id: GameMode }) => {
    if (id === "roardle") {
      return (
        <div className="roardle-mini flex items-center">
          <span className="roardle-tile" style={{ color: "#00BFFF", borderColor: "rgba(0,191,255,0.4)", background: "rgba(0,191,255,0.06)" }}>R</span>
          <span className="roardle-tile" style={{ color: "#00BFFF", borderColor: "rgba(0,191,255,0.4)", background: "rgba(0,191,255,0.06)" }}>O</span>
          <span className="roardle-tile" style={{ color: "#00BFFF", borderColor: "rgba(0,191,255,0.4)", background: "rgba(0,191,255,0.06)" }}>A</span>
        </div>
      );
    }
    if (id === "flashcards") {
      return (
        <div className="flashcards-mini">
          <div className="flashcards-mini-inner">
            <div className="flashcards-face flashcards-face-front">Q</div>
            <div className="flashcards-face flashcards-face-back">A</div>
          </div>
        </div>
      );
    }
    if (id === "timeline") {
      return (
        <div className="timeline-mini" aria-hidden="true">
          <div className="timeline-mini-track" />
          {[0, 25, 50, 75, 100].map(x => (
            <span key={x} className="timeline-mini-tick" style={{ left: `${x}%` }} />
          ))}
          <span className="timeline-mini-dot" />
        </div>
      );
    }
    if (id === "party") {
      return (
        <div className="party-mini" aria-hidden="true">
          <svg viewBox="0 0 80 32" width="80" height="32" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              className="party-mini-stroke"
              d="M4 20 Q 18 6, 32 18 T 60 16 T 76 12"
              stroke="#EC4899"
              strokeWidth="3.2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    }
    return null;
  };

  // Today's remaining pulls across the limited games — drives the footer strip.
  const pullsToday = (["roardle", "timeline"] as const).reduce(
    (acc, id) => {
      const used = getDailyPlays(id);
      acc.used += used;
      acc.cap += DAILY_LIMITS[id];
      return acc;
    },
    { used: 0, cap: 0 },
  );
  const pullsRemaining = Math.max(0, pullsToday.cap - pullsToday.used);

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden relative" style={{ isolation: "isolate" }}>
        {/* Faint orbs keyed to the four game accents — intentional depth */}
        <AmbientOrbs
          orbs={[
            { color: "#EC4899", pos: "top-[12%] right-[14%]", size: 460, opacity: 0.05 },
            { color: "#9B59B6", pos: "top-[48%] left-[10%]", size: 520, opacity: 0.04 },
            { color: "#00BFFF", pos: "bottom-[14%] left-[44%]", size: 440, opacity: 0.04 },
            { color: "#00C851", pos: "bottom-[22%] right-[20%]", size: 380, opacity: 0.035 },
          ]}
        />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 relative z-10">

          {/* ═══ HEADER — title left, lion crest as a real right-side hero ═══ */}
          <header className="mb-10 animate-slide-up flex items-start justify-between gap-6">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/30 mb-2">
                private ledger · est. 2026
              </p>
              <h1 className="font-bebas text-[clamp(3.5rem,11vw,9rem)] text-cream tracking-tight leading-[0.86]">
                THE<br />ARCADE
              </h1>
              <p className="font-serif italic text-cream/40 text-sm mt-3 max-w-md">
                four lots · two-times Fangs on strong runs · pick one, pull the ticket
              </p>
            </div>
            <div
              className="hidden md:block w-40 lg:w-52 shrink-0 -mt-2 games-lion-breathe"
              aria-hidden="true"
            >
              <img
                src="/image-name.png"
                alt=""
                className="w-full h-full object-contain"
                style={{ filter: "drop-shadow(0 0 32px rgba(255,215,0,0.40))" }}
              />
            </div>
          </header>

          {/* Resume prompts for in-flight Roardle / Timeline (Tier 3) */}
          {roardleResume && game === "menu" && (
            <div className="mb-4 rounded-2xl border border-[#00BFFF]/40 bg-[#00BFFF]/[0.06] px-4 py-3 flex items-center gap-3 animate-slide-up">
              <TextAa size={14} weight="fill" className="text-[#00BFFF] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-cream leading-tight">Resume your Roardle</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50">
                  {6 - roardleResume.guesses.length} guesses left
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const r = roardleResume;
                  setRoardleResume(null);
                  setWordLength(r.wordLength);
                  setRoardleWord(r.targetWord);
                  setRoardleGuesses(r.guesses);
                  setRoardleInput("");
                  setRoardleOver(false);
                  setRoardleWon(false);
                  setFangsEarned(null);
                  setGame("roardle");
                }}
                className="font-mono text-[11px] uppercase tracking-[0.25em] text-navy bg-[#00BFFF] rounded-full px-3 py-1.5"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  setRoardleResume(null);
                  void apiPost("/api/quiz/state", { game_type: "roardle", state: null });
                }}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 hover:text-cream"
              >
                Start fresh
              </button>
            </div>
          )}
          {timelineResume && game === "menu" && (
            <div className="mb-4 rounded-2xl border border-[#00C851]/40 bg-[#00C851]/[0.06] px-4 py-3 flex items-center gap-3 animate-slide-up">
              <Calendar size={14} weight="fill" className="text-[#00C851] shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[13px] text-cream leading-tight">Resume your Timeline</p>
                <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50">
                  {timelineResume.events.length} events to order
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  const t = timelineResume;
                  setTimelineResume(null);
                  setTlEvents(t.events);
                  setTlOrder(t.order);
                  setTlSubmitted(false);
                  setTlScore(0);
                  setFangsEarned(null);
                  setGame("timeline");
                }}
                className="font-mono text-[11px] uppercase tracking-[0.25em] text-navy bg-[#00C851] rounded-full px-3 py-1.5"
              >
                Resume
              </button>
              <button
                type="button"
                onClick={() => {
                  setTimelineResume(null);
                  void apiPost("/api/quiz/state", { game_type: "timeline", state: null });
                }}
                className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 hover:text-cream"
              >
                Start fresh
              </button>
            </div>
          )}

          {/* ═══ TABS ═══ */}
          <div className="flex justify-center gap-2 mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
            {(["quickplay", "library"] as TabMode[]).map(t => (
              <button key={t} onClick={() => setTab(t)}
                className="px-6 py-2.5 rounded-xl font-bebas text-sm tracking-wider transition-all"
                style={tab === t ? {
                  background: "rgba(255,215,0,0.1)",
                  border: "1px solid rgba(255,215,0,0.35)",
                  color: "#FFD700",
                  boxShadow: "0 0 15px rgba(255,215,0,0.08)",
                } : {
                  background: "rgba(255,255,255,0.03)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "rgba(238,244,255,0.35)",
                }}>
                {t === "quickplay" ? (
                  <>
                    <Lightning size={16} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" />
                    QUICK PLAY
                  </>
                ) : (
                  <>
                    <BookOpen size={16} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" />
                    MY LIBRARY
                  </>
                )}
              </button>
            ))}
          </div>

          {/* ═══ PDF Upload (Library mode) ═══ */}
          {tab === "library" && !pdfContent && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "2px dashed rgba(255,255,255,0.1)" }}>
                <span className="text-4xl mb-3 flex items-center justify-center">
                  <FileText size={40} weight="fill" aria-hidden="true" />
                </span>
                <p className="font-bebas text-xl text-cream tracking-wider mb-2">UPLOAD YOUR STUDY MATERIAL</p>
                <p className="text-cream/30 text-xs mb-6 font-syne">Drop a PDF to generate custom games from your notes</p>
                <label className="btn-gold px-6 py-3 rounded-xl text-sm cursor-pointer inline-block">
                  Choose PDF
                  <input type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) handlePdfUpload(e.target.files[0]); }} />
                </label>
                {pdfProcessing && (
                  <div className="flex items-center justify-center gap-2 mt-4">
                    <div className="w-4 h-4 rounded-full border-2 border-electric border-t-transparent animate-spin" />
                    <span className="text-cream/40 text-xs">Processing PDF with AI...</span>
                  </div>
                )}
                {pdfError && <p className="text-red-400 text-xs mt-3">{pdfError}</p>}
              </div>
            </div>
          )}

          {tab === "library" && pdfContent && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(74,144,217,0.2)" }}>
                <span className="text-2xl flex items-center">
                  <FileText size={28} weight="regular" aria-hidden="true" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-cream font-semibold text-sm truncate">{pdfName}</p>
                  <p className="text-cream/30 text-[10px]">{pdfContent.vocabulary?.length ?? 0} vocab · {pdfContent.concepts?.length ?? 0} questions · {pdfContent.keyTerms?.length ?? 0} terms</p>
                </div>
                <button onClick={() => { setPdfContent(null); setPdfName(null); if (typeof window !== "undefined") { localStorage.removeItem("lionade_pdf_content"); localStorage.removeItem("lionade_pdf_name"); } }}
                  className="text-cream/30 text-xs hover:text-red-400 transition">Remove</button>
              </div>
            </div>
          )}

          {/* ═══ TICKET GRID — 2×2 luxury tickets with foil sheen + hover lift ═══ */}
          <div className="games-stack grid grid-cols-1 lg:grid-cols-2 gap-5">
            {GAMES.map((g, idx) => {
              const plays = getDailyPlays(g.id);
              const remaining = g.limit - plays;
              const canPlay = remaining > 0 || g.limit >= 999;
              const isPdf = tab === "library";
              const lotNumber = String(idx + 1).padStart(3, "0");
              const GameIcon = g.Icon;

              return (
                <div
                  key={g.id}
                  className="games-ticket games-foil lift-card relative rounded-[6px] overflow-hidden animate-slide-up"
                  style={{
                    animationDelay: `${0.15 + idx * 0.07}s`,
                    background: `linear-gradient(90deg, ${hexToRgba(g.color, 0.08)} 0%, #0c0a14 60%)`,
                    border: `1px solid ${hexToRgba(g.color, 0.22)}`,
                    boxShadow: "0 10px 28px rgba(0, 0, 0, 0.4)",
                  }}
                >
                  <div className="relative z-10 flex items-stretch min-h-[140px] sm:min-h-[160px]">

                    {/* ── Column 1: Lot number ── */}
                    <div
                      className="flex items-center justify-center w-[60px] sm:w-[88px] flex-shrink-0"
                      style={{ background: "rgba(0, 0, 0, 0.25)", borderRight: "1px dashed rgba(255, 215, 0, 0.12)" }}
                    >
                      <div className="games-lot-number font-mono text-[11px] sm:text-[13px] text-cream/35 font-bold">
                        lot {lotNumber}
                      </div>
                    </div>

                    {/* ── Column 2: Icon badge ── */}
                    <div className="flex items-center justify-center w-14 sm:w-20 flex-shrink-0">
                      <div
                        className="w-11 h-11 sm:w-14 sm:h-14 flex items-center justify-center rounded-sm"
                        style={{
                          background: hexToRgba(g.color, 0.12),
                          border: `1px solid ${hexToRgba(g.color, 0.4)}`,
                          boxShadow: `inset 0 0 20px ${hexToRgba(g.color, 0.15)}`,
                        }}
                      >
                        <GameIcon size={24} weight="fill" style={{ color: g.color }} aria-hidden="true" />
                      </div>
                    </div>

                    {/* ── Column 3: Title + description + meta ── */}
                    <div className="flex-1 min-w-0 flex flex-col justify-center px-3 sm:px-5 py-4">
                      <div className="flex items-baseline gap-2 flex-wrap mb-1">
                        <h3
                          className="font-bebas tracking-wider leading-none"
                          style={{
                            color: g.color,
                            fontSize: "clamp(1.5rem, 4.5vw, 2.25rem)",
                          }}
                        >
                          {g.name}
                        </h3>
                      </div>
                      <p className="text-cream/45 text-xs sm:text-sm font-syne italic mb-2">
                        {isPdf ? "from your PDF" : g.desc}
                      </p>

                      {/* Meta strip: fangs + daily limit */}
                      <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                        <div className="flex items-center gap-1.5 px-2 py-0.5" style={{ background: "rgba(255, 215, 0, 0.08)", border: "1px solid rgba(255, 215, 0, 0.22)" }}>
                          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3.5 h-3.5 object-contain" />
                          <span className="font-mono text-[10px] sm:text-[11px] font-bold text-gold">{g.fangs}</span>
                        </div>
                        {g.limit < 999 && (
                          <span className="font-mono text-[10px] text-cream/40 uppercase tracking-wider">
                            {Math.max(0, remaining)} / {g.limit} today
                          </span>
                        )}
                        {g.limit >= 999 && (
                          <span className="font-mono text-[10px] text-cream/40 uppercase tracking-wider">unlimited</span>
                        )}
                      </div>

                      {/* Roardle word-length selector inline with ticket */}
                      {g.id === "roardle" && (
                        <div className="flex gap-2 mt-3">
                          {[4, 5, 6].map(len => (
                            <button
                              key={len}
                              onClick={() => setWordLength(len)}
                              className="transition-all duration-200 active:scale-90"
                              style={wordLength === len ? {
                                width: 32, height: 32,
                                background: g.color, color: "#fff",
                                fontSize: "12px", fontWeight: 800,
                                border: "none",
                                boxShadow: `0 2px 10px ${hexToRgba(g.color, 0.5)}`,
                              } : {
                                width: 32, height: 32,
                                background: "rgba(255,255,255,0.04)", color: "rgba(238,244,255,0.35)",
                                fontSize: "12px", fontWeight: 700,
                                border: "1px solid rgba(255,255,255,0.1)",
                              }}
                              aria-label={`${len} letters`}
                            >
                              {len}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* ── Column 4: Mini-animation (hidden on mobile) ── */}
                    <div className="hidden md:flex items-center justify-center w-[110px] flex-shrink-0 pr-2">
                      <GameMini id={g.id} />
                    </div>

                    {/* ── Column 5: Play button ── */}
                    <div className="flex items-center justify-end flex-shrink-0 pr-4 sm:pr-6">
                      <button
                        onClick={canPlay ? g.start : undefined}
                        disabled={!canPlay || (isPdf && !pdfContent && g.id !== "flashcards")}
                        className="font-syne font-bold text-xs sm:text-sm px-4 sm:px-6 py-2.5 transition-all active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed inline-flex items-center gap-2"
                        style={{
                          background: g.color,
                          color: "#fff",
                          boxShadow: `0 4px 14px ${hexToRgba(g.color, 0.4)}, inset 0 1px 0 rgba(255, 255, 255, 0.18)`,
                        }}
                      >
                        Pull
                        <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  </div>

                  {/* Perforated vertical line between lot column and content */}
                  <div className="games-ticket-perf" aria-hidden="true" />
                </div>
              );
            })}
          </div>

          {/* ═══ FOOTER STAT STRIP — fills the dead space below the grid ═══ */}
          <div
            className="mt-8 rounded-[6px] flex flex-wrap items-center gap-x-8 gap-y-3 px-5 sm:px-7 py-4 animate-slide-up"
            style={{
              animationDelay: "0.45s",
              background: "linear-gradient(90deg, rgba(255,215,0,0.05) 0%, rgba(12,10,20,0.6) 60%)",
              border: "1px solid rgba(255,215,0,0.14)",
            }}
          >
            <div className="flex items-center gap-2.5">
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
              <div>
                <p className="font-bebas text-xl text-gold leading-none tabular-nums">{pullsRemaining}</p>
                <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/40 mt-0.5">pulls left today</p>
              </div>
            </div>
            <div className="h-8 w-px bg-cream/10 hidden sm:block" aria-hidden="true" />
            <div>
              <p className="font-bebas text-xl text-cream leading-none">{GAMES.length}</p>
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/40 mt-0.5">lots open</p>
            </div>
            <div className="h-8 w-px bg-cream/10 hidden sm:block" aria-hidden="true" />
            <p className="font-serif italic text-cream/30 text-xs ml-auto">
              house rules: no Fangs without effort · draw resets at midnight
            </p>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
