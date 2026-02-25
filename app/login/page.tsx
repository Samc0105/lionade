"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import type { SignupExtra } from "@/lib/auth";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Tab = "login" | "signup";

const EDUCATION_LEVELS = [
  "Middle School",
  "High School Freshman",
  "High School Sophomore",
  "High School Junior",
  "High School Senior",
  "College Freshman",
  "College Sophomore",
  "College Junior",
  "College Senior",
  "Graduate Student",
  "Working Professional",
  "Self Taught / Independent Learner",
  "Other",
];

const STUDY_GOALS = [
  "Improve my grades",
  "Prepare for SAT / ACT / GRE",
  "Study for certifications (AWS, CompTIA, etc.)",
  "Learn coding and tech skills",
  "Study for professional exams (CPA, Bar, MCAT)",
  "General knowledge and self improvement",
  "Compete and win rewards",
  "Other",
];

const REFERRAL_SOURCES = [
  "TikTok",
  "Instagram",
  "Twitter / X",
  "YouTube",
  "Reddit",
  "Friend or family",
  "Google search",
  "School or teacher",
  "Other",
];

const STEPS = [
  { n: 1, label: "Account" },
  { n: 2, label: "About You" },
  { n: 3, label: "Goals" },
];

const RESERVED_USERNAMES = ["admin", "root", "lionade", "support", "help", "ninny"];

// Max date of birth = 13 years ago today
const maxDob = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 13);
  return d.toISOString().split("T")[0];
})();

const inputCls =
  "w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3.5 text-cream placeholder-cream/25 text-sm font-medium focus:outline-none focus:border-electric focus:bg-electric/5 transition-all";
const selectCls =
  "w-full bg-[#0a1020] border border-electric/20 rounded-xl px-4 py-3.5 text-cream text-sm font-medium focus:outline-none focus:border-electric transition-all appearance-none cursor-pointer";
const labelCls = "block text-cream/60 text-xs font-bold uppercase tracking-widest mb-2";

export default function LoginPage() {
  const { user, isLoading, login, signup } = useAuth();
  const router = useRouter();

  const [tab, setTab] = useState<Tab>("login");
  const [step, setStep] = useState(1);

  // Detect email verification redirect synchronously to avoid race with auth state
  const [showVerifiedBanner] = useState(() => {
    if (typeof window === "undefined") return false;
    const hash = window.location.hash;
    const params = new URLSearchParams(window.location.search);
    const isVerified = hash.includes("type=signup") || params.get("type") === "signup";
    if (isVerified) window.history.replaceState(null, "", window.location.pathname);
    return isVerified;
  });

  // Login fields
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  // Signup fields
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [dob, setDob] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [studyGoal, setStudyGoal] = useState("");
  const [referralSource, setReferralSource] = useState("");

  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [signupSuccess, setSignupSuccess] = useState(false);
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");

  // Password strength checks
  const pwChecks = {
    length: password.length >= 8,
    upper: /[A-Z]/.test(password),
    lower: /[a-z]/.test(password),
    number: /[0-9]/.test(password),
    special: /[!@#$%^&*]/.test(password),
  };
  const pwStrong = Object.values(pwChecks).every(Boolean);
  const passwordsMatch = confirmPassword === "" || password === confirmPassword;

  // Redirect if already logged in — delay 2.5s when showing verified banner so user sees it
  useEffect(() => {
    if (!isLoading && user) {
      const checkOnboarding = async () => {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", user.id)
          .maybeSingle();
        const dest = profile?.onboarding_completed ? "/dashboard" : "/onboarding?step=2";
        if (showVerifiedBanner) {
          const t = setTimeout(() => router.replace(dest), 2500);
          return () => clearTimeout(t);
        } else {
          router.replace(dest);
        }
      };
      checkOnboarding();
    }
  }, [user, isLoading, router, showVerifiedBanner]);

  // Username availability check — debounced 500ms
  useEffect(() => {
    if (username.length < 3) { setUsernameStatus("idle"); return; }
    if (RESERVED_USERNAMES.includes(username)) { setUsernameStatus("taken"); return; }
    setUsernameStatus("checking");
    const timer = setTimeout(async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id")
        .eq("username", username)
        .maybeSingle();
      setUsernameStatus(data ? "taken" : "available");
    }, 500);
    return () => clearTimeout(timer);
  }, [username]);

  if (isLoading) return (
    <div className="min-h-screen bg-navy flex items-center justify-center">
      <div className="w-10 h-10 rounded-full border-2 border-electric border-t-transparent animate-spin" />
    </div>
  );
  if (user && !showVerifiedBanner) return null;

  // ── Login submit ──────────────────────────────────────
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!loginEmail.trim()) { setError("Email is required"); return; }
    if (!loginPassword) { setError("Password is required"); return; }
    setSubmitting(true);
    const { error: err } = await login(loginEmail.trim(), loginPassword);
    if (err) {
      setError(err.includes("Invalid") ? "Wrong email or password" : err);
      setSubmitting(false);
    } else {
      // Check if onboarding is completed
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        const { data: profile } = await supabase
          .from("profiles")
          .select("onboarding_completed")
          .eq("id", session.user.id)
          .maybeSingle();
        if (!profile?.onboarding_completed) {
          router.replace("/onboarding?step=2");
          return;
        }
      }
      router.replace("/dashboard");
    }
  };

  // ── Signup step validation ────────────────────────────
  const validateStep = (): boolean => {
    setError("");
    if (step === 1) {
      if (!email.trim()) { setError("Email is required"); return false; }
      if (!email.includes("@")) { setError("Enter a valid email address"); return false; }
      if (!username.trim()) { setError("Username is required"); return false; }
      if (username.trim().length < 3) { setError("Username must be at least 3 characters"); return false; }
      if (RESERVED_USERNAMES.includes(username.trim())) { setError("That username is not available"); return false; }
      if (usernameStatus === "taken") { setError("That username is already taken"); return false; }
      if (usernameStatus === "checking") { setError("Please wait — checking username availability"); return false; }
      if (!password) { setError("Password is required"); return false; }
      if (!pwStrong) { setError("Password doesn't meet all requirements"); return false; }
      if (!confirmPassword) { setError("Please confirm your password"); return false; }
      if (password !== confirmPassword) { setError("Passwords do not match"); return false; }
    }
    if (step === 2) {
      if (!firstName.trim()) { setError("First name is required"); return false; }
      if (!dob) { setError("Date of birth is required"); return false; }
      const dobDate = new Date(dob);
      const minAge = new Date();
      minAge.setFullYear(minAge.getFullYear() - 13);
      if (dobDate > minAge) { setError("You must be at least 13 years old to sign up"); return false; }
      if (!educationLevel) { setError("Please select your education level"); return false; }
    }
    if (step === 3) {
      if (!studyGoal) { setError("Please select a primary study goal"); return false; }
      if (!referralSource) { setError("Please tell us how you heard about us"); return false; }
    }
    return true;
  };

  const nextStep = () => {
    if (!validateStep()) return;
    setStep((s) => s + 1);
  };

  const prevStep = () => {
    setError("");
    setStep((s) => s - 1);
  };

  // ── Final signup submit ───────────────────────────────
  const handleSignup = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    const extra: SignupExtra = {
      firstName: firstName.trim(),
      dateOfBirth: dob,
      educationLevel,
      studyGoal,
      referralSource,
    };
    const { error: err } = await signup(
      email.trim().toLowerCase(),
      username.trim().toLowerCase(),
      password,
      extra
    );
    if (err) {
      setError(err);
      setSubmitting(false);
    } else {
      setSignupSuccess(true);
    }
  };

  const handleGoogleAuth = async () => {
    await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + "/onboarding" },
    });
  };

  const resetSignup = () => {
    setStep(1);
    setEmail(""); setUsername(""); setPassword(""); setConfirmPassword("");
    setFirstName(""); setDob(""); setEducationLevel("");
    setStudyGoal(""); setReferralSource("");
    setError(""); setSignupSuccess(false);
    setUsernameStatus("idle");
  };

  // ─────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-navy flex items-center justify-center px-4 relative overflow-hidden py-8">
      {/* Background */}
      <div className="absolute inset-0 opacity-30" style={{
        backgroundImage: "linear-gradient(rgba(74,144,217,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.08) 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />
      <div className="absolute top-1/4 left-1/3 w-80 h-80 rounded-full blur-3xl opacity-15 pointer-events-none"
        style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }} />
      <div className="absolute bottom-1/4 right-1/3 w-64 h-64 rounded-full blur-3xl opacity-10 pointer-events-none"
        style={{ background: "radial-gradient(circle, #F0B429 0%, transparent 70%)" }} />

      <div className="relative z-10 w-full max-w-md animate-slide-up">

        {/* Email verified banner */}
        {showVerifiedBanner && (
          <div className="mb-4 flex items-center gap-3 px-4 py-3.5 rounded-xl bg-green-400/10 border border-green-400/30 animate-slide-up">
            <span className="text-green-400 text-lg leading-none">✓</span>
            <p className="text-green-400 text-sm font-semibold">
              Email verified! You can now log in.
            </p>
          </div>
        )}

        {/* Logo */}
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-electric flex items-center justify-center shadow-lg shadow-electric/40">
              <span className="text-white font-bebas text-xl leading-none">L</span>
            </div>
            <span className="font-bebas text-3xl tracking-wider text-cream group-hover:text-electric transition-colors">
              LIONADE
            </span>
          </Link>
          <p className="text-cream/40 text-sm mt-3">
            {signupSuccess ? "One more step!" : tab === "login" ? "Welcome back. Your streak is waiting." : "Join 50K students already grinding."}
          </p>
        </div>

        {/* ── Signup success ── */}
        {signupSuccess ? (
          <div className="rounded-2xl p-8 border border-green-400/30 text-center"
            style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}>
            <div className="text-6xl mb-4">📬</div>
            <h2 className="font-bebas text-3xl text-green-400 tracking-wider mb-3">Check Your Email</h2>
            <p className="text-cream/60 text-sm leading-relaxed mb-6">
              We sent a confirmation link to{" "}
              <span className="text-electric font-semibold">{email}</span>.
              Click it to activate your account, then come back and log in.
            </p>
            <button onClick={() => { setTab("login"); resetSignup(); }} className="btn-primary w-full py-3">
              Go to Log In
            </button>
          </div>

        ) : (
          <div className="rounded-2xl border border-electric/20 overflow-hidden"
            style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}>

            {/* Tab switcher */}
            <div className="flex gap-1 bg-white/5 p-1.5 m-4 rounded-xl">
              {(["login", "signup"] as Tab[]).map((t) => (
                <button key={t}
                  onClick={() => { setTab(t); setError(""); setStep(1); }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-bold transition-all duration-200
                    ${tab === t ? "bg-electric text-white shadow-lg shadow-electric/30" : "text-cream/50 hover:text-cream"}`}>
                  {t === "login" ? "Log In" : "Sign Up"}
                </button>
              ))}
            </div>

            <div className="px-6 pb-6">

              {/* ── LOGIN FORM ── */}
              {tab === "login" && (
                <form onSubmit={handleLogin} className="space-y-4">
                  {/* Google OAuth */}
                  <button
                    type="button"
                    onClick={handleGoogleAuth}
                    className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-white text-gray-700 hover:bg-gray-100 active:scale-[0.98] shadow-sm"
                  >
                    <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                    Continue with Google
                  </button>
                  {/* Divider */}
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-cream/10" />
                    <span className="text-cream/30 text-xs font-medium">or</span>
                    <div className="flex-1 h-px bg-cream/10" />
                  </div>
                  <div>
                    <label className={labelCls}>Email</label>
                    <input
                      type="email"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      placeholder="you@example.com"
                      autoComplete="email"
                      autoFocus={showVerifiedBanner}
                      className={inputCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Password</label>
                    <input type="password" value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)}
                      placeholder="••••••••" autoComplete="current-password" className={inputCls} />
                  </div>
                  {error && <ErrorBox msg={error} />}
                  <button type="submit" disabled={submitting}
                    className="w-full py-4 rounded-xl font-bold text-base mt-2 disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                    style={{ background: submitting ? "#4A90D960" : "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: submitting ? "none" : "0 4px 20px rgba(240,180,41,0.35)" }}>
                    {submitting ? <Spinner label="Logging in..." /> : "🚀 Log In & Grind"}
                  </button>
                </form>
              )}

              {/* ── SIGNUP FORM ── */}
              {tab === "signup" && (
                <div>
                  {/* Progress indicator */}
                  <div className="flex items-center gap-2 mb-6">
                    {STEPS.map((s, i) => (
                      <div key={s.n} className="flex items-center gap-2 flex-1">
                        <div className="flex flex-col items-center gap-1 flex-1">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300
                            ${step > s.n ? "bg-green-500 text-white" : step === s.n ? "bg-electric text-white shadow-lg shadow-electric/40" : "bg-white/10 text-cream/40"}`}>
                            {step > s.n ? "✓" : s.n}
                          </div>
                          <span className={`text-xs font-semibold transition-colors duration-200
                            ${step === s.n ? "text-electric" : step > s.n ? "text-green-400" : "text-cream/30"}`}>
                            {s.label}
                          </span>
                        </div>
                        {i < STEPS.length - 1 && (
                          <div className={`h-0.5 flex-1 mb-4 rounded-full transition-all duration-300
                            ${step > s.n ? "bg-green-500" : "bg-white/10"}`} />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Step 1: Account */}
                  {step === 1 && (
                    <div className="space-y-4 animate-slide-up">
                      {/* Google OAuth */}
                      <button
                        type="button"
                        onClick={handleGoogleAuth}
                        className="w-full flex items-center justify-center gap-3 py-3.5 rounded-xl font-semibold text-sm transition-all duration-200 bg-white text-gray-700 hover:bg-gray-100 active:scale-[0.98] shadow-sm"
                      >
                        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59a14.5 14.5 0 0 1 0-9.18l-7.98-6.19a24.0 24.0 0 0 0 0 21.56l7.98-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                        Continue with Google
                      </button>
                      {/* Divider */}
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-px bg-cream/10" />
                        <span className="text-cream/30 text-xs font-medium">or</span>
                        <div className="flex-1 h-px bg-cream/10" />
                      </div>
                      <p className="text-cream/40 text-xs mb-4">Create your login credentials</p>
                      <div>
                        <label className={labelCls}>Email</label>
                        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com" autoComplete="email" className={inputCls} />
                      </div>

                      {/* Username with live availability */}
                      <div>
                        <label className={labelCls}>Username</label>
                        <div className="relative">
                          <input
                            type="text"
                            value={username}
                            onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                            placeholder="your_handle"
                            autoComplete="username"
                            className={inputCls + " pr-28"}
                          />
                          {usernameStatus === "checking" && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-cream/40 text-xs">Checking...</span>
                          )}
                          {usernameStatus === "available" && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-green-400 text-xs font-semibold">✓ Available</span>
                          )}
                          {usernameStatus === "taken" && (
                            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-red-400 text-xs font-semibold">✗ Taken</span>
                          )}
                        </div>
                        <p className="text-cream/25 text-xs mt-1.5">Lowercase letters, numbers, underscores only</p>
                      </div>

                      {/* Password with strength checklist */}
                      <div>
                        <label className={labelCls}>Password</label>
                        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                          placeholder="Min. 8 characters" autoComplete="new-password" className={inputCls} />
                        {password.length > 0 && (
                          <div className="mt-2.5 space-y-1.5 px-1">
                            <PwCheck ok={pwChecks.length} label="At least 8 characters" />
                            <PwCheck ok={pwChecks.upper} label="One uppercase letter" />
                            <PwCheck ok={pwChecks.lower} label="One lowercase letter" />
                            <PwCheck ok={pwChecks.number} label="One number" />
                            <PwCheck ok={pwChecks.special} label="One special character (!@#$%^&*)" />
                          </div>
                        )}
                      </div>

                      {/* Confirm password with live match indicator */}
                      <div>
                        <label className={labelCls}>Confirm Password</label>
                        <input
                          type="password"
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          placeholder="Re-enter your password"
                          autoComplete="new-password"
                          className={inputCls}
                        />
                        {confirmPassword.length > 0 && !passwordsMatch && (
                          <p className="text-red-400 text-xs font-semibold mt-1.5">Passwords do not match</p>
                        )}
                        {confirmPassword.length > 0 && passwordsMatch && (
                          <p className="text-green-400 text-xs font-semibold mt-1.5">✓ Passwords match</p>
                        )}
                      </div>

                      {error && <ErrorBox msg={error} />}
                      <button onClick={nextStep} type="button"
                        className="w-full py-3.5 rounded-xl font-bold text-sm bg-electric text-white hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20 mt-2">
                        Next — About You →
                      </button>
                    </div>
                  )}

                  {/* Step 2: About You */}
                  {step === 2 && (
                    <div className="space-y-4 animate-slide-up">
                      <p className="text-cream/40 text-xs mb-4">Tell us a little about yourself</p>
                      <div>
                        <label className={labelCls}>First Name</label>
                        <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)}
                          placeholder="First name" autoComplete="given-name" className={inputCls} />
                      </div>
                      <div>
                        <label className={labelCls}>Date of Birth</label>
                        <input type="date" value={dob} onChange={(e) => setDob(e.target.value)}
                          max={maxDob}
                          className={inputCls + " [color-scheme:dark]"} />
                        <p className="text-cream/25 text-xs mt-1.5">Must be at least 13 years old</p>
                      </div>
                      <div>
                        <label className={labelCls}>Education Level</label>
                        <div className="relative">
                          <select value={educationLevel} onChange={(e) => setEducationLevel(e.target.value)}
                            className={selectCls}>
                            <option value="" disabled>Select your level...</option>
                            {EDUCATION_LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
                          </select>
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-cream/40 pointer-events-none">▾</span>
                        </div>
                      </div>
                      {error && <ErrorBox msg={error} />}
                      <div className="flex gap-3 mt-2">
                        <button onClick={prevStep} type="button"
                          className="flex-1 py-3.5 rounded-xl font-bold text-sm border border-electric/30 text-cream/70 hover:text-cream hover:border-electric/60 transition-all duration-200">
                          ← Back
                        </button>
                        <button onClick={nextStep} type="button"
                          className="flex-[2] py-3.5 rounded-xl font-bold text-sm bg-electric text-white hover:bg-electric/90 transition-all duration-200 shadow-lg shadow-electric/20">
                          Next — Your Goals →
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Step 3: Goals + Summary */}
                  {step === 3 && (
                    <div className="space-y-4 animate-slide-up">
                      <p className="text-cream/40 text-xs mb-4">Almost done — set your goals</p>
                      <div>
                        <label className={labelCls}>Primary Study Goal</label>
                        <div className="relative">
                          <select value={studyGoal} onChange={(e) => setStudyGoal(e.target.value)}
                            className={selectCls}>
                            <option value="" disabled>What brings you here?</option>
                            {STUDY_GOALS.map((g) => <option key={g} value={g}>{g}</option>)}
                          </select>
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-cream/40 pointer-events-none">▾</span>
                        </div>
                      </div>
                      <div>
                        <label className={labelCls}>How Did You Hear About Us?</label>
                        <div className="relative">
                          <select value={referralSource} onChange={(e) => setReferralSource(e.target.value)}
                            className={selectCls}>
                            <option value="" disabled>Select a source...</option>
                            {REFERRAL_SOURCES.map((r) => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-cream/40 pointer-events-none">▾</span>
                        </div>
                      </div>

                      {/* Summary card */}
                      {studyGoal && referralSource && (
                        <div className="rounded-xl border border-electric/20 p-4 space-y-2 mt-2"
                          style={{ background: "rgba(74,144,217,0.05)" }}>
                          <p className="text-electric text-xs font-bold uppercase tracking-widest mb-3">Your Account Summary</p>
                          <SummaryRow icon="📧" label="Email" value={email} />
                          <SummaryRow icon="🎮" label="Username" value={`@${username}`} />
                          <SummaryRow icon="👤" label="Name" value={firstName} />
                          <SummaryRow icon="🎓" label="Education" value={educationLevel} />
                          <SummaryRow icon="🎯" label="Goal" value={studyGoal} />
                          <SummaryRow icon="📣" label="Via" value={referralSource} />
                        </div>
                      )}

                      {error && <ErrorBox msg={error} />}
                      <div className="flex gap-3 mt-2">
                        <button onClick={prevStep} type="button"
                          className="flex-1 py-3.5 rounded-xl font-bold text-sm border border-electric/30 text-cream/70 hover:text-cream hover:border-electric/60 transition-all duration-200">
                          ← Back
                        </button>
                        <button onClick={handleSignup} type="button" disabled={submitting}
                          className="flex-[2] py-3.5 rounded-xl font-bold text-sm disabled:opacity-60 disabled:cursor-not-allowed transition-all duration-200"
                          style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F", boxShadow: "0 4px 20px rgba(240,180,41,0.35)" }}>
                          {submitting ? <Spinner label="Creating account..." /> : "🔥 Create Account"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Switch tab hint */}
              <p className="text-center text-cream/30 text-sm mt-5">
                {tab === "login" ? (
                  <>No account?{" "}
                    <button onClick={() => { setTab("signup"); setError(""); }} className="text-electric font-semibold hover:text-electric/80">
                      Sign up free →
                    </button>
                  </>
                ) : (
                  <>Already grinding?{" "}
                    <button onClick={() => { setTab("login"); setError(""); setStep(1); }} className="text-electric font-semibold hover:text-electric/80">
                      Log in →
                    </button>
                  </>
                )}
              </p>
            </div>
          </div>
        )}

        <p className="text-center text-cream/20 text-xs mt-5">
          By signing up, you agree to study harder than yesterday.
        </p>

        {/* Demo quiz CTA */}
        {!signupSuccess && (
          <div className="mt-6 text-center">
            <p className="text-cream/25 text-[10px] font-bold uppercase tracking-[0.2em] mb-2.5">
              Not ready to sign up?
            </p>
            <Link
              href="/demo"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-electric/20 text-cream/60 text-sm font-semibold hover:text-electric hover:border-electric/50 hover:bg-electric/5 transition-all duration-200"
            >
              <span className="text-base">🧠</span>
              Try a Sample Quiz
              <span className="text-cream/30">&#8594;</span>
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Small helpers ─────────────────────────────────────

function PwCheck({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-2 text-xs font-medium transition-colors duration-200 ${ok ? "text-green-400" : "text-red-400"}`}>
      <span className="w-3 flex-shrink-0">{ok ? "✓" : "✗"}</span>
      <span>{label}</span>
    </div>
  );
}

function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-400/10 border border-red-400/30 animate-slide-up">
      <span className="text-sm flex-shrink-0">⚠️</span>
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

function SummaryRow({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="text-base w-5">{icon}</span>
      <span className="text-cream/40 w-20 text-xs font-semibold">{label}</span>
      <span className="text-cream/80 text-xs truncate">{value}</span>
    </div>
  );
}
