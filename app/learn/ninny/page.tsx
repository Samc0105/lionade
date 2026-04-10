"use client";

import { useState, useCallback, useRef, useMemo } from "react";
import { useRouter } from "next/navigation";
import useSWR from "swr";
import { useAuth } from "@/lib/auth";
import { mutateUserStats } from "@/lib/hooks";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import MultipleChoiceMode, {
  type NinnyWrongAnswer,
} from "@/components/Ninny/MultipleChoiceMode";
import { cdnUrl } from "@/lib/cdn";
import {
  NINNY_DAILY_LIMIT,
  NINNY_FREE_PER_DAY,
  NINNY_FANG_COSTS,
} from "@/lib/ninny";
import type {
  NinnyDifficulty,
  NinnyGeneratedContent,
  NinnySourceType,
} from "@/lib/ninny";
import { apiPost, swrFetcher } from "@/lib/api-client";

type Phase = "input" | "generating" | "play" | "results";
type InputMode = "topic" | "material";

interface Material {
  id: string;
  title: string;
  subject: string | null;
  difficulty: NinnyDifficulty;
  generated_content: NinnyGeneratedContent;
  created_at?: string;
}

interface SessionResult {
  score: number;
  total: number;
  coinsEarned: number;
  xpEarned: number;
  wrongAnswers: NinnyWrongAnswer[];
}

interface UploadedFile {
  name: string;
  text: string;
}

interface MaterialsResponse {
  materials: Material[];
  todayCount: number;
  dailyLimit: number;
  dailyRemaining: number;
  freeRemaining: number;
  freePerDay: number;
  fangCosts: Record<NinnySourceType, number>;
  userCoins: number;
  selectedSubjects: string[];
}

const NINNY_PURPLE = "#A855F7";
const TEXT_LIMIT = 12000;

// 7 study modes — only MCQ is wired in Phase 1
const STUDY_MODES = [
  { key: "mcq", icon: "\u{1F3AF}", label: "Multiple Choice", active: true },
  { key: "flashcards", icon: "\u{1F4C7}", label: "Flashcards", active: false },
  { key: "match", icon: "\u{1F517}", label: "Match", active: false },
  { key: "fill", icon: "\u{270F}\u{FE0F}", label: "Fill Blank", active: false },
  { key: "tf", icon: "\u{2696}\u{FE0F}", label: "True/False", active: false },
  { key: "ordering", icon: "\u{1F4CB}", label: "Ordering", active: false },
  { key: "blitz", icon: "\u{26A1}", label: "Blitz", active: false },
] as const;

// Static fallback topic suggestions used when user has no selected subjects
const FALLBACK_TOPICS = [
  "The American Revolution",
  "Photosynthesis",
  "Recursion in JavaScript",
  "Supply and demand",
  "World War II Pacific theater",
  "Cellular respiration",
];

// Map subject categories → suggested study prompts
const SUBJECT_TOPIC_HINTS: Record<string, string[]> = {
  Math: ["Quadratic equations", "Derivatives intro"],
  Science: ["Mitosis vs meiosis", "Newton's laws of motion"],
  Languages: ["Spanish past tense", "French articles"],
  Humanities: ["Ancient Rome's fall", "Renaissance art"],
  "Tech & Coding": ["Big O notation", "React hooks"],
  "Cloud & IT": ["AWS S3 basics", "DNS records"],
  "Finance & Business": ["Compound interest", "Supply and demand"],
  "Test Prep": ["SAT geometry tips", "AP Bio enzymes"],
};

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(arrayBuffer);
  const decoder = new TextDecoder("utf-8", { fatal: false });
  const raw = decoder.decode(uint8);

  let text = "";
  const textMatches = raw.match(/\(([^)]{2,})\)/g);
  if (textMatches) {
    text = textMatches.map((m) => m.slice(1, -1)).join(" ");
  }
  if (text.length < 100) {
    text = raw.replace(/[^\x20-\x7E\n]/g, " ").replace(/\s+/g, " ").trim();
  }
  return text;
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return `${Math.floor(days / 7)}w ago`;
}


function NinnyPageInner() {
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("input");
  const [inputMode, setInputMode] = useState<InputMode>("topic");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [extractingFile, setExtractingFile] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [difficulty, setDifficulty] = useState<NinnyDifficulty>("medium");
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [comingSoonToast, setComingSoonToast] = useState<string | null>(null);

  // Fetch recent materials, daily count, and user's selected subjects
  const { data: meta, mutate: refreshMeta } = useSWR<MaterialsResponse>(
    user?.id ? "/api/ninny/materials" : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const dailyRemaining = meta?.dailyRemaining ?? NINNY_DAILY_LIMIT;
  const freeRemaining = meta?.freeRemaining ?? NINNY_FREE_PER_DAY;
  const userCoins = meta?.userCoins ?? 0;
  const fangCosts = meta?.fangCosts ?? NINNY_FANG_COSTS;
  const dailyCapReached = dailyRemaining <= 0;

  // Determine the source type the user is about to generate with
  const currentSourceType: NinnySourceType =
    inputMode === "topic"
      ? "topic"
      : uploadedFile?.name.toLowerCase().endsWith(".pdf")
      ? "pdf"
      : "text";
  const currentCost = freeRemaining > 0 ? 0 : fangCosts[currentSourceType];
  const isFreeNow = freeRemaining > 0;
  const canAfford = isFreeNow || userCoins >= currentCost;
  const blocked = dailyCapReached || !canAfford;

  // Build personalized topic suggestions: 2 from selected subjects + 4 fallbacks
  const topicSuggestions = useMemo(() => {
    const personalized: string[] = [];
    for (const s of meta?.selectedSubjects ?? []) {
      const hints = SUBJECT_TOPIC_HINTS[s];
      if (hints && hints.length) personalized.push(hints[0]);
      if (personalized.length >= 2) break;
    }
    const combined = [...personalized, ...FALLBACK_TOPICS];
    return Array.from(new Set(combined)).slice(0, 6);
  }, [meta?.selectedSubjects]);

  const handleFile = useCallback(async (file: File) => {
    setError(null);
    const isPdf = file.name.toLowerCase().endsWith(".pdf");
    const isTxt = file.name.toLowerCase().endsWith(".txt");
    if (!isPdf && !isTxt) {
      setError("Only .pdf and .txt files are accepted");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("File too large (max 10 MB)");
      return;
    }
    setExtractingFile(true);
    try {
      const extracted = isPdf ? await extractPdfText(file) : await file.text();
      if (extracted.length < 50) {
        setError("Couldn't pull enough text from that file. Try a text-based file.");
        return;
      }
      setUploadedFile({ name: file.name, text: extracted.slice(0, 15000) });
    } catch {
      setError("Failed to read file");
    } finally {
      setExtractingFile(false);
    }
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      setDragActive(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleGenerate = async () => {
    if (!user?.id) return;
    if (dailyCapReached) {
      setError(`Daily cap reached (${meta?.dailyLimit ?? NINNY_DAILY_LIMIT}). Come back tomorrow!`);
      return;
    }
    if (!isFreeNow && !canAfford) {
      setError(`Need ${currentCost} Fangs (you have ${userCoins}). Play quizzes to earn more.`);
      return;
    }

    let sourceType: "topic" | "text" | "pdf";
    let content: string;

    if (inputMode === "topic") {
      sourceType = "topic";
      content = topic.trim();
      if (!content) {
        setError("Tell Ninny what to study");
        return;
      }
    } else if (uploadedFile) {
      sourceType = uploadedFile.name.toLowerCase().endsWith(".pdf") ? "pdf" : "text";
      content = uploadedFile.text;
    } else {
      sourceType = "text";
      content = text.trim();
      if (!content) {
        setError("Drop a file or paste some material");
        return;
      }
      if (content.length < 50) {
        setError("Paste at least 50 characters");
        return;
      }
    }

    setError(null);
    setPhase("generating");

    const res = await apiPost<{ material: Material }>("/api/ninny/generate", {
      sourceType,
      content,
      difficulty,
    });
    if (!res.ok || !res.data?.material) {
      setError(res.error ?? "Generation failed");
      setPhase("input");
      return;
    }
    setMaterial(res.data.material);
    refreshMeta();
    setPhase("play");
  };

  const handleRestudy = (m: Material) => {
    setMaterial(m);
    setPhase("play");
  };

  const handleComplete = async (r: {
    score: number;
    total: number;
    wrongAnswers: NinnyWrongAnswer[];
  }) => {
    if (!user?.id || !material) return;

    const res = await apiPost<{ coinsEarned: number; xpEarned: number }>(
      "/api/ninny/complete",
      {
        materialId: material.id,
        mode: "mcq",
        score: r.score,
        total: r.total,
        // API expects bare {question, correctAnswer} — explanation is UI-only
        wrongAnswers: r.wrongAnswers.map((w) => ({
          question: w.question,
          correctAnswer: w.correctAnswer,
        })),
      },
    );
    if (res.ok && res.data) {
      setResult({
        score: r.score,
        total: r.total,
        coinsEarned: res.data.coinsEarned ?? 0,
        xpEarned: res.data.xpEarned ?? 0,
        wrongAnswers: r.wrongAnswers,
      });
      mutateUserStats(user.id);
    } else {
      setResult({
        score: r.score,
        total: r.total,
        coinsEarned: 0,
        xpEarned: 0,
        wrongAnswers: r.wrongAnswers,
      });
    }
    setPhase("results");
  };

  const handleRestart = () => {
    setPhase("input");
    setMaterial(null);
    setResult(null);
    setTopic("");
    setText("");
    setUploadedFile(null);
    setError(null);
  };

  // Retake the same set without re-generating
  const handleRetake = () => {
    if (!material) return;
    setResult(null);
    setPhase("play");
  };

  const handleExitQuiz = () => {
    if (
      typeof window !== "undefined" &&
      !window.confirm("Exit this study set? Your progress will be lost.")
    ) {
      return;
    }
    setMaterial(null);
    setPhase("input");
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12 relative overflow-hidden">
      {/* Ambient purple halo */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] pointer-events-none opacity-50"
        style={{
          background:
            "radial-gradient(circle, #A855F722 0%, #A855F70A 35%, transparent 70%)",
        }}
      />

      {/* Coming-soon toast */}
      {comingSoonToast && (
        <div
          className="fixed top-20 left-1/2 -translate-x-1/2 z-50 animate-slide-up rounded-full px-4 py-2 border backdrop-blur"
          style={{
            background: `${NINNY_PURPLE}25`,
            borderColor: `${NINNY_PURPLE}60`,
            boxShadow: `0 0 30px ${NINNY_PURPLE}55`,
          }}
        >
          <p className="font-syne text-cream text-xs font-semibold">
            {comingSoonToast}
          </p>
        </div>
      )}

      <div className="max-w-3xl mx-auto relative">
        <BackButton />

        {/* Full header — input phase only */}
        {phase === "input" && (
          <div className="flex flex-col items-center text-center mt-6 mb-8 animate-slide-up">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-5xl mb-4 relative"
              style={{
                background:
                  "radial-gradient(circle at 40% 35%, #A855F740 0%, #A855F710 60%, transparent 100%)",
                boxShadow: `0 0 50px ${NINNY_PURPLE}33, 0 0 0 1px ${NINNY_PURPLE}44, inset 0 0 20px ${NINNY_PURPLE}15`,
              }}
            >
              <span className="relative z-10">&#x1F916;</span>
              <div
                className="absolute inset-0 rounded-full animate-pulse"
                style={{ boxShadow: `0 0 0 1px ${NINNY_PURPLE}30` }}
              />
            </div>

            <h1 className="font-bebas text-cream text-4xl sm:text-5xl tracking-wider leading-none mb-2">
              Meet Ninny
            </h1>
            <p
              className="font-syne text-sm sm:text-base max-w-md leading-relaxed"
              style={{ color: `${NINNY_PURPLE}CC` }}
            >
              Your AI study companion. Drop a file, paste notes, or name a topic.
              I&apos;ll turn it into a study set.
            </p>
          </div>
        )}

        {/* Compact label — non-input phases */}
        {phase !== "input" && (
          <div className="flex items-center gap-2 mt-4 mb-6 animate-slide-up">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center text-base"
              style={{
                background: `${NINNY_PURPLE}20`,
                boxShadow: `0 0 0 1px ${NINNY_PURPLE}40`,
              }}
            >
              <span>&#x1F916;</span>
            </div>
            <span
              className="font-bebas text-sm tracking-widest uppercase"
              style={{ color: NINNY_PURPLE }}
            >
              Ninny
            </span>
          </div>
        )}

        {/* INPUT PHASE */}
        {phase === "input" && (
          <div className="animate-slide-up">
            {/* Speech bubble greeting */}
            <div
              className="relative rounded-2xl border px-5 py-4 mb-6"
              style={{
                background: `linear-gradient(135deg, ${NINNY_PURPLE}10 0%, ${NINNY_PURPLE}05 100%)`,
                borderColor: `${NINNY_PURPLE}30`,
              }}
            >
              <div
                className="absolute -top-2 left-8 w-4 h-4 rotate-45 border-l border-t"
                style={{
                  background: `${NINNY_PURPLE}10`,
                  borderColor: `${NINNY_PURPLE}30`,
                }}
              />
              <p className="font-syne text-cream/90 text-sm leading-relaxed">
                <span className="font-bold" style={{ color: NINNY_PURPLE }}>
                  Hey {user?.username ?? "there"}.
                </span>{" "}
                What are we studying today? I work best with{" "}
                <span className="text-cream">specific topics</span>,{" "}
                <span className="text-cream">PDF chapters</span>, or{" "}
                <span className="text-cream">your raw notes</span>.
              </p>
            </div>

            {/* Input mode toggle */}
            <div className="flex gap-2 mb-5">
              <button
                onClick={() => setInputMode("topic")}
                className="flex-1 px-4 py-3 rounded-xl font-syne text-sm font-semibold transition-all duration-200"
                style={
                  inputMode === "topic"
                    ? {
                        background: `${NINNY_PURPLE}20`,
                        border: `1px solid ${NINNY_PURPLE}60`,
                        color: "#EEF4FF",
                        boxShadow: `0 0 20px ${NINNY_PURPLE}25`,
                      }
                    : {
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(238,244,255,0.5)",
                      }
                }
              >
                <span className="block text-base mb-0.5">&#x1F4AC;</span>
                Tell Me a Topic
              </button>
              <button
                onClick={() => setInputMode("material")}
                className="flex-1 px-4 py-3 rounded-xl font-syne text-sm font-semibold transition-all duration-200"
                style={
                  inputMode === "material"
                    ? {
                        background: `${NINNY_PURPLE}20`,
                        border: `1px solid ${NINNY_PURPLE}60`,
                        color: "#EEF4FF",
                        boxShadow: `0 0 20px ${NINNY_PURPLE}25`,
                      }
                    : {
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.08)",
                        color: "rgba(238,244,255,0.5)",
                      }
                }
              >
                <span className="block text-base mb-0.5">&#x1F4C4;</span>
                Upload or Paste
              </button>
            </div>

            {/* Topic input */}
            {inputMode === "topic" && (
              <>
                <div
                  className="rounded-2xl border bg-white/5 backdrop-blur p-5 mb-3"
                  style={{ borderColor: `${NINNY_PURPLE}25` }}
                >
                  <input
                    type="text"
                    value={topic}
                    onChange={(e) => setTopic(e.target.value)}
                    placeholder="e.g. The American Revolution, photosynthesis, recursion..."
                    className="w-full bg-transparent text-cream placeholder:text-cream/30 font-syne text-base focus:outline-none"
                  />
                </div>

                {/* Quick-start chips */}
                <div className="mb-5">
                  <p className="font-bebas text-cream/40 text-[10px] tracking-widest mb-2 uppercase">
                    Quick start
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {topicSuggestions.map((s) => (
                      <button
                        key={s}
                        onClick={() => setTopic(s)}
                        className="px-3 py-1.5 rounded-full font-syne text-xs transition-all duration-200
                          border bg-white/5 hover:bg-white/10 text-cream/70 hover:text-cream
                          active:scale-95"
                        style={{ borderColor: `${NINNY_PURPLE}25` }}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Material input — file drop + paste */}
            {inputMode === "material" && (
              <div className="space-y-3 mb-5">
                {/* File drop zone */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragActive(true);
                  }}
                  onDragLeave={() => setDragActive(false)}
                  onDrop={onDrop}
                  onClick={() => !extractingFile && fileInputRef.current?.click()}
                  className="relative rounded-2xl border-2 border-dashed cursor-pointer
                    transition-all duration-200 p-8 text-center group"
                  style={{
                    borderColor: dragActive ? NINNY_PURPLE : `${NINNY_PURPLE}40`,
                    background: dragActive ? `${NINNY_PURPLE}15` : `${NINNY_PURPLE}06`,
                    boxShadow: dragActive ? `0 0 30px ${NINNY_PURPLE}33` : "none",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFile(file);
                    }}
                  />

                  {extractingFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <div
                        className="w-6 h-6 rounded-full border-2 animate-spin"
                        style={{
                          borderColor: `${NINNY_PURPLE}30`,
                          borderTopColor: NINNY_PURPLE,
                        }}
                      />
                      <p className="font-syne text-cream/70 text-sm">
                        Reading file...
                      </p>
                    </div>
                  ) : uploadedFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <span className="text-3xl">&#x1F4C4;</span>
                      <div className="text-left">
                        <p className="font-syne font-semibold text-cream text-sm truncate max-w-[280px]">
                          {uploadedFile.name}
                        </p>
                        <p className="text-cream/40 text-xs">
                          {(uploadedFile.text.length / 1000).toFixed(1)}k characters extracted
                        </p>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploadedFile(null);
                        }}
                        className="ml-2 w-7 h-7 rounded-full bg-white/10 hover:bg-white/20
                          flex items-center justify-center text-cream/60 hover:text-cream
                          transition-all"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <>
                      <div
                        className="text-4xl mb-3 transition-transform duration-200 group-hover:scale-110"
                        style={{ color: NINNY_PURPLE }}
                      >
                        &#x1F4E5;
                      </div>
                      <p className="font-bebas text-cream text-lg tracking-wider mb-1">
                        Drop a PDF or TXT file
                      </p>
                      <p className="font-syne text-cream/50 text-xs">
                        or click to browse · max 10 MB
                      </p>
                    </>
                  )}
                </div>

                {/* Or paste */}
                {!uploadedFile && !extractingFile && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="font-syne text-cream/30 text-xs uppercase tracking-widest">
                        or paste
                      </span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                    <div
                      className="rounded-2xl border bg-white/5 backdrop-blur p-5 relative"
                      style={{ borderColor: `${NINNY_PURPLE}25` }}
                    >
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value.slice(0, TEXT_LIMIT))}
                        placeholder="Paste your textbook chapter, notes, or anything you want to study..."
                        rows={6}
                        className="w-full bg-transparent text-cream placeholder:text-cream/30 font-syne text-sm resize-none focus:outline-none"
                      />
                      <div className="flex justify-end mt-1">
                        <span
                          className="font-syne text-[10px] tracking-wide"
                          style={{
                            color:
                              text.length > TEXT_LIMIT * 0.9
                                ? "#FFD700"
                                : "rgba(238,244,255,0.3)",
                          }}
                        >
                          {text.length.toLocaleString()} / {TEXT_LIMIT.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Difficulty picker */}
            <div className="mb-5">
              <p className="font-bebas text-cream/60 text-xs tracking-widest mb-2.5">
                CHALLENGE LEVEL
              </p>
              <div className="flex gap-2">
                {(["easy", "medium", "hard"] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setDifficulty(d)}
                    className="flex-1 px-4 py-2.5 rounded-xl font-syne text-sm font-semibold uppercase tracking-wider transition-all"
                    style={
                      difficulty === d
                        ? {
                            background: "rgba(255,215,0,0.15)",
                            border: "1px solid rgba(255,215,0,0.45)",
                            color: "#FFD700",
                            boxShadow: "0 0 18px rgba(255,215,0,0.18)",
                          }
                        : {
                            background: "rgba(255,255,255,0.04)",
                            border: "1px solid rgba(255,255,255,0.08)",
                            color: "rgba(238,244,255,0.4)",
                          }
                    }
                  >
                    {d}
                  </button>
                ))}
              </div>
            </div>

            {/* Mode preview — what Ninny will create */}
            <div className="mb-5">
              <p className="font-bebas text-cream/60 text-xs tracking-widest mb-2.5">
                NINNY WILL BUILD
              </p>
              <div className="flex flex-wrap gap-1.5">
                {STUDY_MODES.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => {
                      if (m.active) return;
                      setComingSoonToast(`${m.label} is coming in Phase 2`);
                      window.setTimeout(() => setComingSoonToast(null), 2400);
                    }}
                    disabled={m.active}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border font-syne text-[11px] transition-all"
                    style={
                      m.active
                        ? {
                            background: `${NINNY_PURPLE}15`,
                            borderColor: `${NINNY_PURPLE}40`,
                            color: "#EEF4FF",
                            cursor: "default",
                          }
                        : {
                            background: "rgba(255,255,255,0.03)",
                            borderColor: "rgba(255,255,255,0.06)",
                            color: "rgba(238,244,255,0.3)",
                            cursor: "pointer",
                          }
                    }
                  >
                    <span>{m.icon}</span>
                    <span>{m.label}</span>
                    {!m.active && (
                      <span className="text-[8px] uppercase tracking-wider opacity-60">
                        soon
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Pricing card */}
            <div
              className="rounded-2xl border bg-white/5 backdrop-blur p-4 mb-4"
              style={{ borderColor: `${NINNY_PURPLE}20` }}
            >
              <div className="flex items-center justify-between mb-2.5">
                <p className="font-bebas text-cream/60 text-[10px] tracking-widest uppercase">
                  Pricing
                </p>
                <div className="flex items-center gap-1.5 text-xs font-syne">
                  <img src={cdnUrl("/F.png")} alt="" className="w-3.5 h-3.5 object-contain" />
                  <span className="text-cream/80 font-bold">{userCoins.toLocaleString()}</span>
                  <span className="text-cream/40">balance</span>
                </div>
              </div>

              {isFreeNow ? (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: `${NINNY_PURPLE}15`, border: `1px solid ${NINNY_PURPLE}40` }}
                >
                  <span className="text-base">&#x1F381;</span>
                  <span className="font-syne text-cream text-sm">
                    <span className="font-bold" style={{ color: NINNY_PURPLE }}>1 free</span>{" "}
                    generation today — any mode
                  </span>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {(["topic", "text", "pdf"] as const).map((st) => {
                    const cost = fangCosts[st];
                    const isCurrent = currentSourceType === st;
                    const labelMap = { topic: "Topic", text: "Text", pdf: "PDF" };
                    return (
                      <div
                        key={st}
                        className="rounded-lg border px-2 py-1.5 text-center"
                        style={{
                          background: isCurrent ? `${NINNY_PURPLE}15` : "rgba(255,255,255,0.03)",
                          borderColor: isCurrent
                            ? `${NINNY_PURPLE}50`
                            : "rgba(255,255,255,0.08)",
                        }}
                      >
                        <p className="font-bebas text-[9px] uppercase tracking-wider text-cream/50 mb-0.5">
                          {labelMap[st]}
                        </p>
                        <div className="flex items-center justify-center gap-1">
                          <img
                            src={cdnUrl("/F.png")}
                            alt=""
                            className="w-3 h-3 object-contain"
                          />
                          <span
                            className="font-bebas text-sm tracking-wider"
                            style={{
                              color: isCurrent ? "#FFD700" : "rgba(238,244,255,0.7)",
                            }}
                          >
                            {cost}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <p className="font-syne text-cream/30 text-[10px] mt-2.5 text-center">
                {dailyCapReached
                  ? "Daily cap reached"
                  : `${dailyRemaining} of ${meta?.dailyLimit ?? NINNY_DAILY_LIMIT} generations left today`}
              </p>
            </div>

            {error && (
              <div
                className="rounded-xl border px-4 py-3 mb-4 animate-slide-up"
                style={{
                  background: "rgba(239,68,68,0.08)",
                  borderColor: "rgba(239,68,68,0.3)",
                }}
              >
                <p className="text-red-400 text-sm font-syne">{error}</p>
              </div>
            )}

            <button
              onClick={handleGenerate}
              disabled={blocked}
              className="w-full font-bebas text-lg tracking-wider px-6 py-4 rounded-xl
                transition-all duration-200 active:scale-[0.99] flex items-center justify-center gap-3
                hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:brightness-100"
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
                color: "#04080F",
                boxShadow: blocked
                  ? "none"
                  : "0 0 30px rgba(255,215,0,0.3), 0 4px 20px rgba(255,215,0,0.15)",
              }}
            >
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
              {dailyCapReached
                ? "Come Back Tomorrow"
                : isFreeNow
                ? "Generate My Study Set (Free)"
                : !canAfford
                ? `Need ${currentCost} Fangs`
                : `Generate · ${currentCost} Fangs`}
            </button>

            {/* Need-fangs hint */}
            {!isFreeNow && !canAfford && !dailyCapReached && (
              <button
                onClick={() => router.push("/quiz")}
                className="w-full mt-3 font-syne text-xs text-cream/60 hover:text-cream
                  underline underline-offset-4 transition-colors"
              >
                Earn more Fangs by playing quizzes →
              </button>
            )}

            {/* Recent materials strip */}
            {meta && meta.materials.length > 0 && (
              <div className="mt-10 animate-slide-up">
                <p className="font-bebas text-cream/60 text-xs tracking-widest mb-3">
                  YOUR RECENT STUDY SETS
                </p>
                <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 scroll-smooth">
                  {meta.materials.map((m) => (
                    <button
                      key={m.id}
                      onClick={() => handleRestudy(m)}
                      className="shrink-0 w-56 text-left rounded-xl border bg-white/5 backdrop-blur
                        p-4 transition-all duration-200 hover:bg-white/10 hover:-translate-y-0.5
                        active:scale-[0.99]"
                      style={{ borderColor: `${NINNY_PURPLE}20` }}
                    >
                      <p className="font-bebas text-cream text-sm tracking-wide truncate mb-1.5">
                        {m.title}
                      </p>
                      <div className="flex items-center gap-2 mb-2">
                        {m.subject && (
                          <span
                            className="px-1.5 py-0.5 rounded text-[9px] font-syne font-semibold uppercase tracking-wider"
                            style={{
                              background: `${NINNY_PURPLE}15`,
                              color: NINNY_PURPLE,
                            }}
                          >
                            {m.subject}
                          </span>
                        )}
                        <span className="text-cream/30 text-[10px] font-syne">
                          {m.created_at ? timeAgo(m.created_at) : ""}
                        </span>
                      </div>
                      <p className="text-cream/40 text-[10px] font-syne uppercase tracking-wider">
                        Tap to restudy
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* GENERATING PHASE */}
        {phase === "generating" && (
          <div className="text-center py-24 animate-slide-up">
            <div
              className="inline-flex items-center justify-center w-20 h-20 rounded-full text-5xl mb-6 relative"
              style={{
                background: `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
                boxShadow: `0 0 60px ${NINNY_PURPLE}66`,
              }}
            >
              <span className="animate-pulse">&#x1F916;</span>
              <div
                className="absolute inset-0 rounded-full animate-ping"
                style={{ boxShadow: `0 0 0 2px ${NINNY_PURPLE}30` }}
              />
            </div>
            <p className="font-bebas text-cream text-3xl tracking-wider mb-2">
              Ninny is thinking...
            </p>
            <p className="text-cream/50 text-sm font-syne">
              Building 10 multiple-choice questions
            </p>
          </div>
        )}

        {/* PLAY PHASE */}
        {phase === "play" && material && (
          <>
            <div
              className="rounded-xl border bg-white/5 backdrop-blur px-4 py-3 mb-3 flex items-center gap-3 animate-slide-up flex-wrap"
              style={{ borderColor: `${NINNY_PURPLE}25` }}
            >
              <span className="font-bebas text-cream text-base tracking-wide truncate">
                {material.title}
              </span>
              {material.subject && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-[10px] font-syne font-semibold uppercase tracking-wider"
                  style={{
                    background: `${NINNY_PURPLE}20`,
                    border: `1px solid ${NINNY_PURPLE}40`,
                    color: NINNY_PURPLE,
                  }}
                >
                  {material.subject}
                </span>
              )}
              {/* Mode chip */}
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border"
                style={{
                  background: "rgba(255,215,0,0.08)",
                  borderColor: "rgba(255,215,0,0.3)",
                }}
              >
                <span className="text-xs">&#x1F3AF;</span>
                <span className="font-syne text-gold text-[10px] font-semibold uppercase tracking-wider">
                  Multiple Choice
                </span>
              </div>
              {/* Exit button */}
              <button
                onClick={handleExitQuiz}
                className="ml-auto w-7 h-7 rounded-full bg-white/5 hover:bg-white/10
                  flex items-center justify-center text-cream/50 hover:text-cream
                  border border-white/10 transition-all"
                aria-label="Exit study set"
                title="Exit study set"
              >
                ×
              </button>
            </div>
            <p className="text-cream/30 text-[10px] font-syne text-center mb-6 uppercase tracking-wider">
              6 more study modes coming soon
            </p>
            <MultipleChoiceMode
              questions={material.generated_content.multipleChoice}
              onComplete={handleComplete}
            />
          </>
        )}

        {/* RESULTS PHASE */}
        {phase === "results" && result && (() => {
          const isPerfect = result.score === result.total;
          const accuracy = result.total > 0 ? result.score / result.total : 0;
          return (
            <div className="animate-slide-up text-center pt-4">
              {/* Trophy / robot avatar — celebratory if perfect */}
              <div
                className="w-24 h-24 rounded-full inline-flex items-center justify-center text-5xl mx-auto mb-5 relative"
                style={{
                  background: isPerfect
                    ? "radial-gradient(circle, rgba(255,215,0,0.45) 0%, transparent 70%)"
                    : `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
                  boxShadow: isPerfect
                    ? "0 0 80px rgba(255,215,0,0.6), 0 0 0 2px rgba(255,215,0,0.5)"
                    : `0 0 40px ${NINNY_PURPLE}44`,
                }}
              >
                <span className={isPerfect ? "animate-pulse" : ""}>
                  {isPerfect ? "\u{1F3C6}" : "\u{1F916}"}
                </span>
                {isPerfect && (
                  <div
                    className="absolute inset-0 rounded-full animate-ping"
                    style={{ boxShadow: "0 0 0 3px rgba(255,215,0,0.5)" }}
                  />
                )}
              </div>

              <p
                className="font-bebas text-6xl sm:text-7xl tracking-wider mb-2"
                style={{
                  color: isPerfect ? "#FFD700" : "#EEF4FF",
                  textShadow: isPerfect ? "0 0 30px rgba(255,215,0,0.5)" : "none",
                }}
              >
                {result.score} / {result.total}
              </p>
              <p className="text-cream/60 text-sm font-syne mb-8">
                {isPerfect
                  ? "PERFECT SCORE! Ninny is impressed."
                  : accuracy >= 0.7
                  ? "Nice work — keep grinding."
                  : "Don't sweat it — every miss is a memory."}
              </p>

              {/* Reward chips */}
              <div className="flex justify-center gap-4 mb-8">
                <div
                  className="rounded-2xl border border-gold/30 bg-gold/5 px-6 py-4 flex items-center gap-2.5"
                  style={isPerfect ? { boxShadow: "0 0 25px rgba(255,215,0,0.25)" } : {}}
                >
                  <img src={cdnUrl("/F.png")} alt="Fangs" className="w-8 h-8 object-contain" />
                  <span className="font-bebas text-gold text-2xl tracking-wider">
                    +{result.coinsEarned}
                  </span>
                </div>
                <div
                  className="rounded-2xl border px-6 py-4 flex items-center gap-2.5"
                  style={{
                    borderColor: `${NINNY_PURPLE}40`,
                    background: `${NINNY_PURPLE}08`,
                  }}
                >
                  <span className="font-bebas text-base tracking-wider" style={{ color: NINNY_PURPLE }}>
                    XP
                  </span>
                  <span className="font-bebas text-2xl tracking-wider" style={{ color: NINNY_PURPLE }}>
                    +{result.xpEarned}
                  </span>
                </div>
              </div>

              {/* Wrong answers review */}
              {result.wrongAnswers.length > 0 && (
                <div className="text-left mb-8">
                  <p className="font-bebas text-cream/60 text-xs tracking-widest mb-3 uppercase">
                    What You Missed ({result.wrongAnswers.length})
                  </p>
                  <div className="space-y-2">
                    {result.wrongAnswers.map((w, i) => (
                      <div
                        key={i}
                        className="rounded-xl border bg-white/5 backdrop-blur p-4"
                        style={{ borderColor: "rgba(239,68,68,0.2)" }}
                      >
                        <p className="font-syne text-cream text-sm mb-2 leading-snug">
                          {w.question}
                        </p>
                        <div className="flex flex-col gap-1 text-xs font-syne">
                          <p className="text-red-400/80">
                            <span className="text-cream/40 mr-1.5 uppercase tracking-wider text-[9px]">
                              Your answer
                            </span>
                            {w.userAnswer}
                          </p>
                          <p className="text-green-400/90">
                            <span className="text-cream/40 mr-1.5 uppercase tracking-wider text-[9px]">
                              Correct
                            </span>
                            {w.correctAnswer}
                          </p>
                        </div>
                        {w.explanation && (
                          <p className="mt-2 pt-2 border-t border-white/5 text-cream/60 text-xs font-syne italic leading-relaxed">
                            {w.explanation}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex flex-col sm:flex-row gap-3 max-w-2xl mx-auto">
                <button
                  onClick={handleRetake}
                  className="flex-1 font-syne font-bold text-sm px-6 py-3 rounded-xl
                    border bg-white/5 text-cream hover:bg-white/10
                    transition-all duration-200 active:scale-[0.99]"
                  style={{ borderColor: `${NINNY_PURPLE}30` }}
                >
                  &#x21BA; Retake This Set
                </button>
                <button
                  onClick={handleRestart}
                  className="flex-1 font-syne font-bold text-sm px-6 py-3 rounded-xl
                    border border-white/10 bg-white/5 text-cream hover:bg-white/10
                    transition-all duration-200 active:scale-[0.99]"
                >
                  Study Something Else
                </button>
                <button
                  onClick={() => router.push("/learn")}
                  className="flex-1 font-bebas text-base tracking-wider px-6 py-3 rounded-xl
                    transition-all duration-200 active:scale-[0.99] hover:brightness-110"
                  style={{
                    background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
                    color: "#04080F",
                    boxShadow: "0 0 20px rgba(255,215,0,0.25)",
                  }}
                >
                  Back to Learn
                </button>
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

export default function NinnyPage() {
  return (
    <ProtectedRoute>
      <NinnyPageInner />
    </ProtectedRoute>
  );
}
