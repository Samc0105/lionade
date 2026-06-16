"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useReducedMotion } from "framer-motion";
import { useRouter } from "next/navigation";
import ProtectedRoute from "@/components/ProtectedRoute";
import FeatureGate from "@/components/FeatureGate";
import AmbientOrbs from "@/components/AmbientOrbs";
import RevealText from "@/components/RevealText";
import CountUp from "@/components/CountUp";
// Confetti is dynamic-imported so the canvas particle code only ships when
// a player actually reaches a game-over screen. Saves ~44 kB on the /games
// landing First Load JS bundle. ssr: false because Confetti reaches into
// window/canvas on mount.
import dynamic from "next/dynamic";
const Confetti = dynamic(() => import("@/components/Confetti"), { ssr: false });
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
  MicrophoneStage,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

// ── Types ────────────────────────────────────────────────────

type GameMode = "menu" | "roardle" | "flashcards" | "timeline" | "party" | "pardy";
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
  // Last-played-at marker drives "Continue" sort + badge on the lobby. One
  // key per game so the lobby can read all five in O(1) without a fetch.
  try { localStorage.setItem(`lionade_last_played_${gameType}`, String(Date.now())); } catch { /* quota */ }
}

// Reads the last-played timestamp for a game (ms epoch). Returns 0 when
// never played so default-order sort sinks unplayed games below played ones
// without needing a separate "is-played" flag.
function getLastPlayedAt(gameType: string): number {
  if (typeof window === "undefined") return 0;
  try {
    const raw = localStorage.getItem(`lionade_last_played_${gameType}`);
    return raw ? parseInt(raw) || 0 : 0;
  } catch { return 0; }
}

// Marks Party / Pardy / Flashcards as "played today" too — these games don't
// run incrementDailyPlays (no daily limit), so without this their tickets
// would never get a Continue badge or rise to the top of the sort.
function markPlayedNow(gameType: string) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(`lionade_last_played_${gameType}`, String(Date.now())); } catch { /* quota */ }
}

// Walks the per-game daily-play keys backwards from today and counts the
// consecutive-day run. Today not yet played is treated as "streak alive" so
// the badge doesn't drop the moment a new day begins; the streak only breaks
// when a full calendar day passes with no plays at all.
function getArcadeStreak(): number {
  if (typeof window === "undefined") return 0;
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 30; i++) {
    const date = d.toISOString().split("T")[0];
    const playedThisDay = Object.keys(localStorage).some(
      (k) =>
        k.startsWith("lionade_plays_") &&
        k.endsWith(`_${date}`) &&
        parseInt(localStorage.getItem(k) ?? "0") > 0,
    );
    if (playedThisDay) {
      streak++;
    } else if (i === 0) {
      // Today not played YET — streak preserved from yesterday-and-earlier.
    } else {
      break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

const DAILY_LIMITS: Record<string, number> = { roardle: 3, flashcards: 999, timeline: 3, party: 999, pardy: 999 };

// ── Roardle lifetime stats (localStorage-only) ──────────────────────────────
// played + won + totalTries lets us derive win rate and average tries to
// solve. Persisted under a single key so a future "stats wipe" is one line.
interface RoardleStats { played: number; won: number; totalTries: number }
const ROARDLE_STATS_KEY = "lionade_roardle_stats";
function getRoardleStats(): RoardleStats {
  if (typeof window === "undefined") return { played: 0, won: 0, totalTries: 0 };
  try {
    const raw = localStorage.getItem(ROARDLE_STATS_KEY);
    if (!raw) return { played: 0, won: 0, totalTries: 0 };
    const parsed = JSON.parse(raw);
    return {
      played: Math.max(0, parseInt(String(parsed.played)) || 0),
      won: Math.max(0, parseInt(String(parsed.won)) || 0),
      totalTries: Math.max(0, parseInt(String(parsed.totalTries)) || 0),
    };
  } catch { return { played: 0, won: 0, totalTries: 0 }; }
}
function recordRoardleResult(won: boolean, tries: number) {
  if (typeof window === "undefined") return;
  const cur = getRoardleStats();
  const next: RoardleStats = {
    played: cur.played + 1,
    won: cur.won + (won ? 1 : 0),
    totalTries: cur.totalTries + (won ? tries : 0),
  };
  try { localStorage.setItem(ROARDLE_STATS_KEY, JSON.stringify(next)); } catch { /* quota */ }
}

// ── Timeline lifetime stats ─────────────────────────────────────────────────
interface TimelineStats { played: number; perfect: number }
const TIMELINE_STATS_KEY = "lionade_timeline_stats";
function getTimelineStats(): TimelineStats {
  if (typeof window === "undefined") return { played: 0, perfect: 0 };
  try {
    const raw = localStorage.getItem(TIMELINE_STATS_KEY);
    if (!raw) return { played: 0, perfect: 0 };
    const p = JSON.parse(raw);
    return {
      played: Math.max(0, parseInt(String(p.played)) || 0),
      perfect: Math.max(0, parseInt(String(p.perfect)) || 0),
    };
  } catch { return { played: 0, perfect: 0 }; }
}
function recordTimelineResult(score: number, total: number) {
  if (typeof window === "undefined") return;
  const cur = getTimelineStats();
  const next: TimelineStats = {
    played: cur.played + 1,
    perfect: cur.perfect + (score === total && total > 0 ? 1 : 0),
  };
  try { localStorage.setItem(TIMELINE_STATS_KEY, JSON.stringify(next)); } catch { /* quota */ }
}

// ── Flashcards lifetime stats ───────────────────────────────────────────────
interface FlashcardsStats { totalKnown: number; sessions: number }
const FLASHCARDS_STATS_KEY = "lionade_flashcards_stats";
function getFlashcardsStats(): FlashcardsStats {
  if (typeof window === "undefined") return { totalKnown: 0, sessions: 0 };
  try {
    const raw = localStorage.getItem(FLASHCARDS_STATS_KEY);
    if (!raw) return { totalKnown: 0, sessions: 0 };
    const p = JSON.parse(raw);
    return {
      totalKnown: Math.max(0, parseInt(String(p.totalKnown)) || 0),
      sessions: Math.max(0, parseInt(String(p.sessions)) || 0),
    };
  } catch { return { totalKnown: 0, sessions: 0 }; }
}
function recordFlashcardsResult(knew: number) {
  if (typeof window === "undefined") return;
  const cur = getFlashcardsStats();
  const next: FlashcardsStats = {
    totalKnown: cur.totalKnown + knew,
    sessions: cur.sessions + 1,
  };
  try { localStorage.setItem(FLASHCARDS_STATS_KEY, JSON.stringify(next)); } catch { /* quota */ }
}

// ── Component ────────────────────────────────────────────────

export default function GamesPage() {
  const router = useRouter();
  const { user } = useAuth();
  const reduced = useReducedMotion();

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
  const [roardleShakeNonce, setRoardleShakeNonce] = useState(0);
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
    setFangsEarned(amount); // optimistic
    const res = await apiPost<{ awarded?: number }>("/api/games/reward", { amount, gameType });
    // Honor the server's actual award — each game pays at most once per day.
    if (res.ok && typeof res.data?.awarded === "number" && res.data.awarded !== amount) {
      setFangsEarned(res.data.awarded);
    }
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

    if (source.length === 0) {
      // No Library words at this length — surface why instead of silent no-op.
      setPdfError(`No ${wordLength}-letter words found in this PDF. Try a different length or upload another doc.`);
      setTimeout(() => setPdfError(""), 4000);
      return;
    }
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

    // Validate against the word bank — only real study words are accepted.
    // In Library mode, the target word is picked from pdfContent.keyTerms, so
    // the user's correct guess must validate against THAT source too — otherwise
    // typing the exact target word fires "Not in word list" (input-stuck class).
    const libraryWords = tab === "library" && pdfContent?.keyTerms?.length
      ? pdfContent.keyTerms.filter((w) => w.length === wordLength).map((w) => w.toUpperCase())
      : [];
    const validWords = new Set([
      ...((WORD_BANK[wordLength] ?? []).map((w) => w.toUpperCase())),
      ...libraryWords,
    ]);
    if (!validWords.has(guess)) {
      setRoardleError("Not in word list");
      setRoardleShakeNonce(n => n + 1);
      setRoardleInput("");
      setTimeout(() => setRoardleError(""), 2200);
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
      recordRoardleResult(true, newGuesses.length);
    } else if (newGuesses.length >= 6) {
      setRoardleOver(true);
      recordRoardleResult(false, 6);
    }
  }, [roardleInput, wordLength, roardleOver, roardleGuesses, roardleWord, awardFangs, tab, pdfContent]);

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

    // Empty-deck guard — without this we'd land in flashcards game state with
    // fcCards.length === 0, immediately hit divide-by-zero in fcAnswer (NaN%),
    // and ship NaN to awardFangs.
    if (source.length === 0) {
      setPdfError("No vocab found in this PDF. Try a different document.");
      setTimeout(() => setPdfError(""), 4000);
      return;
    }

    setFcCards(source.sort(() => Math.random() - 0.5).slice(0, 12));
    setFcIdx(0);
    setFcFlipped(false);
    setFcKnew(0);
    setFcOver(false);
    setFangsEarned(null);
    setGame("flashcards");
    markPlayedNow("flashcards");
  }, [tab, pdfContent]);

  const fcAnswer = useCallback((knew: boolean) => {
    if (knew) setFcKnew(k => k + 1);
    setFcFlipped(false);

    if (fcIdx + 1 < fcCards.length) {
      setTimeout(() => setFcIdx(i => i + 1), 200);
    } else {
      setFcOver(true);
      // Guard divide-by-zero defensively (startFlashcards refuses empty decks
      // upstream, but this keeps Math.round(NaN * 15) out of awardFangs forever).
      const finalKnew = fcKnew + (knew ? 1 : 0);
      const pct = fcCards.length > 0 ? finalKnew / fcCards.length : 0;
      const fangs = Math.round(pct * 15);
      if (fangs > 0) awardFangs(fangs, "flashcards");
      recordFlashcardsResult(finalKnew);
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
    recordTimelineResult(correct, tlEvents.length);
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
        <FeatureGate feature="games.roardle" compact>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <button onClick={backToMenu} className="text-cream/40 text-sm mb-4 hover:text-cream/60 transition">← Back</button>
            <h2 className="font-bebas text-4xl text-cream tracking-wider text-center mb-1">
              <RevealText text="ROARDLE" color="#EEF4FF" charDelay={0.06} />
            </h2>
            {(() => {
              const guessesLeft = 6 - roardleGuesses.length;
              // Tension treatment when 1-2 guesses left and the round isn't
              // over. The counter pulses + warms to amber/red so the player
              // feels the runway shortening. Three-state: chill (≥3), warning
              // (2), critical (1).
              const tense = !roardleOver && guessesLeft <= 2 && guessesLeft > 0;
              const critical = !roardleOver && guessesLeft === 1;
              return (
                <p className={`text-xs text-center mb-2 transition-colors ${critical ? "text-red-300" : tense ? "text-amber-300" : "text-cream/30"}`}>
                  {wordLength} letters ·{" "}
                  <span
                    className={`font-bebas tabular-nums ${tense && !reduced ? "ca-urgent inline-block" : ""}`}
                    style={tense ? { textShadow: critical ? "0 0 6px rgba(252,165,165,0.55)" : "0 0 5px rgba(252,211,77,0.45)" } : undefined}
                  >
                    {guessesLeft}
                  </span>
                  {" "}guesses left
                </p>
              );
            })()}
            {/* Library-mode badge — small gold chip above the grid when the
                target word came from a user-uploaded PDF, so the player
                always knows "this round is from my notes." Truncated long
                file names so the chip stays one line. */}
            {tab === "library" && pdfContent && pdfName && (
              <div className="flex justify-center mb-3">
                <span
                  className="inline-flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.22em] px-2.5 py-1 rounded-full max-w-[88%]"
                  style={{
                    background: "linear-gradient(135deg, rgba(255,215,0,0.14) 0%, rgba(184,150,12,0.06) 100%)",
                    border: "1px solid rgba(255,215,0,0.35)",
                    color: "#FDE68A",
                  }}
                >
                  <span aria-hidden="true">📚</span>
                  <span className="truncate">from {pdfName}</span>
                </span>
              </div>
            )}
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
                  <div
                    key={isCurrentRow ? `row-${row}-shake-${roardleShakeNonce}` : `row-${row}`}
                    className={`flex justify-center gap-1.5 ${isCurrentRow && roardleShakeNonce > 0 ? "roardle-shake" : ""}`}
                  >
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
                {roardleWon && (
                  <Confetti
                    trigger={true}
                    count={60}
                    origin="top"
                    duration={2000}
                    palette={["#FFD700", "#FDE68A", "#22C55E", "#A855F7"]}
                  />
                )}
                <p className="font-bebas text-2xl">
                  {roardleWon ? (
                    <RevealText
                      text="NICE!"
                      color="#22C55E"
                      glow="0 0 10px rgba(34,197,94,0.55)"
                      charDelay={0.07}
                    />
                  ) : (
                    <span style={{ color: "#EF4444" }}>
                      The word was{" "}
                      <RevealText
                        text={roardleWord.toUpperCase()}
                        color="#FCA5A5"
                        glow="0 0 8px rgba(239,68,68,0.45)"
                        delay={0.2}
                        charDelay={0.07}
                      />
                    </span>
                  )}
                </p>
                {fangsEarned !== null && (
                  <div className="flex items-center justify-center gap-1.5 mt-2">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                  </div>
                )}
                {/* Lifetime stats — pulled from localStorage. Hidden on the
                    very first played round (no meaningful denominator) so a
                    first-timer doesn't read "1/1 played · 100% won" as
                    self-congratulatory boilerplate. */}
                {(() => {
                  const stats = getRoardleStats();
                  if (stats.played < 2) return null;
                  const winPct = Math.round((stats.won / stats.played) * 100);
                  const avgTries = stats.won > 0 ? (stats.totalTries / stats.won).toFixed(1) : "—";
                  return (
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/45 mt-3">
                      <span className="text-cream/70 tabular-nums">{stats.played}</span> played ·
                      {" "}<span className="text-cream/70 tabular-nums">{winPct}%</span> won ·
                      {" "}avg <span className="text-cream/70 tabular-nums">{avgTries}</span> tries
                    </p>
                  );
                })()}
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
                        className="w-9 h-11 sm:w-10 sm:h-12 rounded-lg font-bebas text-base transition-all"
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
        </FeatureGate>
      </ProtectedRoute>
    );
  }

  // ── FLASH CARDS ─────────────────────────────────────────
  if (game === "flashcards") {
    const card = fcCards[fcIdx];
    return (
      <ProtectedRoute>
        <FeatureGate feature="games.flashcards" compact>
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
            ) : (() => {
              const pct = fcCards.length > 0 ? Math.round((fcKnew / fcCards.length) * 100) : 0;
              const isMastered = pct === 100;
              const isStrong = pct >= 75 && !isMastered;
              const shouldConfetti = !reduced && (isMastered || isStrong);
              const palette = isMastered
                ? ["#FFD700", "#FDE68A", "#FFFFFF", "#9B59B6"]
                : ["#FFD700", "#FDE68A", "#9B59B6"];
              const headline = isMastered ? "MASTERED ALL" : isStrong ? "STRONG RECALL" : pct >= 50 ? "DECENT RECALL" : "ROOM TO GROW";
              const headlineColor = isMastered ? "#FFD700" : isStrong ? "#FDE68A" : pct >= 50 ? "#A78BFA" : "rgba(238,244,255,0.55)";
              return (
                <div className="text-center animate-slide-up">
                  {shouldConfetti && (
                    <Confetti
                      trigger={true}
                      count={isMastered ? 110 : 70}
                      origin="top"
                      duration={isMastered ? 2800 : 2100}
                      palette={palette}
                    />
                  )}
                  <h2 className="font-bebas text-4xl text-cream tracking-wider mb-2">
                    <RevealText text="COMPLETE!" color="#EEF4FF" charDelay={0.06} />
                  </h2>
                  <p className="font-bebas text-base tracking-[0.2em] mb-2">
                    <RevealText
                      text={headline}
                      color={headlineColor}
                      glow={isMastered ? "0 0 8px rgba(255,215,0,0.55)" : ""}
                      delay={0.4}
                      charDelay={0.045}
                    />
                  </p>
                  <p className="font-bebas text-6xl text-gold mb-1 tabular-nums">
                    <CountUp value={pct} duration={900} withDigitReveal /><span>%</span>
                  </p>
                  <p className="text-cream/40 text-sm mb-4">{fcKnew} / {fcCards.length} known</p>
                  {fangsEarned !== null && (
                    <div className="flex items-center justify-center gap-1.5 mb-6">
                      <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                      <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                    </div>
                  )}
                  <button onClick={backToMenu} className="btn-gold px-6 py-2 rounded-lg text-sm">Back to Games</button>
                </div>
              );
            })()}
          </div>
        </div>
        </FeatureGate>
      </ProtectedRoute>
    );
  }

  // ── TIMELINE DROP ───────────────────────────────────────
  if (game === "timeline") {
    return (
      <ProtectedRoute>
        <FeatureGate feature="games.timeline" compact>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <button onClick={backToMenu} className="text-cream/40 text-sm mb-4 hover:text-cream/60 transition">← Back</button>
            <h2 className="font-bebas text-3xl text-cream tracking-wider text-center mb-1">
              <RevealText text="TIMELINE DROP" color="#EEF4FF" charDelay={0.045} />
            </h2>
            <p className="text-cream/30 text-xs text-center mb-6">Drag events into chronological order (earliest first)</p>

            <div className="space-y-2 mb-6" data-timeline-list>
              {tlOrder.map((eventIdx, pos) => {
                const ev = tlEvents[eventIdx];
                const isCorrect = tlSubmitted && ev.year === [...tlEvents].sort((a, b) => a.year - b.year)[pos]?.year;
                const isDragging = dragIdx === pos;
                return (
                  <div
                    key={eventIdx}
                    data-row-pos={pos}
                    onPointerDown={(e) => {
                      if (tlSubmitted) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDragIdx(pos);
                    }}
                    onPointerMove={(e) => {
                      if (tlSubmitted || dragIdx === null) return;
                      const el = document.elementFromPoint(e.clientX, e.clientY);
                      const rowEl = el?.closest("[data-row-pos]") as HTMLElement | null;
                      if (!rowEl) return;
                      const targetPos = Number(rowEl.dataset.rowPos);
                      if (Number.isNaN(targetPos) || targetPos === dragIdx) return;
                      moveTimelineItem(dragIdx, targetPos);
                      setDragIdx(targetPos);
                    }}
                    onPointerUp={(e) => {
                      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* noop if not captured */ }
                      setDragIdx(null);
                    }}
                    onPointerCancel={() => setDragIdx(null)}
                    className={`flex items-center gap-3 p-3 rounded-xl transition-all select-none ${tlSubmitted ? "" : "cursor-grab active:cursor-grabbing"} ${isDragging ? "scale-[1.02] shadow-lg" : ""}`}
                    style={{
                      touchAction: tlSubmitted ? "auto" : "none",
                      background: tlSubmitted
                        ? isCorrect ? "rgba(34,197,94,0.1)" : "rgba(239,68,68,0.1)"
                        : isDragging ? "rgba(255,215,0,0.10)" : "var(--game-card-bg, rgba(255,255,255,0.04))",
                      border: `1px solid ${tlSubmitted ? (isCorrect ? "rgba(34,197,94,0.3)" : "rgba(239,68,68,0.3)") : isDragging ? "rgba(255,215,0,0.45)" : "var(--game-card-border, rgba(255,255,255,0.08))"}`,
                      boxShadow: isDragging ? "0 8px 24px rgba(0,0,0,0.35)" : undefined,
                    }}>
                    <span className="font-bebas text-lg text-cream/30 w-6 pointer-events-none">{pos + 1}</span>
                    <div className="flex-1 pointer-events-none">
                      <p className="text-cream text-sm font-semibold">{ev.event}</p>
                      {tlSubmitted && <p className="text-cream/40 text-xs mt-0.5">{ev.date}</p>}
                    </div>
                    {tlSubmitted && (
                      <span className="text-lg flex items-center pointer-events-none">
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
            ) : (() => {
              // Tier-themed treatment matches Pardy Final Tally: gold confetti
              // on perfect (all correct), no celebration on a sub-50% miss.
              const total = tlEvents.length;
              const isPerfect = total > 0 && tlScore === total;
              const isStrong = total > 0 && tlScore / total >= 0.75 && !isPerfect;
              const shouldConfetti = !reduced && (isPerfect || isStrong);
              const palette = isPerfect
                ? ["#FFD700", "#FDE68A", "#FFFFFF", "#00C851"]  // pure-gold + green for perfect
                : ["#FFD700", "#FDE68A", "#A855F7"];            // gold + purple for strong
              const headline = isPerfect ? "PERFECT ORDER" : tlScore > 0 ? "TIMELINE LOCKED IN" : "TOUGH ROUND";
              const headlineColor = isPerfect ? "#FFD700" : tlScore > 0 ? "#86EFAC" : "#FCA5A5";
              return (
                <div className="text-center animate-slide-up">
                  {shouldConfetti && (
                    <Confetti
                      trigger={true}
                      count={isPerfect ? 100 : 70}
                      origin="top"
                      duration={isPerfect ? 2600 : 2100}
                      palette={palette}
                    />
                  )}
                  <p className="font-bebas text-base tracking-[0.2em] mb-1">
                    <RevealText
                      text={headline}
                      color={headlineColor}
                      glow={isPerfect ? "0 0 8px rgba(255,215,0,0.55)" : tlScore > 0 ? "0 0 6px rgba(34,197,94,0.4)" : "0 0 6px rgba(239,68,68,0.4)"}
                      charDelay={0.045}
                    />
                  </p>
                  <p className="font-bebas text-2xl text-cream mb-1 tabular-nums">
                    {tlScore} / {tlEvents.length} correct
                  </p>
                {fangsEarned !== null && (
                  <div className="flex items-center justify-center gap-1.5 mb-4">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                  </div>
                )}
                <button onClick={backToMenu} className="btn-gold px-6 py-2 rounded-lg text-sm">Back to Games</button>
                </div>
              );
            })()}
          </div>
        </div>
        </FeatureGate>
      </ProtectedRoute>
    );
  }

  // ══════════════════════════════════════════════════════════
  // MENU
  // ══════════════════════════════════════════════════════════

  // Game catalog. `kind` splits multiplayer (Party / Pardy) from solo so the
  // lobby can render a "play with friends" hero row above the solo grid. `isNew`
  // tags games hardened in the last sprint so the lobby can paint a gold "NEW"
  // foil chip on their ticket; flip back to false after ~2 weeks of soak.
  const GAMES: { id: GameMode; name: string; Icon: PhosphorIcon; desc: string; fangs: string; limit: number; start: () => void; color: string; pos: string; kind: "solo" | "multi"; isNew?: boolean }[] = [
    { id: "roardle" as GameMode, name: "ROARDLE", Icon: TextAa, desc: "Guess the science word", fangs: `${wordLength === 4 ? 10 : wordLength === 5 ? 15 : 20}+`, limit: DAILY_LIMITS.roardle, start: startRoardle, color: "#00BFFF", pos: "top-0 left-0", kind: "solo" },
    { id: "party" as GameMode, name: "LIONADE PARTY", Icon: PaintBrush, desc: "Sketch + Bluff with friends", fangs: "—", limit: DAILY_LIMITS.party, start: () => { markPlayedNow("party"); router.push("/games/party"); }, color: "#EC4899", pos: "top-0 right-0", kind: "multi", isNew: true },
    { id: "pardy" as GameMode, name: "PARDY", Icon: MicrophoneStage, desc: "5×5 board · trivia for Fangs", fangs: "10-200", limit: DAILY_LIMITS.pardy, start: () => { markPlayedNow("pardy"); router.push("/games/pardy"); }, color: "#FFD700", pos: "middle", kind: "multi", isNew: true },
    { id: "flashcards" as GameMode, name: "FLASH CARDS", Icon: Cards, desc: "Flip, learn, repeat", fangs: "15", limit: DAILY_LIMITS.flashcards, start: startFlashcards, color: "#9B59B6", pos: "bottom-0 left-0", kind: "solo" },
    { id: "timeline" as GameMode, name: "TIMELINE DROP", Icon: Calendar, desc: "Order events in time", fangs: "3×", limit: DAILY_LIMITS.timeline, start: startTimeline, color: "#00C851", pos: "bottom-0 right-0", kind: "solo" },
  ];

  // Last-played sort: most recently played first, then default-order. Snapshot
  // localStorage once per render so the comparator stays stable + cheap.
  const lastPlayedSnapshot: Record<string, number> = GAMES.reduce((acc, g) => {
    acc[g.id] = getLastPlayedAt(g.id);
    return acc;
  }, {} as Record<string, number>);
  const byRecency = <T extends { id: GameMode }>(a: T, b: T) =>
    (lastPlayedSnapshot[b.id] || 0) - (lastPlayedSnapshot[a.id] || 0);
  const MULTI_GAMES = GAMES.filter(g => g.kind === "multi").sort(byRecency);
  const SOLO_GAMES = GAMES.filter(g => g.kind === "solo").sort(byRecency);
  // "Continue" badge fires when a game was touched within the last 36h. Long
  // enough to bridge an overnight gap, short enough that yesterday's casual
  // round doesn't keep claiming the badge a week later.
  const CONTINUE_WINDOW_MS = 36 * 60 * 60 * 1000;
  const isContinuable = (id: GameMode) =>
    lastPlayedSnapshot[id] > 0 && Date.now() - lastPlayedSnapshot[id] < CONTINUE_WINDOW_MS;

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
    if (id === "pardy") {
      // Mini 3x3 grid of gold board tiles, evoking the Pardy board.
      return (
        <div className="grid grid-cols-3 gap-[3px]" aria-hidden="true">
          {Array.from({ length: 9 }).map((_, i) => (
            <span
              key={i}
              className="w-[14px] h-[10px] rounded-[2px]"
              style={{
                background: "rgba(255,215,0,0.18)",
                border: "1px solid rgba(255,215,0,0.45)",
              }}
            />
          ))}
        </div>
      );
    }
    return null;
  };

  // Single ticket renderer — shared by the Multiplayer cluster + the Solo
  // grid. Lotted by absolute position (lotNumber prop), so Solo continues
  // numbering after Multi (lot 001/002 multi, 003/004/005 solo). `featured`
  // flag thickens the border + halo for the multiplayer block.
  const renderTicket = (
    g: typeof GAMES[number],
    visualIdx: number,
    lotNumber: string,
    featured: boolean,
  ) => {
    const plays = getDailyPlays(g.id);
    const remaining = g.limit - plays;
    const canPlay = remaining > 0 || g.limit >= 999;
    const isPdf = tab === "library";
    const GameIcon = g.Icon;
    const isMaxed = g.limit < 999 && remaining <= 0;
    const isLastPull = g.limit < 999 && remaining === 1;
    const continuable = isContinuable(g.id);

    return (
      <div
        key={g.id}
        className="games-ticket games-foil lift-card relative rounded-[6px] overflow-hidden animate-slide-up"
        style={{
          animationDelay: `${0.15 + visualIdx * 0.07}s`,
          background: `linear-gradient(90deg, ${hexToRgba(g.color, featured ? 0.12 : 0.08)} 0%, #0c0a14 ${featured ? 62 : 60}%)`,
          border: `${featured ? 1.5 : 1}px solid ${hexToRgba(g.color, isMaxed ? 0.1 : (featured ? 0.42 : 0.22))}`,
          boxShadow: featured
            ? `0 14px 36px rgba(0, 0, 0, 0.5), 0 0 26px ${hexToRgba(g.color, 0.10)}`
            : "0 10px 28px rgba(0, 0, 0, 0.4)",
          opacity: isMaxed ? 0.68 : 1,
        }}
      >
        {isMaxed && (
          <div
            aria-hidden="true"
            className="absolute top-3 right-3 z-20 pointer-events-none"
            style={{ transform: "rotate(8deg)" }}
          >
            <span
              className="font-bebas text-[10px] sm:text-xs tracking-[0.25em] px-2.5 py-1 rounded-sm"
              style={{
                background: "rgba(0,0,0,0.55)",
                color: "#FCA5A5",
                border: "1.5px solid rgba(252,165,165,0.65)",
                textShadow: "0 0 8px rgba(252,165,165,0.4)",
                boxShadow: "0 0 14px rgba(252,165,165,0.18), inset 0 0 8px rgba(0,0,0,0.4)",
              }}
            >
              MAXED TODAY
            </span>
          </div>
        )}
        <div className="relative z-10 flex items-stretch min-h-[140px] sm:min-h-[160px]">
          <div
            className="flex items-center justify-center w-[60px] sm:w-[88px] flex-shrink-0"
            style={{ background: "rgba(0, 0, 0, 0.25)", borderRight: "1px dashed rgba(255, 215, 0, 0.12)" }}
          >
            <div className="games-lot-number font-mono text-[11px] sm:text-[13px] text-cream/35 font-bold">
              lot {lotNumber}
            </div>
          </div>
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
              {g.isNew && !isMaxed && (
                <span
                  className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] px-1.5 py-0.5 rounded-sm"
                  style={{
                    background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                    color: "#04080F",
                    boxShadow: "0 0 12px rgba(255,215,0,0.45), inset 0 1px 0 rgba(255,255,255,0.32)",
                  }}
                >
                  new
                </span>
              )}
              {continuable && !isMaxed && (
                <span
                  className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] px-1.5 py-0.5 rounded-sm"
                  style={{
                    background: hexToRgba(g.color, 0.16),
                    color: g.color,
                    border: `1px solid ${hexToRgba(g.color, 0.45)}`,
                    boxShadow: `0 0 10px ${hexToRgba(g.color, 0.18)}`,
                  }}
                  title="Played recently. Jump back in."
                >
                  continue
                </span>
              )}
            </div>
            <p className="text-cream/45 text-xs sm:text-sm font-syne italic mb-2">
              {isPdf ? "from your PDF" : g.desc}
            </p>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 px-2 py-0.5" style={{ background: "rgba(255, 215, 0, 0.08)", border: "1px solid rgba(255, 215, 0, 0.22)" }}>
                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3.5 h-3.5 object-contain" />
                <span className="font-mono text-[10px] sm:text-[11px] font-bold text-gold">{g.fangs}</span>
              </div>
              {g.limit < 999 && (
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider ${isLastPull && !isMaxed ? "pa-active-swatch inline-block px-1.5 py-0.5 rounded-md" : ""}`}
                  style={
                    isMaxed
                      ? { color: "#FCA5A5" }
                      : isLastPull
                        ? {
                            color: "#FFD700",
                            background: "rgba(255,215,0,0.12)",
                            border: "1px solid rgba(255,215,0,0.4)",
                          }
                        : { color: "rgba(238,244,255,0.4)" }
                  }
                  title={isMaxed ? "Resets at midnight" : isLastPull ? "Last pull of the day" : undefined}
                >
                  {isMaxed ? "0 left · resets at midnight" : `${Math.max(0, remaining)} / ${g.limit} today`}
                </span>
              )}
              {g.limit >= 999 && (
                <span className="font-mono text-[10px] text-cream/40 uppercase tracking-wider">
                  {g.kind === "multi" ? "rooms · invite link" : "unlimited"}
                </span>
              )}
              {(() => {
                if (g.id === "roardle") {
                  const r = getRoardleStats();
                  if (r.played < 2) return null;
                  return (
                    <span className="font-mono text-[10px] tracking-[0.18em] text-cream/55">
                      <span className="text-cream/30">your </span>
                      <span className="tabular-nums">{Math.round((r.won / r.played) * 100)}%</span>
                    </span>
                  );
                }
                if (g.id === "timeline") {
                  const t = getTimelineStats();
                  if (t.perfect === 0) return null;
                  return (
                    <span className="font-mono text-[10px] tracking-[0.18em] text-gold/75">
                      <span className="tabular-nums">{t.perfect}</span>
                      <span className="text-cream/30"> perfect</span>
                    </span>
                  );
                }
                if (g.id === "flashcards") {
                  const f = getFlashcardsStats();
                  if (f.totalKnown < 5) return null;
                  return (
                    <span className="font-mono text-[10px] tracking-[0.18em] text-cream/55">
                      <span className="tabular-nums">{f.totalKnown}</span>
                      <span className="text-cream/30"> known</span>
                    </span>
                  );
                }
                return null;
              })()}
            </div>
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
          <div className="hidden md:flex items-center justify-center w-[110px] flex-shrink-0 pr-2">
            <GameMini id={g.id} />
          </div>
          <div className="flex items-center justify-end flex-shrink-0 pr-4 sm:pr-6">
            <button
              onClick={canPlay ? g.start : undefined}
              disabled={!canPlay || (isPdf && !pdfContent && g.id !== "flashcards")}
              title={isMaxed ? "Daily limit hit — resets at midnight" : undefined}
              className="font-syne font-bold text-xs sm:text-sm px-4 sm:px-6 py-2.5 transition-all active:scale-95 disabled:cursor-not-allowed inline-flex items-center gap-2"
              style={{
                background: isMaxed ? "rgba(60,40,40,0.55)" : g.color,
                color: isMaxed ? "#FCA5A5" : "#fff",
                opacity: !canPlay ? (isMaxed ? 0.9 : 0.2) : 1,
                boxShadow: isMaxed
                  ? "inset 0 0 0 1px rgba(252,165,165,0.4)"
                  : `0 4px 14px ${hexToRgba(g.color, 0.4)}, inset 0 1px 0 rgba(255, 255, 255, 0.18)`,
              }}
            >
              {isMaxed ? (
                <>
                  <span aria-hidden="true">{"⏱"}</span>
                  Maxed
                </>
              ) : continuable ? (
                <>
                  Resume
                  <span aria-hidden="true">{"→"}</span>
                </>
              ) : g.kind === "multi" ? (
                <>
                  Host
                  <span aria-hidden="true">{"→"}</span>
                </>
              ) : (
                <>
                  Pull
                  <span aria-hidden="true">{"→"}</span>
                </>
              )}
            </button>
          </div>
        </div>
        <div className="games-ticket-perf" aria-hidden="true" />
      </div>
    );
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
      <FeatureGate feature="games">
      <div className="min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden relative" style={{ isolation: "isolate" }}>
        {/* Faint orbs keyed to the four game accents — intentional depth */}
        <AmbientOrbs
          orbs={[
            { color: "#EC4899", pos: "top-[12%] right-[14%]", size: 460, opacity: 0.05 },
            { color: "#9B59B6", pos: "top-[48%] left-[10%]", size: 520, opacity: 0.04 },
            { color: "#00BFFF", pos: "bottom-[14%] left-[44%]", size: 440, opacity: 0.04 },
            { color: "#00C851", pos: "bottom-[22%] right-[20%]", size: 380, opacity: 0.035 },
            { color: "#FFD700", pos: "top-[30%] left-[50%]", size: 360, opacity: 0.04 },
          ]}
        />

        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 relative z-10">

          {/* ═══ HEADER — title left, lion crest as a real right-side hero ═══ */}
          <header className="mb-10 animate-slide-up flex items-start justify-between gap-6">
            <div>
              <div className="flex flex-wrap items-center gap-3 mb-2">
                <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/30">
                  private ledger · est. 2026
                </p>
                {(() => {
                  const streak = getArcadeStreak();
                  if (streak < 2) return null;
                  return (
                    <span
                      className="inline-flex items-center gap-1 font-bebas text-[10px] tracking-[0.22em] px-2 py-0.5 rounded-full"
                      style={{
                        background: "linear-gradient(135deg, rgba(249,115,22,0.22) 0%, rgba(255,215,0,0.10) 100%)",
                        border: "1px solid rgba(249,115,22,0.5)",
                        color: "#FDBA74",
                        boxShadow: "0 0 10px rgba(249,115,22,0.18)",
                      }}
                      title={`${streak} consecutive days with at least one ticket pulled`}
                    >
                      <span aria-hidden="true">🔥</span>
                      {streak}-day run
                    </span>
                  );
                })()}
              </div>
              <h1 className="font-bebas text-[clamp(3.5rem,11vw,9rem)] text-cream tracking-tight leading-[0.86]">
                THE<br />ARCADE
              </h1>
              <p className="font-serif italic text-cream/40 text-sm mt-3 max-w-md">
                five lots · two-times Fangs on strong runs · pick one, pull the ticket
              </p>
            </div>
            <div
              className="hidden md:block w-40 lg:w-52 shrink-0 -mt-2 games-lion-breathe"
              aria-hidden="true"
            >
              <img
                src={cdnUrl("/image-name.png")}
                alt=""
                className="w-full h-full object-contain"
                style={{ filter: "drop-shadow(0 0 32px rgba(255,215,0,0.40))" }}
              />
            </div>
          </header>

          {/* Resume prompts for in-flight Roardle / Timeline (Tier 3) — now
              styled as "ticket in progress" stubs matching the Arcade ticket
              aesthetic: perforated left edge, lot number column, accent
              stripe, animated "IN PROGRESS" pulse. */}
          {roardleResume && game === "menu" && (
            <div
              className="games-ticket games-foil mb-4 relative rounded-[6px] overflow-hidden animate-slide-up"
              style={{
                background: `linear-gradient(90deg, ${hexToRgba("#00BFFF", 0.10)} 0%, #0c0a14 60%)`,
                border: `1px solid ${hexToRgba("#00BFFF", 0.4)}`,
                boxShadow: `0 8px 22px rgba(0,0,0,0.4), 0 0 18px ${hexToRgba("#00BFFF", 0.12)}`,
              }}
            >
              <div className="relative z-10 flex items-stretch min-h-[60px]">
                {/* Perforated lot stub */}
                <div
                  className="flex items-center justify-center w-[60px] sm:w-[88px] flex-shrink-0"
                  style={{ background: "rgba(0,0,0,0.25)", borderRight: "1px dashed rgba(0,191,255,0.25)" }}
                >
                  <div className="games-lot-number font-mono text-[10px] sm:text-[12px] text-[#00BFFF]/55 font-bold uppercase tracking-[0.18em]">
                    in play
                  </div>
                </div>
                {/* Icon + content */}
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 sm:px-4 py-2.5">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-sm flex-shrink-0"
                    style={{
                      background: hexToRgba("#00BFFF", 0.14),
                      border: "1px solid rgba(0,191,255,0.4)",
                    }}>
                    <TextAa size={16} weight="fill" className="text-[#00BFFF]" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bebas text-sm text-cream tracking-wider leading-tight">RESUME ROARDLE</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 mt-0.5">
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
                    className="font-syne font-bold text-xs px-4 py-2 transition-all active:scale-95 inline-flex items-center gap-1.5 flex-shrink-0"
                    style={{
                      background: "#00BFFF",
                      color: "#04080F",
                      boxShadow: "0 4px 14px rgba(0,191,255,0.4), inset 0 1px 0 rgba(255,255,255,0.18)",
                    }}
                  >
                    Resume
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRoardleResume(null);
                      void apiPost("/api/quiz/state", { game_type: "roardle", state: null });
                    }}
                    className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/40 hover:text-cream/85 transition-colors flex-shrink-0 hidden sm:inline"
                  >
                    Start fresh
                  </button>
                </div>
              </div>
              <div className="games-ticket-perf" aria-hidden="true" />
            </div>
          )}
          {timelineResume && game === "menu" && (
            <div
              className="games-ticket games-foil mb-4 relative rounded-[6px] overflow-hidden animate-slide-up"
              style={{
                background: `linear-gradient(90deg, ${hexToRgba("#00C851", 0.10)} 0%, #0c0a14 60%)`,
                border: `1px solid ${hexToRgba("#00C851", 0.4)}`,
                boxShadow: `0 8px 22px rgba(0,0,0,0.4), 0 0 18px ${hexToRgba("#00C851", 0.12)}`,
              }}
            >
              <div className="relative z-10 flex items-stretch min-h-[60px]">
                <div
                  className="flex items-center justify-center w-[60px] sm:w-[88px] flex-shrink-0"
                  style={{ background: "rgba(0,0,0,0.25)", borderRight: "1px dashed rgba(0,200,81,0.25)" }}
                >
                  <div className="games-lot-number font-mono text-[10px] sm:text-[12px] text-[#00C851]/55 font-bold uppercase tracking-[0.18em]">
                    in play
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-1 min-w-0 px-3 sm:px-4 py-2.5">
                  <span className="inline-flex items-center justify-center w-8 h-8 rounded-sm flex-shrink-0"
                    style={{
                      background: hexToRgba("#00C851", 0.14),
                      border: "1px solid rgba(0,200,81,0.4)",
                    }}>
                    <Calendar size={16} weight="fill" className="text-[#00C851]" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bebas text-sm text-cream tracking-wider leading-tight">RESUME TIMELINE</p>
                    <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 mt-0.5">
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
                    className="font-syne font-bold text-xs px-4 py-2 transition-all active:scale-95 inline-flex items-center gap-1.5 flex-shrink-0"
                    style={{
                      background: "#00C851",
                      color: "#04080F",
                      boxShadow: "0 4px 14px rgba(0,200,81,0.4), inset 0 1px 0 rgba(255,255,255,0.18)",
                    }}
                  >
                    Resume
                    <span aria-hidden="true">→</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setTimelineResume(null);
                      void apiPost("/api/quiz/state", { game_type: "timeline", state: null });
                    }}
                    className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/40 hover:text-cream/85 transition-colors flex-shrink-0 hidden sm:inline"
                  >
                    Start fresh
                  </button>
                </div>
              </div>
              <div className="games-ticket-perf" aria-hidden="true" />
            </div>
          )}

          {/* ═══ CROSS-GAME STATS STRIP ═══
              Reads localStorage stats from Roardle, Timeline, Flashcards.
              Hidden until at least one game has been played so a cold-start
              user doesn't see a strip of zeros. Single line, mono lowercase
              uppercase mix to read as a ledger entry, not a leaderboard. */}
          {(() => {
            const r = getRoardleStats();
            const tl = getTimelineStats();
            const fc = getFlashcardsStats();
            if (r.played === 0 && tl.played === 0 && fc.sessions === 0) return null;
            return (
              <div
                className="mb-4 rounded-[6px] flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2 animate-slide-up"
                style={{
                  animationDelay: "0.04s",
                  background: "linear-gradient(90deg, rgba(255,215,0,0.04) 0%, rgba(12,10,20,0.45) 60%)",
                  border: "1px solid rgba(255,215,0,0.10)",
                }}
              >
                <span className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/35">your runs</span>
                {r.played > 0 && (
                  <span className="font-mono text-[10px] tracking-[0.18em] text-cream/65">
                    <span className="text-cream/35">roardle </span>
                    <span className="tabular-nums">{r.played}</span>
                    <span className="text-cream/35"> · </span>
                    <span className="tabular-nums">{Math.round((r.won / r.played) * 100)}%</span>
                  </span>
                )}
                {tl.played > 0 && (
                  <span className="font-mono text-[10px] tracking-[0.18em] text-cream/65">
                    <span className="text-cream/35">timeline </span>
                    <span className="tabular-nums">{tl.played}</span>
                    {tl.perfect > 0 && (
                      <>
                        <span className="text-cream/35"> · </span>
                        <span className="tabular-nums text-gold/75">{tl.perfect} perfect</span>
                      </>
                    )}
                  </span>
                )}
                {fc.sessions > 0 && (
                  <span className="font-mono text-[10px] tracking-[0.18em] text-cream/65">
                    <span className="text-cream/35">flashcards </span>
                    <span className="tabular-nums">{fc.totalKnown}</span>
                    <span className="text-cream/35"> known</span>
                  </span>
                )}
              </div>
            );
          })()}

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

          {/* ═══ PDF Upload (Library mode) — now styled as a "blank ticket"
              waiting to be stamped, matching the Arcade ticket aesthetic. ═══ */}
          {tab === "library" && !pdfContent && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <label
                className="games-ticket cursor-pointer block relative rounded-[6px] overflow-hidden"
                style={{
                  background: `linear-gradient(90deg, ${hexToRgba("#FFD700", 0.06)} 0%, #0c0a14 60%)`,
                  border: "1.5px dashed rgba(255,215,0,0.45)",
                  boxShadow: "0 8px 22px rgba(0,0,0,0.35)",
                }}
              >
                <div className="relative z-10 flex items-center gap-4 sm:gap-6 px-5 sm:px-7 py-7">
                  {/* Lot stub */}
                  <div
                    className="hidden sm:flex flex-col items-center justify-center w-[80px] flex-shrink-0 py-3"
                    style={{ borderRight: "1px dashed rgba(255,215,0,0.22)" }}
                  >
                    <FileText size={28} weight="fill" className="text-gold/55 mb-1.5" aria-hidden="true" />
                    <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-gold/45">
                      blank
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="font-bebas text-lg sm:text-xl text-cream tracking-wider leading-tight">
                      UPLOAD YOUR STUDY MATERIAL
                    </p>
                    <p className="text-cream/40 text-xs sm:text-[13px] font-syne mt-1.5">
                      Drop a PDF to stamp this ticket — generate custom games from your notes
                    </p>
                    {pdfProcessing && (
                      <div className="flex items-center gap-2 mt-3">
                        <div className="w-3.5 h-3.5 rounded-full border-2 border-electric border-t-transparent animate-spin" />
                        <span className="text-cream/55 text-xs font-syne">Processing PDF with AI...</span>
                      </div>
                    )}
                    {pdfError && <p className="text-red-400 text-xs mt-2 font-syne">{pdfError}</p>}
                  </div>
                  <span
                    className="font-syne font-bold text-xs sm:text-sm px-4 sm:px-5 py-2.5 transition-all flex-shrink-0 inline-flex items-center gap-1.5"
                    style={{
                      background: "linear-gradient(135deg, #FFD700 0%, #B8960C 100%)",
                      color: "#04080F",
                      boxShadow: "0 4px 14px rgba(255,215,0,0.4), inset 0 1px 0 rgba(255,255,255,0.18)",
                    }}
                  >
                    Choose PDF
                    <span aria-hidden="true">↑</span>
                  </span>
                  <input type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) handlePdfUpload(e.target.files[0]); }} />
                </div>
                <div className="games-ticket-perf" aria-hidden="true" />
              </label>
            </div>
          )}

          {tab === "library" && pdfContent && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div
                className="games-ticket games-foil relative rounded-[6px] overflow-hidden"
                style={{
                  background: `linear-gradient(90deg, ${hexToRgba("#FFD700", 0.08)} 0%, #0c0a14 60%)`,
                  border: "1px solid rgba(255,215,0,0.38)",
                  boxShadow: "0 8px 22px rgba(0,0,0,0.4), 0 0 18px rgba(255,215,0,0.10)",
                }}
              >
                <div className="relative z-10 flex items-stretch min-h-[60px]">
                  <div
                    className="flex items-center justify-center w-[60px] sm:w-[88px] flex-shrink-0"
                    style={{ background: "rgba(0,0,0,0.25)", borderRight: "1px dashed rgba(255,215,0,0.22)" }}
                  >
                    <div className="games-lot-number font-mono text-[10px] sm:text-[12px] text-gold/55 font-bold uppercase tracking-[0.18em]">
                      stamped
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-1 min-w-0 px-3 sm:px-4 py-2.5">
                    <FileText size={22} weight="regular" className="text-gold flex-shrink-0" aria-hidden="true" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bebas text-sm text-cream tracking-wider leading-tight truncate">{pdfName}</p>
                      <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-cream/45 mt-0.5">
                        {pdfContent.vocabulary?.length ?? 0} vocab · {pdfContent.concepts?.length ?? 0} questions · {pdfContent.keyTerms?.length ?? 0} terms
                      </p>
                    </div>
                    <button
                      onClick={() => { setPdfContent(null); setPdfName(null); if (typeof window !== "undefined") { localStorage.removeItem("lionade_pdf_content"); localStorage.removeItem("lionade_pdf_name"); } }}
                      className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/45 hover:text-red-400 transition-colors flex-shrink-0"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <div className="games-ticket-perf" aria-hidden="true" />
              </div>
            </div>
          )}

          {/* ═══ MULTIPLAYER CLUSTER — friend-first CTA above the solo grid.
              These tickets get a chunkier border, a stronger gold ambient
              halo, and a "PLAY TOGETHER" rubric. The reasoning: multiplayer
              is the viral mechanic; if it's buried in a 2×2 grid alongside
              solo flashcards it never gets clicked. ═══ */}
          <div
            className="mb-3 flex items-center gap-3 animate-slide-up"
            style={{ animationDelay: "0.12s" }}
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/85 px-2.5 py-1 rounded-sm"
              style={{
                background: "linear-gradient(90deg, rgba(255,215,0,0.16) 0%, rgba(255,215,0,0.04) 100%)",
                border: "1px solid rgba(255,215,0,0.35)",
                boxShadow: "0 0 14px rgba(255,215,0,0.10)",
              }}
            >
              play together
            </span>
            <span className="font-serif italic text-cream/35 text-xs">
              invite friends · biggest house draws
            </span>
            <div
              aria-hidden="true"
              className="flex-1 h-px"
              style={{
                background: "linear-gradient(90deg, rgba(255,215,0,0.25) 0%, transparent 100%)",
              }}
            />
          </div>

          <div className="games-stack grid grid-cols-1 lg:grid-cols-2 gap-5 mb-8">
            {MULTI_GAMES.map((g, idx) =>
              renderTicket(g, idx, String(idx + 1).padStart(3, "0"), true),
            )}
          </div>

          {/* ═══ SOLO LOTS — single-player tickets. Smaller header rubric,
              regular ticket weight. Lot numbering continues after the multi
              block so it reads as one ledger across the page. ═══ */}
          <div
            className="mb-3 flex items-center gap-3 animate-slide-up"
            style={{ animationDelay: "0.30s" }}
          >
            <span
              className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55 px-2.5 py-1 rounded-sm"
              style={{
                background: "rgba(255,255,255,0.03)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              solo lots
            </span>
            <span className="font-serif italic text-cream/30 text-xs">
              quick pulls · daily limits · big Fang ratios
            </span>
            <div
              aria-hidden="true"
              className="flex-1 h-px"
              style={{
                background: "linear-gradient(90deg, rgba(255,255,255,0.10) 0%, transparent 100%)",
              }}
            />
          </div>

          <div className="games-stack grid grid-cols-1 lg:grid-cols-2 gap-5">
            {SOLO_GAMES.map((g, idx) =>
              renderTicket(g, idx, String(MULTI_GAMES.length + idx + 1).padStart(3, "0"), false),
            )}
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
      </FeatureGate>
    </ProtectedRoute>
  );
}
