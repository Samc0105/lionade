"use client";

/**
 * AddWordForm — Tab A of /learn/vocab.
 *
 * The "active recall move" lives here: after the server returns a translation,
 * we ask the user to type their OWN simple definition in the target language.
 * That second input is the value-add — it forces semantic engagement instead
 * of passive memorize-a-pair.
 *
 * Three states:
 *   1. idle           — empty input + Translate button (disabled until text)
 *   2. translating    — POSTing /api/vocab/translate
 *   3. translated     — translation card visible, self-definition input ready
 *
 * Language-pair toggle persists in localStorage under `vocab_lang_pair`. Only
 * the user-facing toggle goes in localStorage — vocab words themselves are
 * server-owned.
 */

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, ArrowsClockwise, Lightbulb, Translate } from "@phosphor-icons/react";
import { apiPost } from "@/lib/api-client";
import { toastSuccess, toastError } from "@/lib/toast";
import { detectLanguage, type DetectionResult } from "@/lib/ml/language-detect";
import type { LangPair } from "./LanguageStreakPill";

const LANG_LABEL: Record<LangPair, { source: string; target: string; targetName: string }> = {
  "en-es": { source: "EN", target: "ES", targetName: "Spanish" },
  "es-en": { source: "ES", target: "EN", targetName: "English" },
};

const LANG_NAME: Record<"en" | "es", string> = {
  en: "English",
  es: "Spanish",
};

// Confidence floor for surfacing the nudge. Below this, the signal is too
// noisy (short text, mixed words) to risk a false-positive warning.
const WARNING_CONFIDENCE_THRESHOLD = 0.5;

const STORAGE_KEY = "vocab_lang_pair";
const MAX_WORD_LEN = 50;
const MAX_DEFINITION_LEN = 280;

interface Props {
  onSaved?: () => void;
}

export default function AddWordForm({ onSaved }: Props) {
  // Lang pair: read from localStorage on mount, default en-es. Hydration-safe
  // because we only set the persisted value after mount.
  const [langPair, setLangPair] = useState<LangPair>("en-es");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === "en-es" || stored === "es-en") setLangPair(stored);
    } catch {
      /* localStorage unavailable (private mode, etc.) — defaults are fine */
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, langPair);
    } catch { /* noop */ }
  }, [langPair, hydrated]);

  const langs = LANG_LABEL[langPair];
  const sourceLang = langPair.split("-")[0];
  const targetLang = langPair.split("-")[1];

  // Form state
  const [word, setWord] = useState("");
  const [translation, setTranslation] = useState<string | null>(null);
  const [translating, setTranslating] = useState(false);
  const [userDefinition, setUserDefinition] = useState("");
  const [saving, setSaving] = useState(false);

  // Client-side ML: detect the language of the self-definition and gently
  // nudge if it doesn't match the target language. See lib/ml/language-detect.
  // Debounced 500ms so we don't run trigram analysis on every keystroke.
  const [langDetect, setLangDetect] = useState<DetectionResult | null>(null);
  useEffect(() => {
    // Reset detection any time the textarea clears.
    if (userDefinition.trim().length === 0) {
      setLangDetect(null);
      return;
    }
    const t = setTimeout(() => {
      setLangDetect(detectLanguage(userDefinition, targetLang as "en" | "es"));
    }, 500);
    return () => clearTimeout(t);
  }, [userDefinition, targetLang]);

  const showLangWarning =
    langDetect !== null
    && langDetect.code !== "unknown"
    && langDetect.matches_target === false
    && langDetect.confidence > WARNING_CONFIDENCE_THRESHOLD;

  const canTranslate = useMemo(
    () => word.trim().length > 0 && !translating,
    [word, translating],
  );
  const canSave = useMemo(
    () => translation !== null && userDefinition.trim().length > 0 && !saving,
    [translation, userDefinition, saving],
  );

  const resetForm = () => {
    setWord("");
    setTranslation(null);
    setUserDefinition("");
    setLangDetect(null);
  };

  const flipLangPair = () => {
    setLangPair(prev => (prev === "en-es" ? "es-en" : "en-es"));
    resetForm();
  };

  const handleTranslate = async () => {
    const cleaned = word.trim().slice(0, MAX_WORD_LEN);
    if (!cleaned || translating) return;
    setTranslating(true);
    setTranslation(null);
    setUserDefinition("");
    try {
      const { ok, data, error } = await apiPost<{ translation: string }>(
        "/api/vocab/translate",
        { word: cleaned, source: sourceLang, target: targetLang },
      );
      if (!ok || !data) {
        toastError(error ?? "Couldn't translate that word. Try again.");
        return;
      }
      setTranslation(data.translation);
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Translation failed.");
    } finally {
      setTranslating(false);
    }
  };

  const handleSave = async () => {
    if (!translation || saving) return;
    const cleanedWord = word.trim().slice(0, MAX_WORD_LEN);
    const cleanedDef = userDefinition.trim().slice(0, MAX_DEFINITION_LEN);
    if (!cleanedWord || !cleanedDef) return;
    setSaving(true);
    try {
      const { ok, data, error } = await apiPost<{ ok: true; fangs: number }>(
        "/api/vocab/words",
        {
          word: cleanedWord,
          translation,
          source_lang: sourceLang,
          target_lang: targetLang,
          user_definition: cleanedDef,
        },
      );
      if (!ok || !data) {
        toastError(error ?? "Couldn't save that word. Try again.");
        return;
      }
      toastSuccess(`+${data.fangs} Fangs! Word saved.`);
      resetForm();
      onSaved?.();
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Language pair toggle */}
      <div className="flex items-center justify-between">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55">
          translating from
        </p>
        <button
          type="button"
          onClick={flipLangPair}
          className="group inline-flex items-center gap-2 rounded-full px-3 py-1.5 border border-white/10 bg-white/5 backdrop-blur hover:bg-white/10 transition-colors"
          aria-label={`Swap language pair. Currently ${langs.source} to ${langs.target}.`}
        >
          <span className="font-bebas text-base tracking-wider text-cream leading-none">
            {langs.source}
          </span>
          <ArrowsClockwise size={12} weight="bold" className="text-cream/55 group-hover:text-electric transition-colors" aria-hidden="true" />
          <span className="font-bebas text-base tracking-wider text-gold leading-none">
            {langs.target}
          </span>
        </button>
      </div>

      {/* Word input */}
      <div>
        <label htmlFor="vocab-word-input" className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 block mb-2">
          word in {langs.source === "EN" ? "english" : "spanish"}
        </label>
        <div className="flex items-stretch gap-2">
          <input
            id="vocab-word-input"
            type="text"
            value={word}
            onChange={e => setWord(e.target.value.slice(0, MAX_WORD_LEN))}
            onBlur={e => setWord(e.target.value.trim())}
            onKeyDown={e => {
              if (e.key === "Enter" && canTranslate) {
                e.preventDefault();
                handleTranslate();
              }
            }}
            maxLength={MAX_WORD_LEN}
            placeholder={langPair === "en-es" ? "e.g. window" : "e.g. ventana"}
            className="flex-1 min-w-0 px-4 py-3 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-base focus:outline-none focus:border-electric/60 focus:bg-white/[0.07] transition-colors"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
          />
          <button
            type="button"
            onClick={handleTranslate}
            disabled={!canTranslate}
            className="px-5 rounded-xl font-syne font-bold text-sm bg-electric text-navy hover:bg-electric/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors inline-flex items-center gap-2"
          >
            <Translate size={16} weight="bold" aria-hidden="true" />
            <span>{translating ? "..." : "Translate"}</span>
          </button>
        </div>
        <p className="font-mono text-[9px] uppercase tracking-wider text-cream/35 mt-1.5 text-right">
          {word.length}/{MAX_WORD_LEN}
        </p>
      </div>

      {/* Translation card — appears after translate */}
      {translation && (
        <div
          className="rounded-2xl px-5 py-4 border border-electric/30 animate-slide-up"
          style={{ background: "linear-gradient(135deg, rgba(74,144,217,0.08) 0%, rgba(255,255,255,0.02) 100%)" }}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-electric/80 mb-1.5">
            {langs.targetName}
          </p>
          <p className="font-bebas text-2xl tracking-wider text-cream leading-tight">
            {translation}
          </p>
        </div>
      )}

      {/* Self-definition input — appears after translate */}
      {translation && (
        <div className="animate-slide-up" style={{ animationDelay: "0.05s" }}>
          <label htmlFor="vocab-self-def" className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 block mb-2">
            now write your own definition in {langs.targetName.toLowerCase()}
          </label>
          <textarea
            id="vocab-self-def"
            value={userDefinition}
            onChange={e => setUserDefinition(e.target.value.slice(0, MAX_DEFINITION_LEN))}
            placeholder={langPair === "en-es"
              ? "Describe la palabra con palabras simples..."
              : "Describe the word with simple words you already know..."}
            rows={3}
            maxLength={MAX_DEFINITION_LEN}
            className="w-full px-4 py-3 rounded-xl bg-white/5 backdrop-blur border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-gold/60 focus:bg-white/[0.07] transition-colors resize-none"
          />
          <div className="flex items-center justify-between mt-1.5">
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/45">
              use simple words you already know. this is what makes it stick.
            </p>
            <p className="font-mono text-[9px] uppercase tracking-wider text-cream/35 tabular-nums">
              {userDefinition.length}/{MAX_DEFINITION_LEN}
            </p>
          </div>

          {/* Soft language-mismatch nudge — does NOT block save. */}
          {showLangWarning && langDetect && (
            <div
              role="status"
              aria-live="polite"
              className="mt-2 inline-flex items-start gap-2 rounded-xl px-3 py-2 border border-gold/30 bg-gold/[0.06] backdrop-blur animate-slide-up"
            >
              <Lightbulb size={14} weight="fill" className="text-gold mt-0.5 shrink-0" aria-hidden="true" />
              <p className="font-syne text-xs text-gold/90 leading-snug">
                Looks like {LANG_NAME[langDetect.code as "en" | "es"]}. Try writing in {langs.targetName}. That is how it sticks.
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
      {!translation && !translating && word.length === 0 && (
        <div className="mt-2 rounded-2xl p-5 bg-white/[0.03] backdrop-blur border border-white/[0.06]">
          <p className="font-bebas text-sm tracking-[0.15em] text-gold/80 mb-2">
            ACTIVE RECALL METHOD
          </p>
          <p className="font-syne text-sm text-cream/75 leading-relaxed">
            Type a word, get the translation, then write your OWN simple definition in the target language. Writing the definition yourself is what locks the word into long-term memory.
          </p>
        </div>
      )}
    </div>
  );
}
