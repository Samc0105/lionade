"use client";

import { useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { mutateUserStats } from "@/lib/hooks";
import ProtectedRoute from "@/components/ProtectedRoute";
import BackButton from "@/components/BackButton";
import MultipleChoiceMode from "@/components/Ninny/MultipleChoiceMode";
import { cdnUrl } from "@/lib/cdn";
import type { NinnyDifficulty, NinnyGeneratedContent } from "@/lib/ninny";

type Phase = "input" | "generating" | "play" | "results";
type InputMode = "topic" | "material";

interface Material {
  id: string;
  title: string;
  subject: string | null;
  difficulty: NinnyDifficulty;
  generated_content: NinnyGeneratedContent;
}

interface SessionResult {
  score: number;
  total: number;
  coinsEarned: number;
  xpEarned: number;
}

interface UploadedFile {
  name: string;
  text: string;
}

const NINNY_PURPLE = "#A855F7";

// Same byte-regex extraction as app/games/page.tsx — no PDF lib needed
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

function NinnyPageInner() {
  const router = useRouter();
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [phase, setPhase] = useState<Phase>("input");
  const [inputMode, setInputMode] = useState<InputMode>("topic");
  const [topic, setTopic] = useState("");
  const [text, setText] = useState("");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [difficulty, setDifficulty] = useState<NinnyDifficulty>("medium");
  const [error, setError] = useState<string | null>(null);
  const [material, setMaterial] = useState<Material | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);

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
    try {
      const extracted = isPdf ? await extractPdfText(file) : await file.text();
      if (extracted.length < 50) {
        setError("Couldn't pull enough text from that file. Try a text-based file.");
        return;
      }
      setUploadedFile({ name: file.name, text: extracted.slice(0, 15000) });
    } catch {
      setError("Failed to read file");
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

    try {
      const res = await fetch("/api/ninny/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          sourceType,
          content,
          difficulty,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Generation failed");
        setPhase("input");
        return;
      }
      setMaterial(data.material);
      setPhase("play");
    } catch (e) {
      console.error("[ninny] generate error:", e);
      setError("Network error");
      setPhase("input");
    }
  };

  const handleComplete = async (r: {
    score: number;
    total: number;
    wrongAnswers: { question: string; correctAnswer: string }[];
  }) => {
    if (!user?.id || !material) return;

    try {
      const res = await fetch("/api/ninny/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          materialId: material.id,
          mode: "mcq",
          score: r.score,
          total: r.total,
          wrongAnswers: r.wrongAnswers,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult({
          score: r.score,
          total: r.total,
          coinsEarned: data.coinsEarned ?? 0,
          xpEarned: data.xpEarned ?? 0,
        });
        mutateUserStats(user.id);
      } else {
        setResult({ score: r.score, total: r.total, coinsEarned: 0, xpEarned: 0 });
      }
    } catch (e) {
      console.error("[ninny] complete error:", e);
      setResult({ score: r.score, total: r.total, coinsEarned: 0, xpEarned: 0 });
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

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12 relative overflow-hidden">
      {/* Ambient purple halo behind everything */}
      <div
        className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[600px] pointer-events-none opacity-50"
        style={{
          background:
            "radial-gradient(circle, #A855F722 0%, #A855F70A 35%, transparent 70%)",
        }}
      />

      <div className="max-w-3xl mx-auto relative">
        <BackButton />

        {/* Header — Ninny portrait + greeting */}
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
            {/* Pulsing orbital ring */}
            <div
              className="absolute inset-0 rounded-full animate-pulse"
              style={{ boxShadow: `0 0 0 1px ${NINNY_PURPLE}30` }}
            />
          </div>

          <h1 className="font-bebas text-cream text-4xl sm:text-5xl tracking-wider leading-none mb-2">
            Meet Ninny
          </h1>
          <p
            className="font-syne text-sm sm:text-base max-w-md"
            style={{ color: `${NINNY_PURPLE}CC` }}
          >
            Your AI study companion. Drop a file, paste your notes, or just tell
            me a topic — I&apos;ll turn it into something you can actually study.
          </p>
        </div>

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
              <div
                className="rounded-2xl border bg-white/5 backdrop-blur p-5 mb-5"
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
                  onClick={() => fileInputRef.current?.click()}
                  className="relative rounded-2xl border-2 border-dashed cursor-pointer
                    transition-all duration-200 p-8 text-center group"
                  style={{
                    borderColor: dragActive ? NINNY_PURPLE : `${NINNY_PURPLE}40`,
                    background: dragActive
                      ? `${NINNY_PURPLE}15`
                      : `${NINNY_PURPLE}06`,
                    boxShadow: dragActive
                      ? `0 0 30px ${NINNY_PURPLE}33`
                      : "none",
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

                  {uploadedFile ? (
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
                {!uploadedFile && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-white/10" />
                      <span className="font-syne text-cream/30 text-xs uppercase tracking-widest">
                        or paste
                      </span>
                      <div className="flex-1 h-px bg-white/10" />
                    </div>
                    <div
                      className="rounded-2xl border bg-white/5 backdrop-blur p-5"
                      style={{ borderColor: `${NINNY_PURPLE}25` }}
                    >
                      <textarea
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="Paste your textbook chapter, notes, or anything you want to study..."
                        rows={6}
                        className="w-full bg-transparent text-cream placeholder:text-cream/30 font-syne text-sm resize-none focus:outline-none"
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Difficulty picker */}
            <div className="mb-6">
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

            {/* Generate button — gold */}
            <button
              onClick={handleGenerate}
              className="w-full font-bebas text-lg tracking-wider px-6 py-4 rounded-xl
                transition-all duration-200 active:scale-[0.99] flex items-center justify-center gap-3
                hover:brightness-110"
              style={{
                background: "linear-gradient(135deg, #FFD700 0%, #F0C000 100%)",
                color: "#04080F",
                boxShadow: "0 0 30px rgba(255,215,0,0.3), 0 4px 20px rgba(255,215,0,0.15)",
              }}
            >
              <img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />
              Generate My Study Set
            </button>
          </div>
        )}

        {/* GENERATING PHASE */}
        {phase === "generating" && (
          <div className="text-center py-20 animate-slide-up">
            <div
              className="inline-block w-16 h-16 rounded-full flex items-center justify-center text-4xl mb-6 relative"
              style={{
                background: `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
                boxShadow: `0 0 50px ${NINNY_PURPLE}55`,
              }}
            >
              <span className="animate-pulse">&#x1F916;</span>
            </div>
            <p className="font-bebas text-cream text-3xl tracking-wider mb-2">
              Ninny is thinking...
            </p>
            <p className="text-cream/50 text-sm font-syne">
              Building your study set
            </p>
          </div>
        )}

        {/* PLAY PHASE */}
        {phase === "play" && material && (
          <>
            <div
              className="rounded-xl border bg-white/5 backdrop-blur px-4 py-3 mb-6 flex items-center gap-3 animate-slide-up"
              style={{ borderColor: `${NINNY_PURPLE}25` }}
            >
              <span className="font-bebas text-cream text-base tracking-wide">
                {material.title}
              </span>
              {material.subject && (
                <span
                  className="px-2.5 py-0.5 rounded-full text-xs font-syne font-semibold"
                  style={{
                    background: `${NINNY_PURPLE}20`,
                    border: `1px solid ${NINNY_PURPLE}40`,
                    color: NINNY_PURPLE,
                  }}
                >
                  {material.subject}
                </span>
              )}
              <span className="ml-auto text-cream/40 text-xs font-syne uppercase tracking-wider">
                Multiple Choice
              </span>
            </div>
            <MultipleChoiceMode
              questions={material.generated_content.multipleChoice}
              onComplete={handleComplete}
            />
          </>
        )}

        {/* RESULTS PHASE */}
        {phase === "results" && result && (
          <div className="animate-slide-up text-center pt-8">
            <div
              className="w-20 h-20 rounded-full flex items-center justify-center text-4xl mx-auto mb-5"
              style={{
                background: `radial-gradient(circle, ${NINNY_PURPLE}40 0%, transparent 70%)`,
                boxShadow: `0 0 40px ${NINNY_PURPLE}44`,
              }}
            >
              {result.score === result.total ? "\u{1F389}" : "\u{1F916}"}
            </div>
            <p className="font-bebas text-cream text-5xl sm:text-6xl tracking-wider mb-2">
              {result.score} / {result.total}
            </p>
            <p className="text-cream/60 text-sm font-syne mb-8">
              {result.score === result.total
                ? "Perfect score! Ninny is impressed."
                : result.score >= result.total * 0.7
                ? "Nice work — keep grinding."
                : "Don't sweat it — every miss is a memory."}
            </p>

            <div className="flex justify-center gap-4 mb-10">
              <div className="rounded-2xl border border-gold/30 bg-gold/5 px-6 py-4 flex items-center gap-2.5">
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

            <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto">
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
                  transition-all duration-200 active:scale-[0.99]"
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
        )}
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
