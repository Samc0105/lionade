"use client";

/**
 * AddWordForm — Tab A of /learn/vocab.
 *
 * Branches on the active bank's `kind`:
 *
 *  • LANGUAGE bank — input a word in source_lang, hit Translate
 *    (POST /api/vocab/translate with bank_id). Once the translation card
 *    renders, the user writes their OWN simple definition in the target
 *    language. franc-min runs on the textarea and surfaces a soft nudge if
 *    the detected language doesn't match the target. Save → POST
 *    /api/vocab/words with bank_id + word + translation + user_definition.
 *
 *  • GENERAL bank — input a term (e.g. "SAML"), hit Define
 *    (POST /api/vocab/define with bank_id). The server cascades Wikipedia →
 *    AI → 404; the response carries a `source` field which we badge under
 *    the definition. If both sources failed (404 from backend) we swap in a
 *    manual textarea so the user can paste their own definition. Then the
 *    user writes their own explanation. No language detection — a general
 *    bank's explanations can be in any language the user thinks in.
 *
 * The "active recall move" — writing your own definition — is the same in
 * both flows. That's the value-add.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Lightbulb, Translate, Books, Sparkle, Pencil } from "@phosphor-icons/react";
import { apiPost } from "@/lib/api-client";
import { toastSuccess, toastError } from "@/lib/toast";
import { detectLanguage, type DetectionResult } from "@/lib/ml/language-detect";
import type { VocabBank } from "./CreateBankModal";

const LANG_NAME: Record<string, string> = {
  en: "English",
  es: "Spanish",
};

// Confidence floor for the language-mismatch nudge. Below this, signal is too
// noisy (short text, mixed words) to risk a false-positive warning.
const WARNING_CONFIDENCE_THRESHOLD = 0.5;
const MAX_WORD_LEN = 50;
const MAX_DEFINITION_LEN = 280;

interface Props {
  bank: VocabBank;
  onSaved?: () => void;
}

type DefineSource = "wikipedia" | "ai" | "manual";

export default function AddWordForm({ bank, onSaved }: Props) {
  const isLanguageBank = bank.kind === "language";
  const sourceLang = bank.source_lang ?? "en";
  const targetLang = bank.target_lang ?? "es";

  // Form state — shared between flows
  const [word, setWord] = useState("");
  // Language-bank: API returns a translation. General-bank: API returns a
  // term_definition + source. We keep them in distinct fields so save-time
  // payloads stay typed correctly.
  const [translation, setTranslation] = useState<string | null>(null);
  const [termDefinition, setTermDefinition] = useState<string | null>(null);
  const [defineSource, setDefineSource] = useState<DefineSource | null>(null);
  const [defineFailed, setDefineFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [userDefinition, setUserDefinition] = useState("");
  const [saving, setSaving] = useState(false);

  // Reset everything when the active bank changes — the form belongs to the
  // bank, not to the page.
  useEffect(() => {
    setWord("");
    setTranslation(null);
    setTermDefinition(null);
    setDefineSource(null);
    setDefineFailed(false);
    setUserDefinition("");
  }, [bank.id]);

  // Language detect on the self-definition (LANGUAGE banks only).
  const [langDetect, setLangDetect] = useState<DetectionResult | null>(null);
  useEffect(() => {
    if (!isLanguageBank) {
      setLangDetect(null);
      return;
    }
    if (userDefinition.trim().length === 0) {
      setLangDetect(null);
      return;
    }
    const t = setTimeout(() => {
      setLangDetect(detectLanguage(userDefinition, targetLang as "en" | "es"));
    }, 500);
    return () => clearTimeout(t);
  }, [userDefinition, targetLang, isLanguageBank]);

  const showLangWarning =
    isLanguageBank
    && langDetect !== null
    && langDetect.code !== "unknown"
    && langDetect.matches_target === false
    && langDetect.confidence > WARNING_CONFIDENCE_THRESHOLD;

  const canAction = useMemo(
    () => word.trim().length > 0 && !busy,
    [word, busy],
  );

  const ready = isLanguageBank ? translation !== null : (termDefinition !== null || defineFailed);
  const canSave = useMemo(
    () => ready && userDefinition.trim().length > 0 && !saving
      && (isLanguageBank ? translation !== null : termDefinition !== null && termDefinition.trim().length > 0),
    [ready, userDefinition, saving, isLanguageBank, translation, termDefinition],
  );

  const resetForm = () => {
    setWord("");
    setTranslation(null);
    setTermDefinition(null);
    setDefineSource(null);
    setDefineFailed(false);
    setUserDefinition("");
    setLangDetect(null);
  };

  const handleAction = async () => {
    const cleaned = word.trim().slice(0, MAX_WORD_LEN);
    if (!cleaned || busy) return;
    setBusy(true);
    setTranslation(null);
    setTermDefinition(null);
    setDefineSource(null);
    setDefineFailed(false);
    setUserDefinition("");
    try {
      if (isLanguageBank) {
        const { ok, data, error } = await apiPost<{ translation: string }>(
          "/api/vocab/translate",
          { word: cleaned, source: sourceLang, target: targetLang, bank_id: bank.id },
        );
        if (!ok || !data) {
          console.error("[vocab:translate] failed", error);
          toastError("Couldn't translate that word. Try again.");
          return;
        }
        setTranslation(data.translation);
      } else {
        const { ok, data, error, status } = await apiPost<{ definition: string; source: DefineSource }>(
          "/api/vocab/define",
          { term: cleaned, bank_id: bank.id },
        );
        if (ok && data) {
          setTermDefinition(data.definition);
          setDefineSource(data.source);
        } else if (status === 404) {
          // Both Wikipedia + AI sources failed — drop user into manual mode.
          setDefineFailed(true);
          setTermDefinition("");
          setDefineSource("manual");
        } else {
          console.error("[vocab:define] failed", { status, error });
          toastError("Couldn't define that term. Try again.");
          return;
        }
      }
    } catch (e: unknown) {
      console.error("[vocab:lookup] threw", e);
      toastError("Couldn't look that up. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async () => {
    if (!ready || saving) return;
    const cleanedWord = word.trim().slice(0, MAX_WORD_LEN);
    const cleanedSelf = userDefinition.trim().slice(0, MAX_DEFINITION_LEN);
    if (!cleanedWord || !cleanedSelf) return;
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        bank_id: bank.id,
        user_definition: cleanedSelf,
      };
      if (isLanguageBank) {
        if (!translation) return;
        body.word = cleanedWord;
        body.translation = translation;
        body.source_lang = sourceLang;
        body.target_lang = targetLang;
      } else {
        if (!termDefinition || termDefinition.trim().length === 0) {
          toastError("Add a definition before saving.");
          return;
        }
        body.term = cleanedWord;
        body.term_definition = termDefinition.trim();
        // If the user typed their own canonical definition without a successful
        // Wikipedia/AI fetch, defineSource is null — treat as manual.
        body.definition_source = defineSource ?? "manual";
      }
      const { ok, data, error } = await apiPost<{ coinsAwarded: number }>(
        "/api/vocab/words",
        body,
      );
      if (!ok || !data) {
        console.error("[vocab:save-word] failed", error);
        toastError("Couldn't save. Try again.");
        return;
      }
      const awarded = typeof data.coinsAwarded === "number" ? data.coinsAwarded : 0;
      toastSuccess(`+${awarded} Fangs! Saved to ${bank.name}.`);
      resetForm();
      onSaved?.();
    } catch (e: unknown) {
      console.error("[vocab:save-word] threw", e);
      toastError("Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const sourceLangLabel = LANG_NAME[sourceLang] ?? sourceLang.toUpperCase();
  const targetLangLabel = LANG_NAME[targetLang] ?? targetLang.toUpperCase();

  const inputLabel = isLanguageBank
    ? `word in ${sourceLangLabel.toLowerCase()}`
    : "term";
  const inputPlaceholder = isLanguageBank
    ? (sourceLang === "en" ? "e.g. window" : "e.g. ventana")
    : "e.g. SAML, hypothesis, photosynthesis";
  const actionLabel = isLanguageBank ? "Translate" : "Define";
  const ActionIcon = isLanguageBank ? Translate : Books;

  return (
    <div className="space-y-5">
      {/* Bank context strip — shows what bank you're adding into */}
      <div
        className="flex items-center gap-2 rounded-full px-3 py-1.5 border w-fit"
        style={{ background: `${bank.color}14`, borderColor: `${bank.color}40` }}
      >
        <span aria-hidden="true">{bank.icon}</span>
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/70">
          adding to <span className="text-cream">{bank.name}</span>
        </p>
        {isLanguageBank && (
          <span className="font-mono text-[9px] uppercase tracking-wider text-cream/55">
            {sourceLang} → {targetLang}
          </span>
        )}
      </div>

      {/* Word / term input */}
      <div>
        <label htmlFor="vocab-word-input" className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55 block mb-2">
          {inputLabel}
        </label>
        <div className="flex items-stretch gap-2">
          <input
            id="vocab-word-input"
            type="text"
            value={word}
            onChange={e => setWord(e.target.value.slice(0, MAX_WORD_LEN))}
            onBlur={e => setWord(e.target.value.trim())}
            onKeyDown={e => {
              if (e.key === "Enter" && canAction) {
                e.preventDefault();
                handleAction();
              }
            }}
            maxLength={MAX_WORD_LEN}
            placeholder={inputPlaceholder}
            className="flex-1 min-w-0 px-4 py-3.5 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-base focus:outline-none focus:border-electric/60 focus:bg-white/[0.07] transition-colors"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleAction}
            disabled={!canAction}
            className="px-5 rounded-xl font-syne font-bold text-sm bg-gold text-navy hover:bg-gold/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2 shadow-[0_0_18px_rgba(255,215,0,0.18)]"
          >
            <ActionIcon size={16} weight="bold" aria-hidden="true" />
            <span>{busy ? "..." : actionLabel}</span>
          </button>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-wider text-cream/35 mt-1.5 text-right tabular-nums">
          {word.length}/{MAX_WORD_LEN}
        </p>
      </div>

      {/* Translation card — LANGUAGE banks */}
      {isLanguageBank && translation && (
        <div
          className="rounded-2xl px-5 py-4 border border-electric/30 animate-slide-up"
          style={{ background: "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(255,255,255,0.02) 100%)" }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-electric/80 mb-1.5">
            {targetLangLabel}
          </p>
          <p className="font-bebas text-2xl tracking-wider text-cream leading-tight">
            {translation}
          </p>
        </div>
      )}

      {/* Definition card — GENERAL banks (Wikipedia / AI result) */}
      {!isLanguageBank && termDefinition !== null && !defineFailed && (
        <div
          className="rounded-2xl px-5 py-4 border border-electric/30 animate-slide-up"
          style={{ background: "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(255,255,255,0.02) 100%)" }}
        >
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-electric/80">
              definition
            </p>
            {defineSource && <SourceBadge source={defineSource} />}
          </div>
          <p className="font-syne text-sm text-cream/90 leading-relaxed">
            {termDefinition}
          </p>
        </div>
      )}

      {/* Manual-definition fallback — GENERAL banks when both Wikipedia + AI failed */}
      {!isLanguageBank && defineFailed && (
        <div
          className="rounded-2xl px-5 py-4 border border-gold/30 animate-slide-up"
          style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.06) 0%, rgba(255,255,255,0.02) 100%)" }}
        >
          <div className="flex items-baseline justify-between mb-2 gap-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-gold/80">
              no auto-definition found
            </p>
            <SourceBadge source="manual" />
          </div>
          <p className="font-syne text-xs text-cream/65 mb-2">
            Paste a definition or write your own. We'll save this as the term's reference.
          </p>
          <textarea
            value={termDefinition ?? ""}
            onChange={e => setTermDefinition(e.target.value.slice(0, MAX_DEFINITION_LEN * 2))}
            rows={3}
            maxLength={MAX_DEFINITION_LEN * 2}
            placeholder="Paste a definition here..."
            className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-gold/60 resize-none"
          />
        </div>
      )}

      {/* Self-definition input — both flows */}
      {ready && (
        <div className="animate-slide-up" style={{ animationDelay: "0.05s" }}>
          <label htmlFor="vocab-self-def" className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 block mb-2">
            {isLanguageBank
              ? `now write your own definition in ${targetLangLabel.toLowerCase()}`
              : "explain this in your own words"}
          </label>
          <textarea
            id="vocab-self-def"
            value={userDefinition}
            onChange={e => setUserDefinition(e.target.value.slice(0, MAX_DEFINITION_LEN))}
            placeholder={isLanguageBank
              ? (sourceLang === "en"
                ? "Describe la palabra con palabras simples..."
                : "Describe the word with simple words you already know...")
              : "What does this mean? Use plain language you'd use with a friend."}
            rows={3}
            maxLength={MAX_DEFINITION_LEN}
            className="w-full px-4 py-3 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-gold/60 focus:bg-white/[0.07] transition-colors resize-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45">
              writing it yourself is what makes it stick.
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/35 tabular-nums">
              {userDefinition.length}/{MAX_DEFINITION_LEN}
            </p>
          </div>

          {/* Soft language-mismatch nudge — LANGUAGE banks only. Does NOT block save. */}
          {showLangWarning && langDetect && (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 inline-flex items-start gap-2 rounded-xl px-3 py-2 border border-gold/30 bg-gold/[0.06] backdrop-blur animate-slide-up"
            >
              <Lightbulb size={14} weight="fill" className="text-gold mt-0.5 shrink-0" aria-hidden="true" />
              <p className="font-syne text-xs text-gold/90 leading-snug">
                Looks like {LANG_NAME[langDetect.code as "en" | "es"]}. Try writing in {targetLangLabel}. That is how it sticks.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave}
            className="btn-gold mt-4 w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl font-syne font-bold disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span>{saving ? "Saving..." : "Lock it in"}</span>
            {!saving && <ArrowRight size={16} weight="bold" aria-hidden="true" />}
          </button>
        </div>
      )}

      {/* Empty-state tip — only when nothing is happening */}
      {!ready && !busy && word.length === 0 && (
        <div className="mt-2 rounded-2xl p-5 bg-white/[0.03] backdrop-blur border border-white/[0.06]">
          <p className="font-bebas text-sm tracking-[0.15em] text-gold/80 mb-2">
            ACTIVE RECALL METHOD
          </p>
          <p className="font-syne text-sm text-cream/75 leading-relaxed">
            {isLanguageBank
              ? "Type a word, get the translation, then write your OWN simple definition in the target language. Writing the definition yourself is what locks the word into long-term memory."
              : "Type a term, get the textbook definition, then re-explain it in plain words you'd use with a friend. Re-stating it in your voice is what locks it into long-term memory."}
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Source badge ──────────────────────────────────────────── */

function SourceBadge({ source }: { source: DefineSource }) {
  const meta = source === "wikipedia"
    ? { label: "from wikipedia", color: "#22C55E", Icon: Books }
    : source === "ai"
      ? { label: "from ai", color: "#A855F7", Icon: Sparkle }
      : { label: "manual entry", color: "#FFD700", Icon: Pencil };
  const Icon = meta.Icon;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 border font-mono text-[9px] uppercase tracking-[0.22em]"
      style={{ background: `${meta.color}14`, borderColor: `${meta.color}50`, color: meta.color }}
    >
      <Icon size={9} weight="bold" aria-hidden="true" />
      <span>{meta.label}</span>
    </span>
  );
}
