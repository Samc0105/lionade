"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import ProtectedRoute from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { useUserStats, mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { apiPost } from "@/lib/api-client";

// ── Types ────────────────────────────────────────────────────

type GameMode = "menu" | "roardle" | "blitz" | "flashcards" | "timeline";
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

const BLITZ_QUESTIONS = [
  { q: "What organelle is the powerhouse of the cell?", a: "Mitochondria", opts: ["Mitochondria", "Nucleus", "Ribosome", "Golgi body"] },
  { q: "What is the chemical symbol for gold?", a: "Au", opts: ["Au", "Ag", "Go", "Gd"] },
  { q: "What planet is closest to the sun?", a: "Mercury", opts: ["Mercury", "Venus", "Mars", "Earth"] },
  { q: "What is the formula for water?", a: "H2O", opts: ["H2O", "CO2", "NaCl", "O2"] },
  { q: "How many chromosomes do humans have?", a: "46", opts: ["46", "23", "48", "44"] },
  { q: "What gas do plants absorb?", a: "Carbon dioxide", opts: ["Carbon dioxide", "Oxygen", "Nitrogen", "Hydrogen"] },
  { q: "What is Newton's first law about?", a: "Inertia", opts: ["Inertia", "Gravity", "Friction", "Momentum"] },
  { q: "What is the pH of pure water?", a: "7", opts: ["7", "0", "14", "1"] },
  { q: "What bone protects the brain?", a: "Skull", opts: ["Skull", "Spine", "Ribs", "Pelvis"] },
  { q: "What type of rock is formed from lava?", a: "Igneous", opts: ["Igneous", "Sedimentary", "Metamorphic", "Mineral"] },
  { q: "What is the largest organ in the human body?", a: "Skin", opts: ["Skin", "Liver", "Brain", "Heart"] },
  { q: "What particle has a positive charge?", a: "Proton", opts: ["Proton", "Electron", "Neutron", "Photon"] },
  { q: "What layer of Earth is liquid?", a: "Outer core", opts: ["Outer core", "Inner core", "Mantle", "Crust"] },
  { q: "What is the speed of light in m/s?", a: "3×10⁸", opts: ["3×10⁸", "3×10⁶", "3×10¹⁰", "3×10⁴"] },
  { q: "DNA stands for?", a: "Deoxyribonucleic acid", opts: ["Deoxyribonucleic acid", "Dinitrogen acid", "Dioxin nucleic acid", "Deoxynuclear acid"] },
  { q: "What is the smallest unit of matter?", a: "Atom", opts: ["Atom", "Molecule", "Cell", "Proton"] },
  { q: "What vitamin does sunlight give?", a: "Vitamin D", opts: ["Vitamin D", "Vitamin C", "Vitamin A", "Vitamin B"] },
  { q: "What is the hardest natural substance?", a: "Diamond", opts: ["Diamond", "Quartz", "Topaz", "Ruby"] },
  { q: "What is the process of cell division?", a: "Mitosis", opts: ["Mitosis", "Meiosis", "Osmosis", "Diffusion"] },
  { q: "How many elements in the periodic table?", a: "118", opts: ["118", "108", "92", "126"] },
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

const DAILY_LIMITS: Record<string, number> = { roardle: 3, blitz: 5, flashcards: 999, timeline: 3 };

// ── Component ────────────────────────────────────────────────

export default function GamesPage() {
  const { user } = useAuth();
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

  // Blitz state
  const [blitzTime, setBlitzTime] = useState(60);
  const [blitzIdx, setBlitzIdx] = useState(0);
  const [blitzCorrect, setBlitzCorrect] = useState(0);
  const [blitzStreak, setBlitzStreak] = useState(0);
  const [blitzOver, setBlitzOver] = useState(false);
  const [blitzQuestions, setBlitzQuestions] = useState<typeof BLITZ_QUESTIONS>([]);
  const blitzTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  // Load PDF from localStorage on mount
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

  // ── Start Blitz ────────────────────────────────────────────
  const startBlitz = useCallback(() => {
    const source = tab === "library" && pdfContent?.concepts?.length
      ? pdfContent.concepts.map(c => ({ q: c.question, a: c.answer, opts: c.options }))
      : [...BLITZ_QUESTIONS];

    const shuffled = source.sort(() => Math.random() - 0.5);
    setBlitzQuestions(shuffled);
    setBlitzIdx(0);
    setBlitzCorrect(0);
    setBlitzStreak(0);
    setBlitzTime(60);
    setBlitzOver(false);
    setFangsEarned(null);
    setGame("blitz");
    incrementDailyPlays("blitz");

    blitzTimerRef.current = setInterval(() => {
      setBlitzTime(prev => {
        if (prev <= 1) {
          if (blitzTimerRef.current) clearInterval(blitzTimerRef.current);
          setBlitzOver(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, [tab, pdfContent]);

  const answerBlitz = useCallback((answer: string) => {
    if (blitzOver || !blitzQuestions[blitzIdx]) return;
    const correct = answer === blitzQuestions[blitzIdx].a;
    if (correct) {
      setBlitzCorrect(c => c + 1);
      setBlitzStreak(s => s + 1);
    } else {
      setBlitzStreak(0);
    }
    if (blitzIdx + 1 < blitzQuestions.length) {
      setBlitzIdx(i => i + 1);
    } else {
      if (blitzTimerRef.current) clearInterval(blitzTimerRef.current);
      setBlitzOver(true);
    }
  }, [blitzOver, blitzQuestions, blitzIdx]);

  useEffect(() => {
    if (blitzOver && blitzCorrect > 0) {
      awardFangs(blitzCorrect * 2, "blitz", `Blitz Sprint — ${blitzCorrect} correct`);
    }
  }, [blitzOver, blitzCorrect, awardFangs]);

  useEffect(() => {
    return () => { if (blitzTimerRef.current) clearInterval(blitzTimerRef.current); };
  }, []);

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
    if (blitzTimerRef.current) clearInterval(blitzTimerRef.current);
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
  if (game === "blitz") {
    const currentQ = blitzQuestions[blitzIdx];
    return (
      <ProtectedRoute>
        <div className="min-h-screen pt-16 pb-8">
          <div className="max-w-lg mx-auto px-4 py-6">
            <button onClick={backToMenu} className="text-cream/40 text-sm mb-4 hover:text-cream/60 transition">← Back</button>

            {!blitzOver ? (
              <>
                {/* Timer + Score */}
                <div className="flex items-center justify-between mb-6">
                  <div className="font-bebas text-4xl" style={{ color: blitzTime > 20 ? "#4A90D9" : blitzTime > 10 ? "#EAB308" : "#EF4444" }}>
                    {blitzTime}s
                  </div>
                  <div className="text-right">
                    <p className="font-bebas text-2xl text-cream">{blitzCorrect}</p>
                    <p className="text-cream/30 text-[10px] uppercase tracking-wider">correct</p>
                  </div>
                </div>

                {/* Streak */}
                {blitzStreak >= 3 && (
                  <div className="text-center mb-3">
                    <span className="text-gold font-bebas text-sm tracking-wider">🔥 {blitzStreak}x STREAK</span>
                  </div>
                )}

                {/* Question */}
                {currentQ && (
                  <>
                    <div className="rounded-xl p-5 mb-4 text-center" style={{ background: "var(--game-card-bg, rgba(255,255,255,0.04))", border: "1px solid var(--game-card-border, rgba(255,255,255,0.08))" }}>
                      <p className="text-cream font-semibold text-base leading-relaxed">{currentQ.q}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      {currentQ.opts.map((opt, i) => (
                        <button key={i} onClick={() => answerBlitz(opt)}
                          className="p-4 rounded-xl text-sm font-semibold text-left transition-all active:scale-95"
                          style={{ background: "var(--game-card-bg, rgba(255,255,255,0.04))", border: "1px solid var(--game-card-border, rgba(255,255,255,0.08))", color: "var(--game-tile-text, #EEF4FF)" }}>
                          {opt}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <div className="text-center animate-slide-up">
                <h2 className="font-bebas text-4xl text-cream tracking-wider mb-2">TIME&apos;S UP!</h2>
                <p className="font-bebas text-6xl text-gold mb-2">{blitzCorrect}</p>
                <p className="text-cream/40 text-sm mb-4">correct answers</p>
                {fangsEarned !== null && (
                  <div className="flex items-center justify-center gap-1.5 mb-6">
                    <img src={cdnUrl("/F.png")} alt="Fangs" className="w-5 h-5 object-contain" />
                    <span className="font-bebas text-xl text-gold">+{fangsEarned}</span>
                  </div>
                )}
                <button onClick={backToMenu} className="btn-gold px-6 py-2 rounded-lg text-sm">Play Again</button>
              </div>
            )}
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
                      <span className="text-lg">{isCorrect ? "✓" : "✗"}</span>
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

  const GAMES = [
    { id: "roardle" as GameMode, name: "ROARDLE", icon: "🔤", desc: "Guess the science word", fangs: `${wordLength === 4 ? 10 : wordLength === 5 ? 15 : 20}+`, limit: DAILY_LIMITS.roardle, start: startRoardle, color: "#00BFFF", pos: "top-0 left-0" },
    { id: "blitz" as GameMode, name: "BLITZ SPRINT", icon: "⚡", desc: "60s rapid fire Q&A", fangs: "2×", limit: DAILY_LIMITS.blitz, start: startBlitz, color: "#FF6B00", pos: "top-0 right-0" },
    { id: "flashcards" as GameMode, name: "FLASH CARDS", icon: "🃏", desc: "Flip, learn, repeat", fangs: "15", limit: DAILY_LIMITS.flashcards, start: startFlashcards, color: "#9B59B6", pos: "bottom-0 left-0" },
    { id: "timeline" as GameMode, name: "TIMELINE DROP", icon: "📅", desc: "Order events in time", fangs: "3×", limit: DAILY_LIMITS.timeline, start: startTimeline, color: "#00C851", pos: "bottom-0 right-0" },
  ];

  // Helper to build rgba from hex
  const hexToRgba = (hex: string, a: number) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  };

  return (
    <ProtectedRoute>
      <div className="min-h-screen pt-16 pb-20 md:pb-8 overflow-hidden">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-8">

          {/* ═══ HEADER ═══ */}
          <div className="text-center mb-6 animate-slide-up">
            <h1 className="font-bebas text-6xl sm:text-8xl text-cream tracking-wider leading-none mb-2">
              GAMES
            </h1>
            <p className="text-cream/35 text-sm font-syne">Study smarter. Earn Fangs. Have fun.</p>
          </div>

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
                {t === "quickplay" ? "⚡ QUICK PLAY" : "📚 MY LIBRARY"}
              </button>
            ))}
          </div>

          {/* ═══ PDF Upload (Library mode) ═══ */}
          {tab === "library" && !pdfContent && (
            <div className="mb-8 animate-slide-up" style={{ animationDelay: "0.1s" }}>
              <div className="rounded-2xl p-8 text-center" style={{ background: "rgba(255,255,255,0.02)", border: "2px dashed rgba(255,255,255,0.1)" }}>
                <span className="text-4xl block mb-3">📄</span>
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
                <span className="text-2xl">📄</span>
                <div className="flex-1 min-w-0">
                  <p className="text-cream font-semibold text-sm truncate">{pdfName}</p>
                  <p className="text-cream/30 text-[10px]">{pdfContent.vocabulary?.length ?? 0} vocab · {pdfContent.concepts?.length ?? 0} questions · {pdfContent.keyTerms?.length ?? 0} terms</p>
                </div>
                <button onClick={() => { setPdfContent(null); setPdfName(null); if (typeof window !== "undefined") { localStorage.removeItem("lionade_pdf_content"); localStorage.removeItem("lionade_pdf_name"); } }}
                  className="text-cream/30 text-xs hover:text-red-400 transition">Remove</button>
              </div>
            </div>
          )}

          {/* ═══ DIAGONAL LAYOUT: LION CENTER + 4 GAME CARDS ═══ */}
          <div className="relative animate-slide-up" style={{ animationDelay: "0.15s" }}>

            {/* Desktop: diagonal layout */}
            <div className="hidden sm:block relative" style={{ height: "760px" }}>

              {/* ── CENTER: Lion Mascot ── */}
              <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
                <div className="games-lion-breathe">
                  <img src="/image-name.png" alt="Lionade Mascot" className="w-[320px] h-[320px] object-contain" style={{ filter: "drop-shadow(0 0 25px rgba(0,150,255,0.7))" }} />
                </div>
              </div>

              {/* ── 4 Game Cards positioned diagonally ── */}
              {GAMES.map((g, idx) => {
                const positions = [
                  { top: 0, left: 0 },           // top-left
                  { top: 0, right: 0 },           // top-right
                  { bottom: 0, left: 0 },         // bottom-left
                  { bottom: 0, right: 0 },        // bottom-right
                ];
                const pos = positions[idx];
                const plays = getDailyPlays(g.id);
                const remaining = g.limit - plays;
                const canPlay = remaining > 0 || g.limit >= 999;
                const isPdf = tab === "library";

                return (
                  <div key={g.id} className="absolute game-card-electric group"
                    style={{
                      ...pos,
                      width: 300,
                      ["--electric-color" as string]: g.color,
                      ["--electric-rgb" as string]: `${parseInt(g.color.slice(1,3),16)},${parseInt(g.color.slice(3,5),16)},${parseInt(g.color.slice(5,7),16)}`,
                    }}>
                    <div className="relative rounded-2xl p-6 transition-all duration-300 group-hover:-translate-y-1 overflow-hidden h-full"
                      style={{
                        background: `linear-gradient(145deg, ${hexToRgba(g.color, 0.08)} 0%, #0d0d14 40%)`,
                        border: `1px solid ${hexToRgba(g.color, 0.2)}`,
                        minHeight: 220,
                      }}>

                      {/* Electric border animation */}
                      <div className="absolute inset-0 rounded-2xl pointer-events-none game-electric-border"
                        style={{ ["--electric-color" as string]: g.color }} />

                      {/* Corner sparks */}
                      <svg className="absolute top-2 right-2 w-5 h-5 opacity-40 group-hover:opacity-80 transition-opacity" viewBox="0 0 16 16">
                        <path d="M8 0 L9 6 L16 8 L9 10 L8 16 L7 10 L0 8 L7 6 Z" fill={g.color} />
                      </svg>

                      <div className="relative z-10">
                        <div className="flex items-start justify-between mb-3">
                          <span className="text-4xl">{g.icon}</span>
                          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: "rgba(255,215,0,0.1)", border: "1px solid rgba(255,215,0,0.15)" }}>
                            <img src={cdnUrl("/F.png")} alt="Fangs" className="w-4 h-4 object-contain" />
                            <span className="text-gold text-xs font-bold">{g.fangs}</span>
                          </div>
                        </div>

                        <p className="font-bebas text-3xl tracking-wider mb-1" style={{ color: g.color }}>{g.name}</p>
                        <p className="text-cream/30 text-xs mb-4 font-syne">{isPdf ? `From PDF` : g.desc}</p>

                        {/* Roardle word length selector */}
                        {g.id === "roardle" && (
                          <div className="flex gap-2 mb-4">
                            {[4, 5, 6].map(len => (
                              <button key={len} onClick={() => setWordLength(len)}
                                className="transition-all duration-200 active:scale-90"
                                style={wordLength === len ? {
                                  width: 40, height: 40, borderRadius: "50%",
                                  background: g.color, color: "#fff",
                                  fontSize: "14px", fontWeight: 800, border: "none",
                                  boxShadow: `0 4px 14px ${hexToRgba(g.color, 0.5)}`,
                                } : {
                                  width: 40, height: 40, borderRadius: "50%",
                                  background: "rgba(255,255,255,0.05)", color: "rgba(238,244,255,0.3)",
                                  fontSize: "14px", fontWeight: 700, border: "1px solid rgba(255,255,255,0.1)",
                                }}>
                                {len}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="flex items-center justify-between">
                          <button onClick={canPlay ? g.start : undefined}
                            disabled={!canPlay || (isPdf && !pdfContent && g.id !== "flashcards")}
                            className="font-syne font-bold text-sm px-6 py-2.5 rounded-xl transition-all active:scale-95 disabled:opacity-20 disabled:cursor-not-allowed"
                            style={{ background: g.color, color: "#fff", boxShadow: `0 4px 16px ${hexToRgba(g.color, 0.35)}` }}>
                            Play
                          </button>
                          {g.limit < 999 && <span className="text-cream/20 text-[10px] font-syne">{Math.max(0, remaining)} left today</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Mobile: stacked layout with lion on top */}
            <div className="sm:hidden">
              <div className="flex justify-center mb-6">
                <div className="games-lion-breathe">
                  <img src="/image-name.png" alt="Lionade Mascot" className="w-[240px] h-[240px] object-contain" style={{ filter: "drop-shadow(0 0 20px rgba(0,150,255,0.6))" }} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {GAMES.map(g => {
                  const plays = getDailyPlays(g.id);
                  const remaining = g.limit - plays;
                  const canPlay = remaining > 0 || g.limit >= 999;
                  const isPdf = tab === "library";
                  return (
                    <div key={g.id} className="rounded-2xl p-4 game-card-electric group"
                      style={{
                        background: `linear-gradient(145deg, ${hexToRgba(g.color, 0.08)} 0%, #0d0d14 40%)`,
                        border: `1px solid ${hexToRgba(g.color, 0.2)}`,
                        ["--electric-color" as string]: g.color,
                      }}>
                      <span className="text-xl block mb-1">{g.icon}</span>
                      <p className="font-bebas text-base tracking-wider mb-0.5" style={{ color: g.color }}>{g.name}</p>
                      <p className="text-cream/25 text-[9px] mb-2 font-syne">{isPdf ? "PDF" : g.desc}</p>
                      {g.id === "roardle" && (
                        <div className="flex gap-1 mb-2">
                          {[4, 5, 6].map(len => (
                            <button key={len} onClick={() => setWordLength(len)}
                              className="text-[9px] font-bold transition-all active:scale-90"
                              style={wordLength === len ? {
                                width: 24, height: 24, borderRadius: "50%", background: g.color, color: "#fff", border: "none",
                              } : {
                                width: 24, height: 24, borderRadius: "50%", background: "rgba(255,255,255,0.05)", color: "rgba(238,244,255,0.3)", border: "1px solid rgba(255,255,255,0.1)",
                              }}>
                              {len}
                            </button>
                          ))}
                        </div>
                      )}
                      <button onClick={canPlay ? g.start : undefined}
                        disabled={!canPlay || (isPdf && !pdfContent && g.id !== "flashcards")}
                        className="font-syne font-bold text-[10px] px-3 py-1 rounded-lg disabled:opacity-20"
                        style={{ background: g.color, color: "#fff" }}>
                        Play
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </ProtectedRoute>
  );
}
