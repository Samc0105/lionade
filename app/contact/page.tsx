"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth";
import BackButton from "@/components/BackButton";

const CATEGORIES = ["Bug Report", "Feature Request", "General Question", "Account Issue", "Feedback"];

const QUICK_HELP = [
  { icon: "\uD83D\uDC1B", label: "Report a Bug", category: "Bug Report" },
  { icon: "\uD83D\uDCA1", label: "Feature Request", category: "Feature Request" },
  { icon: "\u2753", label: "General Question", category: "General Question" },
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
      setError("Failed to send. Please try again or email support@getlionade.com directly.");
    }
    setSending(false);
  };

  const inputCls = "w-full bg-white/5 border border-electric/20 rounded-xl px-4 py-3 text-cream placeholder-cream/25 text-sm focus:outline-none focus:border-electric transition-all";
  const labelCls = "block text-cream/50 text-xs font-bold uppercase tracking-widest mb-1.5";

  return (
    <div className="min-h-screen bg-navy pt-20 pb-16">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <BackButton />

        <div className="text-center mb-10 animate-slide-up">
          <h1 className="font-bebas text-5xl text-cream tracking-wider mb-2">How Can We Help?</h1>
          <p className="text-cream/40 text-sm">We usually respond within 24 hours.</p>
        </div>

        {/* Quick help cards */}
        <div className="grid grid-cols-3 gap-3 mb-8 animate-slide-up" style={{ animationDelay: "0.05s" }}>
          {QUICK_HELP.map((item) => (
            <button
              key={item.label}
              onClick={() => setCategory(item.category)}
              className={`p-4 rounded-2xl border text-center transition-all duration-300 hover:-translate-y-0.5 cursor-pointer ${
                category === item.category
                  ? "border-electric bg-electric/10"
                  : "border-electric/20 hover:border-electric/40"
              }`}
              style={{ background: category === item.category ? undefined : "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}
            >
              <span className="text-3xl block mb-2">{item.icon}</span>
              <p className="text-cream text-xs font-bold">{item.label}</p>
            </button>
          ))}
        </div>

        {sent ? (
          <div
            className="rounded-2xl border border-green-400/30 p-8 text-center animate-slide-up"
            style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)" }}
          >
            <span className="text-5xl block mb-4">✅</span>
            <h2 className="font-bebas text-2xl text-cream tracking-wider mb-2">Message Sent!</h2>
            <p className="text-cream/50 text-sm">We'll get back to you soon.</p>
          </div>
        ) : (
          <div
            className="rounded-2xl border border-electric/20 p-6 sm:p-8 space-y-5 animate-slide-up"
            style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)", animationDelay: "0.1s" }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
              <div>
                <label className={labelCls}>Name</label>
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" className={inputCls} />
              </div>
            </div>

            <div>
              <label className={labelCls}>Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full bg-[#0a1020] border border-electric/20 rounded-xl px-4 py-3 text-cream text-sm focus:outline-none focus:border-electric transition-all appearance-none"
              >
                <option value="">Select a category...</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>

            <div>
              <label className={labelCls}>Subject</label>
              <input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Brief summary" className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Message</label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe your question or issue..."
                rows={5}
                className={inputCls + " resize-none"}
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-semibold bg-red-400/10 border border-red-400/30 text-red-400">
                ⚠️ {error}
              </div>
            )}

            <button
              onClick={handleSubmit}
              disabled={sending}
              className="w-full py-3.5 rounded-xl font-bold text-sm disabled:opacity-60 transition-all"
              style={{
                background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 4px 15px rgba(240,180,41,0.3)",
              }}
            >
              {sending ? "Sending..." : "Send Message"}
            </button>
            <p className="text-cream/30 text-xs text-center mt-4 leading-relaxed">
              Lionade requires help from the community to run smoothly, feedback on any parts of our website are greatly appreciated to help make Lionade run soundly and safely. 😊
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
