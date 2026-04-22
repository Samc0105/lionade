"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { apiPost, apiGet } from "@/lib/api-client";
import type { MCQQuestion } from "@/lib/ninny";
import BlitzMode from "@/components/Ninny/BlitzMode";
import type { NinnyWrongAnswer } from "@/components/Ninny/MultipleChoiceMode";
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
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";

// ── Types ────────────────────────────────────────────────────

type GameMode = "menu" | "roardle" | "blitz-setup" | "blitz" | "blitz-results" | "flashcards" | "timeline";
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

const BLITZ_RULES: { icon: string | null; Icon?: PhosphorIcon; label: string; desc: string }[] = [
  { icon: "⏱", label: "60 SECONDS", desc: "Race the clock" },
  { icon: null, Icon: Brain, label: "ALL SUBJECTS", desc: "Random mix" },
  { icon: null, Icon: Lightning, label: "2× FANGS", desc: "Per correct answer" },
];

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

const DAILY_LIMITS: Record<string, number> = { roardle: 3, blitz: 99, flashcards: 999, timeline: 3 };

// ── Component ────────────────────────────────────────────────

export default function GamesPage() {
  const { user } = useAuth();
  const { stats, mutate: mutateStats } = useUserStats(user?.id);

  const [tab, setTab] = useState<TabMode>("quickplay");
  const [game, setGame] = useState<GameMode>(() => {
    // Auto-open blitz setup if ?mode=blitz is in the URL
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("mode") === "blitz") {
      return "blitz-setup";
    }
    return "menu";
  });
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

  // Blitz state
  const [blitzQuestions, setBlitzQuestions] = useState<MCQQuestion[]>([]);
  const [blitzLoading, setBlitzLoading] = useState(false);
  const [blitzResult, setBlitzResult] = useState<{ score: number; total: number; wrongAnswers: NinnyWrongAnswer[] } | null>(null);
  const [blitzBest, setBlitzBest] = useState<number>(0);

  // Flashcard state
  const [fcIdx, setFcIdx] = useState(0);
  const [fcFlipped, setFcFlipped] = useState(false);
  const [fcKnew, setFcKnew] = useState(0);
  const [fcTotal, setFcTotal] = useState(0);
  const [fcOver, setFcOver] = useState(false);
  const [fcCards, setFcCards] = useState<{ term: string; def: string }[]>([]);

  // Timeline state
  const [tlEvents, setTlEvents] = useState<typeof TIMELINE_EVENTS>([]);
  const [tlOrder, setTlOrder] = useState<number[]>([]);
  const [tlSubmitted, setTlSubmitted] = useState(false);
  const [tlScore, setTlScore] = useState(0);
  const [dragIdx, setDragIdx] = useState<number | null>(null);

  // Load PDF + blitz best from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("lionade_pdf_content");
      const name = localStorage.getItem("lionade_pdf_name");
      if (saved && name) {
        setPdfContent(JSON.parse(saved));
        setPdfName(name);
      }
      const best = localStorage.getItem("lionade_blitz_best");
      if (best) setBlitzBest(parseInt(best));
    } catch { /* ignore */ }
  }, []);

  // ── Award Fangs ────────────────────────────────────────────
  const awardFangs = useCallback(async (amount: number, gameType: string, _desc: string) => {
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
      awardFangs(baseFangs + bonus, "roardle", `Roardle win (${wordLength} letters, ${newGuesses.length} guesses)`);
    } else if (newGuesses.length >= 6) {
      setRoardleOver(true);
    }
  }, [roardleInput, wordLength, roardleOver, roardleGuesses, roardleWord, awardFangs]);

  // ── Blitz: open setup ───────────────────────────────────────
  const openBlitzSetup = useCallback(() => {
    setFangsEarned(null);
    setBlitzResult(null);
    setGame("blitz-setup");
  }, []);

  // ── Blitz: start game (load random mix questions from API) ──
  const launchBlitz = useCallback(async () => {
    setBlitzLoading(true);
    const res = await apiGet<{ questions: MCQQuestion[] }>("/api/games/blitz/questions");
    if (res.ok && res.data?.questions?.length) {
      setBlitzQuestions(res.data.questions);
      setBlitzResult(null);
      setFangsEarned(null);
      setGame("blitz");
      incrementDailyPlays("blitz");
    } else {
      setBlitzQuestions([]);
    }
    setBlitzLoading(false);
  }, []);

  // ── Blitz: handle completion from BlitzMode component ──────
  const handleBlitzComplete = useCallback(async (result: { score: number; total: number; wrongAnswers: NinnyWrongAnswer[] }) => {
    setBlitzResult(result);
    setGame("blitz-results");

    // Award 2x Fangs per correct answer
    const earned = result.score * 2;
    if (earned > 0) {
      awardFangs(earned, "blitz", `Blitz Sprint — ${result.score} correct`);
    }

    // Update personal best
    if (result.score > blitzBest) {
      setBlitzBest(result.score);
      localStorage.setItem("lionade_blitz_best", String(result.score));
    }
  }, [awardFangs, blitzBest]);

  // ── Start Flashcards ───────────────────────────────────────
  const startFlashcards = useCallback(() => {
    const source = tab === "library" && pdfContent?.vocabulary?.length
      ? pdfContent.vocabulary.map(v => ({ term: v.term, def: v.definition }))
      : [...FLASHCARD_TERMS];

    setFcCards(source.sort(() => Math.random() - 0.5).slice(0, 12));
    setFcIdx(0);
    setFcFlipped(false);
    setFcKnew(0);
    setFcTotal(0);
    setFcOver(false);
    setFangsEarned(null);
    setGame("flashcards");
  }, [tab, pdfContent]);

  const fcAnswer = useCallback((knew: boolean) => {
    if (knew) setFcKnew(k => k + 1);
    setFcTotal(t => t + 1);
    setFcFlipped(false);

    if (fcIdx + 1 < fcCards.length) {
      setTimeout(() => setFcIdx(i => i + 1), 200);
    } else {
      setFcOver(true);
      const pct = (fcKnew + (knew ? 1 : 0)) / fcCards.length;
      const fangs = Math.round(pct * 15);
      if (fangs > 0) awardFangs(fangs, "flashcards", `Flash Cards — ${Math.round(pct * 100)}% known`);
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
    if (correct > 0) awardFangs(correct * 3, "timeline", `Timeline — ${correct}/${tlEvents.length} correct`);
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
  function getLetterStatus(guess: string, target: string, idx: number): "correct" | "present" | "absent" {
    if (guess[idx] === target[idx]) return "correct";
    if (target.includes(guess[idx])) return "present";
    return "absent";
  }

  function getKeyboardStatus(): Record<string, "correct" | "present" | "absent" | "unused"> {
    const map: Record<string, "correct" | "present" | "absent" | "unused"> = {};
    "QWERTYUIOPASDFGHJKLZXCVBNM".split("").forEach(l => map[l] = "unused");
    for (const guess of roardleGuesses) {
      for (let i = 0; i < guess.length; i++) {
        const s = getLetterStatus(guess, roardleWord, i);
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
                return (
                  <div key={row} className="flex justify-center gap-1.5">
                    {Array.from({ length: wordLength }).map((_, col) => {
                      const letter = isCurrentRow ? (roardleInput[col] ?? "") : (guess[col] ?? "");
                      const status = guess ? getLetterStatus(guess, roardleWord, col) : null;
                      return (
                        <div key={col}
                          className="w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center font-bebas text-2xl rounded-lg border transition-all duration-300"
                          style={{
                            background: status ? tileColor(status) : "var(--game-tile-bg, rgba(255,255,255,0.05))",
                            borderColor: status ? "transparent" : isCurrentRow && roardleInput[col] ? "var(--game-tile-active, rgba(255,255,255,0.3))" : "var(--game-tile-border, rgba(255,255,255,0.1))",
                            color: status ? "#fff" : "var(--game-tile-text, #EEF4FF)",
                          }}>
                          {letter}
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

  // ── BLITZ SPRINT ────────────────────────────────────────
  // ── BLITZ SETUP (hype launch screen) ────────────────────
  if (game === "blitz-setup") {
    const plays = getDailyPlays("blitz");
    const remaining = DAILY_LIMITS.blitz - plays;
    const canPlay = remaining > 0;

    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8 overflow-hidden">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
            <button onClick={backToMenu} className="text-cream/30 text-xs mb-4 hover:text-cream/50 transition">← Back to Games</button>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_420px_1fr] gap-6 items-center min-h-[calc(100vh-180px)]">

              {/* ── LEFT SIDE: How it works + tips ── */}
              <div className="hidden lg:flex flex-col gap-4 animate-slide-up" style={{ animationDelay: "0.1s" }}>
                {/* How it works */}
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(255,107,0,0.06) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(255,107,0,0.12)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-4">How It Works</p>
                  <div className="space-y-3">
                    {[
                      { step: "01", text: "Questions from all subjects appear randomly" },
                      { step: "02", text: "Tap the correct answer as fast as you can" },
                      { step: "03", text: "Wrong answers don't end the game — keep going" },
                      { step: "04", text: "When time's up, you earn 2 Fangs per correct answer" },
                    ].map((s, i) => (
                      <div key={i} className="flex items-start gap-3">
                        <span className="font-bebas text-lg tracking-wider shrink-0" style={{ color: "rgba(255,107,0,0.4)" }}>{s.step}</span>
                        <p className="text-cream/40 text-xs font-syne leading-relaxed">{s.text}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Pro tips */}
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(255,215,0,0.04) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(255,215,0,0.1)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-3">Pro Tips</p>
                  <div className="space-y-2">
                    {[
                      { Icon: Target, text: "Speed matters — don't overthink it" },
                      { Icon: Fire, text: "Build streaks for that dopamine hit" },
                      { Icon: BookOpen, text: "Review your mistakes after each round" },
                    ].map((tip, i) => {
                      const TipIcon = tip.Icon;
                      return (
                        <p key={i} className="text-cream/30 text-xs font-syne">
                          <TipIcon size={14} weight="regular" aria-hidden="true" className="inline mr-1.5 -mt-0.5" />
                          {tip.text}
                        </p>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* ── CENTER: Main launch card ── */}
              <div className="relative">
                {/* Outer glow */}
                <div className="absolute -inset-8 rounded-3xl opacity-30 blur-2xl pointer-events-none"
                  style={{ background: "radial-gradient(ellipse, rgba(255,107,0,0.15) 0%, transparent 70%)" }} />

                <div className="relative rounded-3xl p-8 sm:p-10 text-center" style={{
                  background: "linear-gradient(160deg, rgba(255,107,0,0.1) 0%, rgba(10,10,20,0.95) 30%, rgba(10,10,20,0.98) 100%)",
                  border: "1px solid rgba(255,107,0,0.2)",
                  boxShadow: "0 0 60px rgba(255,107,0,0.08), inset 0 1px 0 rgba(255,255,255,0.04)",
                }}>
                  {/* Animated glow behind icon */}
                  <div className="absolute left-1/2 top-12 -translate-x-1/2 w-48 h-48 rounded-full pointer-events-none"
                    style={{ background: "radial-gradient(circle, rgba(255,107,0,0.12) 0%, transparent 70%)", animation: "pulse 3s ease-in-out infinite" }} />

                  <div className="relative">
                    <p className="text-8xl mb-3 flex items-center justify-center" style={{ filter: "drop-shadow(0 0 25px rgba(255,107,0,0.6))" }}>
                      <Lightning size={96} weight="fill" aria-hidden="true" />
                    </p>
                    <h1 className="font-bebas text-6xl sm:text-7xl tracking-wider mb-1"
                      style={{
                        background: "linear-gradient(135deg, #FF6B00 0%, #FFD700 50%, #FF6B00 100%)",
                        WebkitBackgroundClip: "text",
                        WebkitTextFillColor: "transparent",
                        filter: "drop-shadow(0 0 15px rgba(255,107,0,0.3))",
                      }}>
                      BLITZ SPRINT
                    </h1>
                    <p className="text-cream/30 text-sm font-syne mb-8">How many can you get right?</p>

                    {/* Rules row */}
                    <div className="grid grid-cols-3 gap-2 mb-8">
                      {BLITZ_RULES.map((rule, i) => {
                        const RuleIcon = rule.Icon;
                        return (
                          <div key={i} className="rounded-xl py-3 px-2" style={{
                            background: "rgba(255,255,255,0.03)",
                            border: "1px solid rgba(255,107,0,0.1)",
                          }}>
                            <p className="text-xl mb-0.5 flex items-center justify-center">
                              {RuleIcon ? (
                                <RuleIcon size={24} weight="regular" aria-hidden="true" />
                              ) : (
                                rule.icon
                              )}
                            </p>
                            <p className="font-bebas text-[11px] tracking-wider text-cream/70">{rule.label}</p>
                            <p className="text-cream/20 text-[8px] font-syne">{rule.desc}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* Personal best */}
                    {blitzBest > 0 && (
                      <div className="flex justify-center mb-6">
                        <div className="flex items-center gap-2 px-4 py-1.5 rounded-full"
                          style={{ background: "rgba(255,215,0,0.08)", border: "1px solid rgba(255,215,0,0.15)" }}>
                          <Trophy size={14} weight="regular" aria-hidden="true" />
                          <span className="font-bebas text-xs tracking-wider text-gold/60">Best: {blitzBest} correct</span>
                        </div>
                      </div>
                    )}

                    {/* Launch button */}
                    <button
                      onClick={canPlay ? launchBlitz : undefined}
                      disabled={!canPlay || blitzLoading}
                      className="relative w-full font-bebas text-3xl tracking-widest py-5 rounded-2xl transition-all active:scale-[0.97] disabled:opacity-30 disabled:cursor-not-allowed group"
                      style={{
                        background: "linear-gradient(135deg, #FF6B00 0%, #FF8C00 50%, #FFD700 100%)",
                        color: "#fff",
                        boxShadow: canPlay ? "0 0 40px rgba(255,107,0,0.35), 0 8px 30px rgba(0,0,0,0.4)" : undefined,
                      }}>
                      <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                        style={{ boxShadow: "0 0 40px rgba(255,107,0,0.5), inset 0 0 20px rgba(255,255,255,0.08)" }} />
                      {blitzLoading ? (
                        <span className="flex items-center justify-center gap-3 relative z-10">
                          <div className="w-6 h-6 rounded-full border-2 border-white border-t-transparent animate-spin" />
                          LOADING...
                        </span>
                      ) : <span className="relative z-10">START</span>}
                    </button>
                    <p className="text-cream/15 text-[10px] mt-3 font-syne">
                      {!canPlay ? "No plays left today" : `${remaining} play${remaining !== 1 ? "s" : ""} left today`}
                    </p>
                  </div>
                </div>
              </div>

              {/* ── RIGHT SIDE: Stats + rewards ── */}
              <div className="hidden lg:flex flex-col gap-4 animate-slide-up" style={{ animationDelay: "0.15s" }}>
                {/* Rewards breakdown */}
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(255,215,0,0.06) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(255,215,0,0.12)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-4">Rewards</p>
                  <div className="space-y-3">
                    {[
                      { label: "Per correct answer", value: "2", icon: cdnUrl("/F.png") },
                      { label: "Max per game (30 correct)", value: "60", icon: cdnUrl("/F.png") },
                      { label: "Daily plays", value: String(DAILY_LIMITS.blitz), icon: null },
                    ].map((r, i) => (
                      <div key={i} className="flex items-center justify-between">
                        <span className="text-cream/35 text-xs font-syne">{r.label}</span>
                        <div className="flex items-center gap-1">
                          {r.icon && <img src={r.icon} alt="" className="w-3.5 h-3.5 object-contain" />}
                          <span className="font-bebas text-base tracking-wider text-gold/70">{r.value}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Subject coverage */}
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(74,144,217,0.05) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(74,144,217,0.1)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-3">Subjects Mixed</p>
                  <div className="flex flex-wrap gap-2">
                    {([
                      { label: "Biology", Icon: Dna, weight: "regular" as const },
                      { label: "Chemistry", Icon: Flask, weight: "regular" as const },
                      { label: "Physics", Icon: Binoculars, weight: "regular" as const },
                      { label: "Math", Icon: Calculator, weight: "regular" as const },
                      { label: "History", Icon: Scroll, weight: "regular" as const },
                      { label: "Earth Sci", Icon: Globe, weight: "regular" as const },
                      { label: "Social", Icon: Bank, weight: "regular" as const },
                      { label: "Astronomy", Icon: StarFour, weight: "fill" as const },
                    ]).map((s, i) => {
                      const SubjectIcon = s.Icon;
                      return (
                        <span key={i} className="flex items-center gap-1 text-[10px] text-cream/30 font-syne px-2 py-1 rounded-full"
                          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                          <SubjectIcon size={14} weight={s.weight} aria-hidden="true" />
                          {s.label}
                        </span>
                      );
                    })}
                  </div>
                </div>

                {/* Quick stats */}
                <div className="rounded-2xl p-5" style={{
                  background: "linear-gradient(145deg, rgba(168,85,247,0.05) 0%, rgba(255,255,255,0.01) 100%)",
                  border: "1px solid rgba(168,85,247,0.1)",
                }}>
                  <p className="font-bebas text-sm tracking-widest text-cream/30 uppercase mb-3">Your Stats</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="text-center">
                      <p className="font-bebas text-2xl text-cream/60">{stats?.coins ?? 0}</p>
                      <p className="text-cream/20 text-[9px] font-syne">Total Fangs</p>
                    </div>
                    <div className="text-center">
                      <p className="font-bebas text-2xl text-cream/60">{stats?.streak ?? 0}</p>
                      <p className="text-cream/20 text-[9px] font-syne">Day Streak</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ── BLITZ GAME (BlitzMode component) ───────────────────
  if (game === "blitz") {
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-2xl mx-auto px-4 py-6">
            <BlitzMode
              questions={blitzQuestions}
              onComplete={handleBlitzComplete}
            />
          </div>
        </div>
      </ProtectedRoute>
    );
  }

  // ── BLITZ RESULTS ──────────────────────────────────────
  if (game === "blitz-results" && blitzResult) {
    const accuracy = blitzResult.total > 0 ? Math.round((blitzResult.score / blitzResult.total) * 100) : 0;
    const isNewBest = blitzResult.score >= blitzBest && blitzResult.score > 0;

    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">

            {/* Results header */}
            <div className="text-center mb-8 animate-slide-up">
              <span className="text-5xl mb-3 flex items-center justify-center">
                <Lightning size={52} weight="fill" aria-hidden="true" />
              </span>
              <h2 className="font-bebas text-5xl text-cream tracking-wider mb-1">TIME&apos;S UP!</h2>
              {isNewBest && (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full mb-3"
                  style={{ background: "rgba(255,215,0,0.15)", border: "1px solid rgba(255,215,0,0.3)" }}>
                  <span className="text-gold text-xs font-bold">NEW PERSONAL BEST!</span>
                </div>
              )}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-3 gap-3 mb-6 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,215,0,0.2)" }}>
                <p className="font-bebas text-4xl text-gold">{blitzResult.score}</p>
                <p className="text-cream/30 text-[10px] uppercase tracking-wider">Correct</p>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-bebas text-4xl text-cream">{blitzResult.total}</p>
                <p className="text-cream/30 text-[10px] uppercase tracking-wider">Attempted</p>
              </div>
              <div className="rounded-xl p-4 text-center" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)" }}>
                <p className="font-bebas text-4xl" style={{ color: accuracy >= 80 ? "#22C55E" : accuracy >= 50 ? "#FBBF24" : "#EF4444" }}>{accuracy}%</p>
                <p className="text-cream/30 text-[10px] uppercase tracking-wider">Accuracy</p>
              </div>
            </div>

            {/* Fangs earned */}
            {fangsEarned !== null && fangsEarned > 0 && (
              <div className="flex items-center justify-center gap-2 mb-6 animate-slide-up" style={{ animationDelay: "0.15s" }}>
                <div className="flex items-center gap-2 px-5 py-2.5 rounded-xl" style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.25)" }}>
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
                  <span className="font-bebas text-2xl text-gold tracking-wider">+{fangsEarned}</span>
                  <span className="text-gold/40 text-xs ml-1">earned</span>
                </div>
              </div>
            )}

            {/* Wrong answers review */}
            {blitzResult.wrongAnswers.length > 0 && (
              <div className="mb-6 animate-slide-up" style={{ animationDelay: "0.2s" }}>
                <p className="font-bebas text-sm text-cream/40 tracking-widest uppercase mb-3">
                  Review Mistakes ({blitzResult.wrongAnswers.length})
                </p>
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {blitzResult.wrongAnswers.map((wa, i) => (
                    <div key={i} className="rounded-xl p-3" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.15)" }}>
                      <p className="text-cream text-xs font-semibold mb-1.5">{wa.question}</p>
                      <div className="flex flex-wrap gap-2 text-[10px]">
                        <span className="text-red-400">Your answer: {wa.userAnswer}</span>
                        <span className="text-green-400">Correct: {wa.correctAnswer}</span>
                      </div>
                      {wa.explanation && (
                        <p className="text-cream/25 text-[10px] mt-1">{wa.explanation}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-3 justify-center animate-slide-up" style={{ animationDelay: "0.25s" }}>
              <button onClick={() => { setBlitzResult(null); setGame("blitz-setup"); }}
                className="font-bebas text-lg tracking-wider px-8 py-3 rounded-xl transition-all active:scale-95"
                style={{ background: "linear-gradient(135deg, #FF6B00 0%, #FF8C00 100%)", color: "#fff" }}>
                Play Again
              </button>
              <button onClick={backToMenu}
                className="font-bebas text-lg tracking-wider px-8 py-3 rounded-xl transition-all active:scale-95"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)", color: "rgba(238,244,255,0.5)" }}>
                Games Menu
              </button>
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
    { id: "blitz" as GameMode, name: "BLITZ SPRINT", Icon: Lightning, desc: "60s rapid fire Q&A", fangs: "2×", limit: DAILY_LIMITS.blitz, start: openBlitzSetup, color: "#FF6B00", pos: "top-0 right-0" },
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
    if (id === "blitz") {
      return <Lightning size={40} weight="fill" color="#FF6B00" className="blitz-mini" aria-hidden="true" />;
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
    return null;
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden relative">
        {/* Small lion crest — demoted from center-mascot to corner watermark */}
        <div
          className="hidden md:block absolute top-24 right-10 w-28 h-28 opacity-40 pointer-events-none games-lion-breathe z-0"
          aria-hidden="true"
        >
          <img
            src="/image-name.png"
            alt=""
            className="w-full h-full object-contain"
            style={{ filter: "drop-shadow(0 0 18px rgba(255,215,0,0.35))" }}
          />
        </div>

        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 relative z-10">

          {/* ═══ HEADER — "The Arcade" private-catalog feel ═══ */}
          <header className="mb-10 animate-slide-up">
            <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/30 mb-2">
              private ledger · est. 2026
            </p>
            <h1 className="font-bebas text-[clamp(4rem,14vw,11rem)] text-cream tracking-tight leading-[0.86]">
              THE<br />ARCADE
            </h1>
            <p className="font-serif italic text-cream/40 text-sm mt-3 max-w-md">
              four lots · two-times Fangs on strong runs · pick one, pull the ticket
            </p>
          </header>

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

          {/* ═══ TICKET STACK — 4 wide luxury tickets, vertical, with foil sheen ═══ */}
          <div className="games-stack space-y-5 animate-slide-up" style={{ animationDelay: "0.15s" }}>
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
                  className="games-ticket games-foil relative rounded-[6px] overflow-hidden"
                  style={{
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

          {/* Footer tag for the page */}
          <p className="font-serif italic text-cream/20 text-xs text-center mt-10">
            house rules: no Fangs without effort · draw resets at midnight
          </p>
        </div>
      </div>
    </ProtectedRoute>
  );
}
