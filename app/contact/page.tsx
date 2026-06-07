"use client";

import { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import BackButton from "@/components/BackButton";
import { SUPPORT_EMAIL } from "@/lib/site-config";
import { CheckCircle, Warning, EnvelopeSimple, XLogo, Lifebuoy } from "@phosphor-icons/react";

const CATEGORIES = ["Bug Report", "Feature Request", "General Question", "Account Issue", "Partnership", "Other"];

const QUICK_HELP = [
  { icon: "🐛", label: "Report a Bug", category: "Bug Report", hint: "Something broken" },
  { icon: "💡", label: "Feature Idea", category: "Feature Request", hint: "Wishlist item" },
  { icon: "❓", label: "General Question", category: "General Question", hint: "Anything else" },
];

export default function ContactPage() {
  const { user } = useAuth();
  const [name, setName] = useState(user?.displayName ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [category, setCategory] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    if (!name || !email || !category || !subject || !message) {
      setError("Please fill in all fields.");
      return;
    }
    setSending(true);
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, category, subject, message }),
      });
      if (!res.ok) throw new Error();
      setSent(true);
    } catch {
      setError(`Failed to send. Please email ${SUPPORT_EMAIL} directly.`);
    }
    setSending(false);
  };

  const inputCls =
    "w-full bg-white/[0.03] border border-white/[0.08] rounded-xl px-4 py-3 text-cream placeholder-cream/25 text-sm focus:outline-none focus:border-electric/60 focus:bg-white/[0.05] transition-all";
  const labelCls = "block font-mono text-[10px] uppercase tracking-[0.28em] text-cream/50 mb-2";

  return (
    <div className="min-h-screen pt-20 pb-16">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <BackButton />

        {/* Hero */}
        <section className="text-center mt-4 mb-12 animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/75 mb-4">
            We answer fast
          </p>
          <h1 className="font-bebas text-6xl sm:text-7xl tracking-wider leading-[0.95]">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              GET IN TOUCH
            </span>
          </h1>
          <div
            aria-hidden
            className="mx-auto mt-6 h-px w-24"
            style={{ background: "linear-gradient(90deg, transparent 0%, #F0B429 50%, transparent 100%)" }}
          />
          <p className="mt-6 text-cream/65 text-base leading-relaxed max-w-xl mx-auto">
            Bug reports, feedback, partnership ideas, anything. We read every message and try to respond within 24 hours.
          </p>
        </section>

        {/* Direct channels */}
        <section
          className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-10 animate-slide-up"
          style={{ animationDelay: "0.05s" }}
        >
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="rounded-2xl border border-white/[0.08] p-4 hover:border-electric/40 transition-all hover:-translate-y-0.5"
            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.7) 0%, rgba(6,12,24,0.7) 100%)" }}
          >
            <EnvelopeSimple size={20} weight="duotone" color="#4C96E1" aria-hidden="true" />
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/45 mt-2">Email</p>
            <p className="text-cream text-sm font-semibold mt-1 break-all">{SUPPORT_EMAIL}</p>
          </a>
          <a
            href="https://x.com/getlionade"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-2xl border border-white/[0.08] p-4 hover:border-electric/40 transition-all hover:-translate-y-0.5"
            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.7) 0%, rgba(6,12,24,0.7) 100%)" }}
          >
            <XLogo size={20} weight="duotone" color="#F0B429" aria-hidden="true" />
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/45 mt-2">Follow</p>
            <p className="text-cream text-sm font-semibold mt-1">@getlionade</p>
          </a>
          <Link
            href="/about"
            className="rounded-2xl border border-white/[0.08] p-4 hover:border-electric/40 transition-all hover:-translate-y-0.5 block"
            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.7) 0%, rgba(6,12,24,0.7) 100%)" }}
          >
            <Lifebuoy size={20} weight="duotone" color="#A78BFA" aria-hidden="true" />
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/45 mt-2">Team</p>
            <p className="text-cream text-sm font-semibold mt-1">About Lionade</p>
          </Link>
        </section>

        {/* Quick category cards */}
        {!sent && (
          <div
            className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6 animate-slide-up"
            style={{ animationDelay: "0.1s" }}
          >
            {QUICK_HELP.map((item) => {
              const selected = category === item.category;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => setCategory(item.category)}
                  className={`p-4 rounded-2xl border text-left transition-all duration-300 hover:-translate-y-0.5 cursor-pointer ${
                    selected
                      ? "border-electric/70 bg-electric/[0.08]"
                      : "border-white/[0.08] hover:border-electric/40"
                  }`}
                  style={{
                    background: selected
                      ? undefined
                      : "linear-gradient(135deg, rgba(10,16,32,0.7) 0%, rgba(6,12,24,0.7) 100%)",
                  }}
                >
                  <span className="text-2xl block mb-2">{item.icon}</span>
                  <p className="text-cream text-sm font-bold">{item.label}</p>
                  <p className="text-cream/40 text-xs mt-0.5">{item.hint}</p>
                </button>
              );
            })}
          </div>
        )}

        {sent ? (
          <div
            className="rounded-2xl border border-green-400/30 p-10 text-center animate-slide-up"
            style={{ background: "linear-gradient(135deg, rgba(10,16,32,0.85) 0%, rgba(6,12,24,0.85) 100%)" }}
          >
            <div className="flex justify-center mb-4">
              <CheckCircle size={56} weight="fill" color="#22C55E" aria-hidden="true" />
            </div>
            <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-green-400/80 mb-3">
              Message received
            </p>
            <h2 className="font-bebas text-3xl text-cream tracking-wider mb-2">We got it.</h2>
            <p className="text-cream/55 text-sm mb-6 max-w-md mx-auto">
              Expect a reply at <span className="text-cream/80">{email}</span> within a day. Check spam if it does not show.
            </p>
            <button
              type="button"
              onClick={() => {
                setSent(false);
                setError("");
                setCategory("");
                setSubject("");
                setMessage("");
              }}
              className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/60 hover:text-cream border border-white/[0.08] hover:border-electric/40 rounded-full px-5 py-2.5 transition-all"
            >
              Send another
            </button>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-white/[0.08] p-6 sm:p-8 space-y-5 animate-slide-up"
            style={{
              background: "linear-gradient(135deg, rgba(10,16,32,0.85) 0%, rgba(6,12,24,0.85) 100%)",
              animationDelay: "0.15s",
            }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label htmlFor="contact-name" className={labelCls}>Name</label>
                <input
                  id="contact-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="What should we call you"
                  autoComplete="name"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputCls}
                />
              </div>
              <div>
                <label htmlFor="contact-email" className={labelCls}>Email</label>
                <input
                  id="contact-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  autoCorrect="off"
                  spellCheck={false}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label htmlFor="contact-category" className={labelCls}>Category</label>
              <select
                id="contact-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[#0a1020] border border-white/[0.08] rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:border-electric/60 transition-all appearance-none"
              >
                <option value="">Pick one</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="contact-subject" className={labelCls}>Subject</label>
              <input
                id="contact-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="One-line summary"
                autoCorrect="off"
                className={inputCls}
              />
            </div>

            <div>
              <label htmlFor="contact-message" className={labelCls}>Message</label>
              <textarea
                id="contact-message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Tell us what is up. Screenshots, steps to reproduce, and rough timing all help."
                rows={6}
                className={inputCls + " resize-none leading-relaxed"}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-red-400/10 border border-red-400/30 text-red-400">
                <Warning size={14} weight="fill" color="#EF4444" aria-hidden="true" />
                <span className="flex-1">{error}</span>
                <a
                  href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject || "Lionade support")}`}
                  className="font-mono text-[10px] uppercase tracking-[0.28em] text-red-200/90 hover:text-red-100 underline underline-offset-4"
                >
                  Email instead
                </a>
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={sending}
              className="w-full py-3.5 rounded-full font-bold text-sm disabled:opacity-60 transition-all hover:-translate-y-0.5"
              style={{
                background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 4px 20px rgba(240,180,41,0.28)",
              }}
            >
              {sending ? "Sending..." : "Send Message"}
            </button>

            <p className="text-cream/35 text-xs text-center leading-relaxed pt-1">
              Real humans read these. Lionade is small, so feedback shapes what we ship next.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
