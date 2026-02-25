"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

/* ── Constants ──────────────────────────────────────────────────── */

const RESERVED_USERNAMES = ["admin", "root", "lionade", "support", "help", "ninny"];

const DEFAULT_AVATARS = [
  { emoji: "\u{1F981}", bg: "#FFD700" },   // lion
  { emoji: "\u{1F42F}", bg: "#FF8C00" },   // tiger
  { emoji: "\u{1F98A}", bg: "#E74C3C" },   // fox
  { emoji: "\u{1F43A}", bg: "#6B7280" },   // wolf
  { emoji: "\u{1F985}", bg: "#4A90D9" },   // eagle
  { emoji: "\u{1F432}", bg: "#22C55E" },   // dragon
  { emoji: "\u{1F98B}", bg: "#A855F7" },   // butterfly
  { emoji: "\u{1F988}", bg: "#0891B2" },   // shark
  { emoji: "\u{1F525}", bg: "#F97316" },   // fire
  { emoji: "\u26A1",    bg: "#EAB308" },   // lightning
];

const STUDY_GOALS = [
  { label: "Improve my grades", icon: "\u{1F4DA}" },
  { label: "Prepare for SAT / ACT / GRE", icon: "\u{1F3AF}" },
  { label: "Study for certifications", icon: "\u{1F4DC}" },
  { label: "Learn coding and tech skills", icon: "\u{1F4BB}" },
  { label: "General knowledge", icon: "\u{1F9E0}" },
  { label: "Compete and win rewards", icon: "\u{1F3C6}" },
];

const SUBJECTS = [
  { label: "Math", icon: "\u{1F522}", color: "#EF4444" },
  { label: "Science", icon: "\u{1F52C}", color: "#22C55E" },
  { label: "Languages", icon: "\u{1F30D}", color: "#3B82F6" },
  { label: "SAT/ACT", icon: "\u{1F4DD}", color: "#A855F7" },
  { label: "Coding", icon: "\u{1F4BB}", color: "#6B7280" },
  { label: "Finance", icon: "\u{1F4B0}", color: "#EAB308" },
  { label: "Certifications", icon: "\u{1F4DC}", color: "#F97316" },
];

const DAILY_TARGETS = [
  { minutes: 5,  label: "5 min",  desc: "Quick daily check-in" },
  { minutes: 10, label: "10 min", desc: "Build a habit" },
  { minutes: 15, label: "15 min", desc: "Solid daily grind" },
  { minutes: 30, label: "30 min", desc: "Serious student" },
  { minutes: 60, label: "60 min", desc: "Power grinder" },
];

const STEPS = [
  { n: 1, label: "Identity" },
  { n: 2, label: "Goal" },
  { n: 3, label: "Subjects" },
  { n: 4, label: "Target" },
];

const inputCls =
  "w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3.5 text-cream placeholder-cream/25 text-sm font-medium focus:outline-none focus:border-electric focus:bg-electric/5 transition-all";

/* ── Page ───────────────────────────────────────────────────────── */

export default function OnboardingPage() {
  const { user, isLoading, refreshUser } = useAuth();
  const router = useRouter();

  // Email signup users arrive with ?step=2 — read once on mount
  const [minStep] = useState(() => {
    if (typeof window === "undefined") return 1;
    const p = new URLSearchParams(window.location.search);
    return parseInt(p.get("step") ?? "1", 10);
  });
  const [step, setStep] = useState(minStep);
  const [ready, setReady] = useState(false);

  // Step 1
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [selectedAvatarIdx, setSelectedAvatarIdx] = useState<number | null>(null); // null = google pic
  const [googleAvatarUrl, setGoogleAvatarUrl] = useState<string | null>(null);

  // Step 2
  const [studyGoal, setStudyGoal] = useState("");

  // Step 3
  const [selectedSubjects, setSelectedSubjects] = useState<string[]>([]);

  // Step 4
  const [dailyTarget, setDailyTarget] = useState(0);

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  /* ── Auth guard + pre-fill ──────────────────────────────────── */
  useEffect(() => {
    if (isLoading) return;
    if (!user) { router.replace("/login"); return; }

    let cancelled = false;

    (async () => {
      // Check onboarding status
      const { data: profile } = await supabase
        .from("profiles")
        .select("onboarding_completed, username, display_name, avatar_url")
        .eq("id", user.id)
        .maybeSingle();

      if (cancelled) return;

      if (profile?.onboarding_completed) {
        router.replace("/dashboard");
        return;
      }

      // Pre-fill from Google metadata
      const { data: { session } } = await supabase.auth.getSession();
      const meta = session?.user?.user_metadata ?? {};

      if (!cancelled) {
        setDisplayName(
          meta.full_name ?? meta.name ?? profile?.display_name ?? ""
        );
        setGoogleAvatarUrl(
          meta.avatar_url ?? meta.picture ?? profile?.avatar_url ?? null
        );
        setReady(true);
      }
    })();

    return () => { cancelled = true; };
  }, [user, isLoading, router]);

  /* ── Username live check (debounced 500ms) ──────────────────── */
  useEffect(() => {
    const clean = username.toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (clean !== username) return; // will re-fire after setState
    if (username.length < 3 || username.length > 20) {
      setUsernameStatus("idle");
      return;
    }
    if (RESERVED_USERNAMES.includes(username)) {
      setUsernameStatus("taken");
      return;
    }
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username)
        .neq("id", user?.id ?? "")
        .maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 500);
    return () => clearTimeout(timer);
  }, [username, user?.id]);

  /* ── Helpers ────────────────────────────────────────────────── */
  const step1Valid =
    username.length >= 3 &&
    username.length <= 20 &&
    usernameStatus === "available" &&
    displayName.trim().length > 0;

  const nextStep = () => {
    setError("");
    setStep((s) => s + 1);
  };
  const prevStep = () => {
    setError("");
    setStep((s) => Math.max(minStep, s - 1));
  };

  const handleFinish = async () => {
    setError("");
    if (selectedSubjects.length === 0) {
      setError("Pick at least one subject");
      return;
    }
    if (dailyTarget === 0) {
      setError("Pick a daily target");
      return;
    }

    setSubmitting(true);

    // Build avatar_url
    let avatarUrl: string | null = null;
    if (selectedAvatarIdx === null && googleAvatarUrl) {
      avatarUrl = googleAvatarUrl;
    }
    // else null → DiceBear fallback

    const updates: Record<string, unknown> = {
      goal_type: studyGoal,
      selected_subjects: selectedSubjects,
      daily_target_minutes: dailyTarget,
      onboarding_completed: true,
    };

    // Only set identity fields if user went through step 1
    if (minStep === 1) {
      updates.username = username.trim().toLowerCase();
      updates.display_name = displayName.trim();
      updates.avatar_url = avatarUrl;
    }

    const { error: dbErr } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", user!.id);

    if (dbErr) {
      setError(dbErr.message);
      setSubmitting(false);
      return;
    }

    await refreshUser();
    router.replace("/dashboard");
  };

  /* ── Loading / guard states ─────────────────────────────────── */
  if (isLoading || !ready) {
    return (
      <div className="min-h-screen bg-navy flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 rounded-full border-2 border-electric border-t-transparent animate-spin" />
          <p className="font-bebas text-xl text-cream/40 tracking-wider">LOADING</p>
        </div>
      </div>
    );
  }

  /* ── Render ─────────────────────────────────────────────────── */
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 relative overflow-hidden py-8">
      {/* Background grid */}
      <div
        className="absolute inset-0 opacity-30 pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(rgba(74,144,217,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.08) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      <div className="relative z-10 w-full max-w-md animate-slide-up">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-electric flex items-center justify-center shadow-lg shadow-electric/40">
              <span className="text-white font-bebas text-xl leading-none">L</span>
            </div>
            <span className="font-bebas text-3xl tracking-wider text-cream">LIONADE</span>
          </div>
          <p className="text-cream/40 text-sm mt-3">Let&apos;s set up your arena profile</p>
        </div>

        <div
          className="rounded-2xl border border-electric/20 overflow-hidden"
          style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}
        >
          <div className="px-6 pt-5 pb-6">
            {/* ── Step indicator ──────────────────────────────── */}
            <div className="flex items-center gap-2 mb-6">
              {STEPS.filter((s) => s.n >= minStep).map((s, i, arr) => (
                <div key={s.n} className="flex items-center gap-2 flex-1">
                  <div className="flex flex-col items-center gap-1 flex-1">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                        step > s.n
                          ? "bg-green-500 text-white"
                          : step === s.n
                          ? "bg-electric text-white shadow-lg shadow-electric/40"
                          : "bg-white/10 text-cream/40"
                      }`}
                    >
                      {step > s.n ? "\u2713" : s.n - minStep + 1}
                    </div>
                    <span
                      className={`text-[10px] font-semibold transition-colors duration-200 ${
                        step === s.n
                          ? "text-electric"
                          : step > s.n
                          ? "text-green-400"
                          : "text-cream/30"
                      }`}
                    >
                      {s.label}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <div
                      className={`h-0.5 flex-1 mb-4 rounded-full transition-all duration-300 ${
                        step > s.n ? "bg-green-500" : "bg-white/10"
                      }`}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* ════════════════ STEP 1: IDENTITY ════════════════ */}
            {step === 1 && (
              <div className="space-y-5 animate-slide-up">
                <div className="text-center mb-2">
                  <h2 className="font-bebas text-2xl text-cream tracking-wider">
                    CREATE YOUR IDENTITY
                  </h2>
                  <p className="text-cream/40 text-xs mt-1">
                    This is how other players will see you in the arena
                  </p>
                </div>

                {/* Display Name */}
                <div>
                  <label className="block text-cream/60 text-xs font-bold uppercase tracking-widest mb-2">
                    Display Name
                  </label>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className={inputCls}
                    maxLength={50}
                  />
                </div>

                {/* Username */}
                <div>
                  <label className="block text-cream/60 text-xs font-bold uppercase tracking-widest mb-2">
                    Username
                  </label>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-cream/30 text-sm font-medium">
                      @
                    </span>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) =>
                        setUsername(
                          e.target.value
                            .toLowerCase()
                            .replace(/[^a-z0-9_]/g, "")
                            .slice(0, 20)
                        )
                      }
                      placeholder="your_handle"
                      className={inputCls + " pl-9 pr-28"}
                      maxLength={20}
                    />
                    {usernameStatus === "checking" && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/40 text-xs">
                        Checking...
                      </span>
                    )}
                    {usernameStatus === "available" && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-semibold">
                        &#x2705; Available
                      </span>
                    )}
                    {usernameStatus === "taken" && (
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-semibold">
                        &#x274C; Taken
                      </span>
                    )}
                  </div>
                  <p className="text-cream/25 text-xs mt-1.5">
                    3-20 characters. Letters, numbers, and underscores only.
                  </p>
                </div>

                {/* Avatar selection */}
                <div>
                  <label className="block text-cream/60 text-xs font-bold uppercase tracking-widest mb-3">
                    Avatar
                  </label>
                  <div className="flex flex-wrap gap-2 justify-center">
                    {/* Google avatar */}
                    {googleAvatarUrl && (
                      <button
                        type="button"
                        onClick={() => setSelectedAvatarIdx(null)}
                        className={`w-12 h-12 rounded-full overflow-hidden border-2 transition-all duration-200 flex-shrink-0 ${
                          selectedAvatarIdx === null
                            ? "border-electric shadow-lg shadow-electric/40 scale-110"
                            : "border-cream/20 opacity-60 hover:opacity-100"
                        }`}
                      >
                        <img
                          src={googleAvatarUrl}
                          alt="Google avatar"
                          className="w-full h-full object-cover"
                          referrerPolicy="no-referrer"
                        />
                      </button>
                    )}
                    {/* Emoji avatars */}
                    {DEFAULT_AVATARS.map((av, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setSelectedAvatarIdx(i)}
                        className={`w-12 h-12 rounded-full flex items-center justify-center text-xl border-2 transition-all duration-200 flex-shrink-0 ${
                          selectedAvatarIdx === i
                            ? "border-electric shadow-lg shadow-electric/40 scale-110"
                            : "border-cream/20 opacity-60 hover:opacity-100"
                        }`}
                        style={{ background: av.bg + "30" }}
                      >
                        {av.emoji}
                      </button>
                    ))}
                  </div>
                </div>

                {error && <ErrorBox msg={error} />}

                <button
                  type="button"
                  onClick={nextStep}
                  disabled={!step1Valid}
                  className="w-full py-3.5 rounded-xl font-bold text-sm bg-electric text-white hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20 disabled:opacity-40 disabled:cursor-not-allowed mt-1"
                >
                  Next &rarr;
                </button>
              </div>
            )}

            {/* ════════════════ STEP 2: GOAL ════════════════════ */}
            {step === 2 && (
              <div className="space-y-5 animate-slide-up">
                <div className="text-center mb-2">
                  <h2 className="font-bebas text-2xl text-cream tracking-wider">
                    WHAT&apos;S YOUR GOAL?
                  </h2>
                  <p className="text-cream/40 text-xs mt-1">
                    We&apos;ll tailor your experience
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {STUDY_GOALS.map((g) => (
                    <button
                      key={g.label}
                      type="button"
                      onClick={() => setStudyGoal(g.label)}
                      className={`rounded-xl border p-4 text-left transition-all duration-200 ${
                        studyGoal === g.label
                          ? "border-electric bg-electric/10 shadow-lg shadow-electric/10"
                          : "border-cream/10 bg-white/[0.02] hover:border-cream/20"
                      }`}
                    >
                      <span className="text-2xl block mb-2">{g.icon}</span>
                      <span
                        className={`text-xs font-semibold ${
                          studyGoal === g.label ? "text-electric" : "text-cream/60"
                        }`}
                      >
                        {g.label}
                      </span>
                    </button>
                  ))}
                </div>

                {error && <ErrorBox msg={error} />}

                <div className="flex gap-3 mt-1">
                  {minStep < 2 && (
                    <button
                      type="button"
                      onClick={prevStep}
                      className="flex-1 py-3.5 rounded-xl font-bold text-sm border border-electric/30 text-cream/70 hover:text-cream hover:border-electric/60 transition-all duration-200"
                    >
                      &larr; Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={nextStep}
                    disabled={!studyGoal}
                    className={`${
                      minStep < 2 ? "flex-[2]" : "w-full"
                    } py-3.5 rounded-xl font-bold text-sm bg-electric text-white hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20 disabled:opacity-40 disabled:cursor-not-allowed`}
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* ════════════════ STEP 3: SUBJECTS ════════════════ */}
            {step === 3 && (
              <div className="space-y-5 animate-slide-up">
                <div className="text-center mb-2">
                  <h2 className="font-bebas text-2xl text-cream tracking-wider">
                    PICK YOUR SUBJECTS
                  </h2>
                  <p className="text-cream/40 text-xs mt-1">
                    Select all that you want to study
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  {SUBJECTS.map((s) => {
                    const selected = selectedSubjects.includes(s.label);
                    return (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() =>
                          setSelectedSubjects((prev) =>
                            selected
                              ? prev.filter((x) => x !== s.label)
                              : [...prev, s.label]
                          )
                        }
                        className={`rounded-xl border p-4 text-left transition-all duration-200 ${
                          selected
                            ? "shadow-lg"
                            : "border-cream/10 bg-white/[0.02] hover:border-cream/20"
                        }`}
                        style={
                          selected
                            ? {
                                borderColor: s.color + "60",
                                background: s.color + "15",
                                boxShadow: `0 0 12px ${s.color}20`,
                              }
                            : undefined
                        }
                      >
                        <span className="text-2xl block mb-2">{s.icon}</span>
                        <span
                          className="text-xs font-semibold"
                          style={selected ? { color: s.color } : { color: "rgba(238,244,255,0.6)" }}
                        >
                          {s.label}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {error && <ErrorBox msg={error} />}

                <div className="flex gap-3 mt-1">
                  <button
                    type="button"
                    onClick={prevStep}
                    className="flex-1 py-3.5 rounded-xl font-bold text-sm border border-electric/30 text-cream/70 hover:text-cream hover:border-electric/60 transition-all duration-200"
                  >
                    &larr; Back
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedSubjects.length === 0) {
                        setError("Pick at least one subject");
                        return;
                      }
                      setError("");
                      nextStep();
                    }}
                    disabled={selectedSubjects.length === 0}
                    className="flex-[2] py-3.5 rounded-xl font-bold text-sm bg-electric text-white hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20 disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    Next &rarr;
                  </button>
                </div>
              </div>
            )}

            {/* ════════════════ STEP 4: DAILY TARGET ════════════ */}
            {step === 4 && (
              <div className="space-y-5 animate-slide-up">
                <div className="text-center mb-2">
                  <h2 className="font-bebas text-2xl text-cream tracking-wider">
                    DAILY STUDY TARGET
                  </h2>
                  <p className="text-cream/40 text-xs mt-1">
                    How much time can you commit each day?
                  </p>
                </div>

                <div className="space-y-2">
                  {DAILY_TARGETS.map((t) => (
                    <button
                      key={t.minutes}
                      type="button"
                      onClick={() => setDailyTarget(t.minutes)}
                      className={`w-full rounded-xl border p-4 flex items-center gap-4 transition-all duration-200 ${
                        dailyTarget === t.minutes
                          ? "border-electric bg-electric/10 shadow-lg shadow-electric/10"
                          : "border-cream/10 bg-white/[0.02] hover:border-cream/20"
                      }`}
                    >
                      <span
                        className={`font-bebas text-2xl ${
                          dailyTarget === t.minutes ? "text-electric" : "text-cream/40"
                        }`}
                      >
                        {t.label}
                      </span>
                      <span
                        className={`text-xs font-medium ${
                          dailyTarget === t.minutes ? "text-cream/70" : "text-cream/30"
                        }`}
                      >
                        {t.desc}
                      </span>
                    </button>
                  ))}
                </div>

                {error && <ErrorBox msg={error} />}

                <div className="flex gap-3 mt-1">
                  <button
                    type="button"
                    onClick={prevStep}
                    className="flex-1 py-3.5 rounded-xl font-bold text-sm border border-electric/30 text-cream/70 hover:text-cream hover:border-electric/60 transition-all duration-200"
                  >
                    &larr; Back
                  </button>
                  <button
                    type="button"
                    onClick={handleFinish}
                    disabled={submitting || dailyTarget === 0}
                    className="flex-[2] py-3.5 rounded-xl font-bold text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                    style={{
                      background:
                        "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                      color: "#04080F",
                      boxShadow: "0 4px 20px rgba(240,180,41,0.35)",
                    }}
                  >
                    {submitting ? <Spinner label="Saving..." /> : "\u{1F525} Let's Go!"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-center text-cream/20 text-xs mt-5">
          You can change these settings later in your profile.
        </p>
      </div>
    </div>
  );
}

/* ── Helpers ────────────────────────────────────────────────────── */

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/10 border border-red-400/30 animate-slide-up">
      <span className="text-sm flex-shrink-0">&#x26A0;&#xFE0F;</span>
      <p className="text-red-400 text-sm font-semibold">{msg}</p>
    </div>
  );
}

function Spinner({ label }: { label: string }) {
  return (
    <span className="flex items-center justify-center gap-2">
      <span className="w-4 h-4 rounded-full border-2 border-current border-t-transparent animate-spin" />
      {label}
    </span>
  );
}
