"use client";

/**
 * CreateBankModal — three-step wizard for creating a new Word Bank.
 *
 * Step 1: pick bank.kind — 'language' or 'general'
 * Step 2a (language): pick source_lang + target_lang from V2 allowlist (en, es)
 * Step 2b (general): just continue to naming
 * Step 3 (both): name + color + emoji
 *
 * Why a wizard vs one big form: each kind needs a different second screen, and
 * the color/icon pickers feel less noisy when surfaced after the structural
 * decision is settled. Cancel-able at any point. Submits POST /api/vocab/banks
 * and reports the new bank to the parent.
 *
 * V1 emoji + color sets are curated (not a full emoji-picker library) to keep
 * the bundle small and the surface focused — Sam can extend the arrays here.
 */

import { useEffect, useState } from "react";
import { X, BookOpen, GlobeHemisphereWest, ArrowRight, ArrowLeft } from "@phosphor-icons/react";
import { apiPost } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

export interface VocabBank {
  id: string;
  name: string;
  slug: string;
  kind: "language" | "general";
  source_lang?: string;
  target_lang?: string;
  color: string;
  icon: string;
  created_at: string;
  // V3A — public + clone metadata (optional; only present once V3A migration runs)
  is_public?: boolean;
  published_at?: string | null;
  clone_count?: number;
  parent_bank_id?: string | null;
  parent_user_id?: string | null;
  /** Username of the original author for cloned banks — surfaced in tooltips. */
  parent_username?: string | null;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (bank: VocabBank) => void;
}

type Step = "kind" | "lang" | "name";
type Kind = "language" | "general";
type Lang = "en" | "es";

const COLOR_PRESETS = [
  { hex: "#4A90D9", label: "electric" },
  { hex: "#FFD700", label: "gold" },
  { hex: "#A855F7", label: "purple" },
  { hex: "#22C55E", label: "green" },
];

const ICON_PRESETS = ["📚", "🌍", "🧠", "💼", "🎓", "🧪", "💻", "✏️", "🔥", "⭐"];

const LANG_LABEL: Record<Lang, string> = {
  en: "English",
  es: "Spanish",
};

const MAX_NAME_LEN = 50;

export default function CreateBankModal({ open, onClose, onCreated }: Props) {
  const [step, setStep] = useState<Step>("kind");
  const [kind, setKind] = useState<Kind>("general");
  const [sourceLang, setSourceLang] = useState<Lang>("en");
  const [targetLang, setTargetLang] = useState<Lang>("es");
  const [name, setName] = useState("");
  const [color, setColor] = useState(COLOR_PRESETS[0].hex);
  const [icon, setIcon] = useState(ICON_PRESETS[0]);
  const [saving, setSaving] = useState(false);

  // Reset state every time the modal opens fresh.
  useEffect(() => {
    if (open) {
      setStep("kind");
      setKind("general");
      setSourceLang("en");
      setTargetLang("es");
      setName("");
      setColor(COLOR_PRESETS[0].hex);
      setIcon(ICON_PRESETS[0]);
      setSaving(false);
    }
  }, [open]);

  // Default name + icon adapt to the chosen kind once the user lands on the
  // naming step. Sam can still override before saving.
  useEffect(() => {
    if (step !== "name") return;
    if (name.length > 0) return;
    if (kind === "language") {
      setName(`${LANG_LABEL[targetLang]} vocab`);
      setIcon("🌍");
    } else {
      setName("My Terms");
      setIcon("📚");
    }
  }, [step, kind, targetLang, name.length]);

  if (!open) return null;

  const handlePickKind = (k: Kind) => {
    setKind(k);
    setStep(k === "language" ? "lang" : "name");
  };

  const handleSubmit = async () => {
    const cleaned = name.trim().slice(0, MAX_NAME_LEN);
    if (!cleaned || saving) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: cleaned, kind, color, icon };
      if (kind === "language") {
        body.source_lang = sourceLang;
        body.target_lang = targetLang;
      }
      const { ok, data, error } = await apiPost<{ bank: VocabBank }>(
        "/api/vocab/banks",
        body,
      );
      if (!ok || !data) {
        toastError(error ?? "Couldn't create that bank. Try again.");
        return;
      }
      onCreated(data.bank);
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Create failed.");
    } finally {
      setSaving(false);
    }
  };

  const canPickLang = sourceLang !== targetLang;
  const canSave = name.trim().length > 0 && !saving;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-bank-title"
      className="fluid-modal-backdrop fixed inset-0 z-[10000] flex items-center justify-center p-4"
      style={{ background: "rgba(4, 8, 15, 0.7)", backdropFilter: "blur(8px)" }}
      onClick={onClose}
    >
      <div
        className="fluid-modal-panel relative w-full max-w-md rounded-2xl bg-white/5 backdrop-blur border border-white/10 p-6 sm:p-7"
        style={{ background: "rgba(12, 16, 32, 0.92)" }}
        onClick={e => e.stopPropagation()}
      >
        {/* Close */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 p-1.5 rounded-md text-cream/55 hover:text-cream hover:bg-white/10 transition-colors"
        >
          <X size={16} weight="bold" />
        </button>

        {/* Step indicator */}
        <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-cream/45 mb-2">
          {step === "kind" ? "step 1 of 2" : kind === "language" && step === "lang" ? "step 2 of 3" : "final step"}
        </p>
        <h2 id="create-bank-title" className="font-bebas text-2xl tracking-wider text-cream mb-5 leading-none">
          {step === "kind" ? "New word bank" : step === "lang" ? "Pick a language pair" : "Name your bank"}
        </h2>

        {/* ── STEP 1: kind ─────────────────────────────────── */}
        {step === "kind" && (
          <div className="space-y-3">
            <button
              type="button"
              onClick={() => handlePickKind("general")}
              className="press-feedback w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.08] hover:border-gold/30 transition-colors px-4 py-4 flex items-center gap-4"
            >
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-2xl" style={{ background: "rgba(255,215,0,0.12)", border: "1px solid rgba(255,215,0,0.32)" }}>
                <BookOpen size={22} weight="fill" color="#FFD700" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bebas text-lg tracking-wider text-cream leading-none">General bank</p>
                <p className="font-syne text-xs text-cream/65 mt-1">AWS, math, biology, anything. Term plus your explanation.</p>
              </div>
              <ArrowRight size={14} weight="bold" className="text-cream/45" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={() => handlePickKind("language")}
              className="press-feedback w-full text-left rounded-xl border border-white/10 bg-white/5 hover:bg-white/[0.08] hover:border-electric/40 transition-colors px-4 py-4 flex items-center gap-4"
            >
              <div className="w-11 h-11 rounded-full flex items-center justify-center text-2xl" style={{ background: "rgba(74,144,217,0.12)", border: "1px solid rgba(74,144,217,0.32)" }}>
                <GlobeHemisphereWest size={22} weight="fill" color="#4A90D9" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bebas text-lg tracking-wider text-cream leading-none">Language bank</p>
                <p className="font-syne text-xs text-cream/65 mt-1">Translate a word, write your own definition in the target language.</p>
              </div>
              <ArrowRight size={14} weight="bold" className="text-cream/45" aria-hidden="true" />
            </button>
          </div>
        )}

        {/* ── STEP 2a: language pair ───────────────────────── */}
        {step === "lang" && (
          <div className="space-y-5">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 mb-2">from</p>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(LANG_LABEL) as Lang[]).map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setSourceLang(l)}
                    className={`px-4 py-2 rounded-xl font-syne font-bold text-sm border transition-colors ${
                      sourceLang === l
                        ? "bg-electric text-navy border-electric"
                        : "bg-white/5 text-cream/70 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {LANG_LABEL[l]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 mb-2">to</p>
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(LANG_LABEL) as Lang[]).map(l => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setTargetLang(l)}
                    className={`px-4 py-2 rounded-xl font-syne font-bold text-sm border transition-colors ${
                      targetLang === l
                        ? "bg-gold text-navy border-gold"
                        : "bg-white/5 text-cream/70 border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {LANG_LABEL[l]}
                  </button>
                ))}
              </div>
            </div>
            {!canPickLang && (
              <p className="font-syne text-xs text-red-300/85">
                Source and target must be different.
              </p>
            )}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setStep("kind")}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne font-bold text-sm bg-white/5 border border-white/10 text-cream/75 hover:bg-white/10 transition-colors"
              >
                <ArrowLeft size={14} weight="bold" aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                onClick={() => setStep("name")}
                disabled={!canPickLang}
                className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-syne font-bold text-sm bg-electric text-navy hover:bg-electric/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
                <ArrowRight size={14} weight="bold" aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3: name + color + icon ──────────────────── */}
        {step === "name" && (
          <div className="space-y-5">
            <div>
              <label htmlFor="bank-name" className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 block mb-2">
                bank name
              </label>
              <input
                id="bank-name"
                type="text"
                value={name}
                onChange={e => setName(e.target.value.slice(0, MAX_NAME_LEN))}
                maxLength={MAX_NAME_LEN}
                placeholder={kind === "language" ? "Spanish vocab" : "My Terms"}
                className="w-full px-4 py-3 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-base focus:outline-none focus:border-electric/60 focus:bg-white/[0.07] transition-colors"
                autoFocus
              />
              <p className="font-mono text-[9px] uppercase tracking-wider text-cream/35 mt-1 text-right">
                {name.length}/{MAX_NAME_LEN}
              </p>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 mb-2">color</p>
              <div className="flex gap-2 flex-wrap">
                {COLOR_PRESETS.map(c => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setColor(c.hex)}
                    aria-label={`Pick ${c.label} color`}
                    className="w-9 h-9 rounded-full transition-transform hover:scale-110"
                    style={{
                      background: c.hex,
                      boxShadow: color === c.hex ? `0 0 0 3px rgba(255,255,255,0.85)` : "none",
                      outline: "1px solid rgba(255,255,255,0.1)",
                    }}
                  />
                ))}
              </div>
            </div>

            <div>
              <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 mb-2">icon</p>
              <div className="flex gap-1.5 flex-wrap">
                {ICON_PRESETS.map(em => (
                  <button
                    key={em}
                    type="button"
                    onClick={() => setIcon(em)}
                    aria-label={`Pick ${em} icon`}
                    className={`w-9 h-9 rounded-lg flex items-center justify-center text-xl transition-colors ${
                      icon === em
                        ? "bg-white/15 border border-white/30"
                        : "bg-white/5 border border-white/10 hover:bg-white/10"
                    }`}
                  >
                    {em}
                  </button>
                ))}
              </div>
            </div>

            {/* Preview pill */}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
              <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45 mb-2">preview</p>
              <span
                className="inline-flex items-center gap-2 rounded-full px-3 py-1.5 border"
                style={{ background: `${color}18`, borderColor: `${color}50` }}
              >
                <span aria-hidden="true">{icon}</span>
                <span className="font-bebas tracking-wider text-cream text-sm">{name || "Bank name"}</span>
              </span>
            </div>

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={() => setStep(kind === "language" ? "lang" : "kind")}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl font-syne font-bold text-sm bg-white/5 border border-white/10 text-cream/75 hover:bg-white/10 transition-colors"
              >
                <ArrowLeft size={14} weight="bold" aria-hidden="true" />
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSave}
                className="btn-gold flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-syne font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? "Creating..." : "Create bank"}
                {!saving && <ArrowRight size={14} weight="bold" aria-hidden="true" />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
