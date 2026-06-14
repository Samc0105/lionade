"use client";

/**
 * PhotoImport — "photograph it instead of typing/uploading" input mode.
 *
 * Lets a student point a photo / screenshot / scan of a syllabus, worksheet, or
 * textbook page at a feature instead of typing or uploading a PDF. The image is
 * OCR'd ENTIRELY ON THE DEVICE with Tesseract.js (WebAssembly); the recognized
 * text is handed back via `onExtract` so the parent decides what to do with it
 * (drop it in a textarea, POST it to a parser, etc.).
 *
 * Used by Mastery Mode (/learn/mastery, fills the goal textarea) and Academia
 * (SyllabusUpload, POSTs the text to the syllabus parser).
 *
 * COST: $0. No AWS Textract, no server compute, no per-use API call. The OCR
 * engine (worker + WASM core + the English model) is SELF-HOSTED under
 * /public/tess and loaded same-origin, so it rides the existing CSP with no
 * widening and never depends on a third-party CDN. The model downloads once
 * (browser caches it in IndexedDB); the photo bytes never leave the device.
 *
 * PERF: tesseract.js is dynamically imported inside the handler, so its heavy
 * worker/WASM never lands in the initial route bundle — it loads only on first
 * use. SSR-safe (the only static import is type-only and is erased at compile).
 */

import { useRef, useState, useCallback } from "react";
import { Camera, CheckCircle, Warning, X } from "@phosphor-icons/react";
import type { Worker as TesseractWorker } from "tesseract.js";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB — rejects giant uploads
const DEFAULT_MAX_OUTPUT_CHARS = 8000; // Mastery's textarea/parse cap
const OCR_TIMEOUT_MS = 90_000; // a stuck load/read fails cleanly instead of hanging

// Self-hosted engine paths (see /public/tess). Pinned to the SIMD+LSTM core,
// which every desktop browser since ~2021 supports; keeps the footprint small.
const TESS_OPTS = {
  workerPath: "/tess/worker.min.js",
  corePath: "/tess/core/tesseract-core-simd-lstm.wasm.js",
  langPath: "/tess/lang",
  workerBlobURL: false,
} as const;

type Phase = "idle" | "preparing" | "reading" | "done" | "error";

export default function PhotoImport({
  onExtract,
  disabled = false,
  label = "Scan a photo of your syllabus",
  doneLabel = "Added below. Review and edit, then start.",
  maxChars = DEFAULT_MAX_OUTPUT_CHARS,
}: {
  /** Called with the OCR'd text once a photo has been read. */
  onExtract: (text: string) => void;
  disabled?: boolean;
  /** Idle button label. */
  label?: string;
  /** Success message shown after a successful read. */
  doneLabel?: string;
  /** Cap the returned text length (match the consuming parser's input limit). */
  maxChars?: number;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "preparing" || phase === "reading";

  const runOcr = useCallback(
    async (file: File) => {
      setError(null);

      // Accept anything the browser tags as an image; if the MIME is blank
      // (rare picker quirk), fall back to the file extension before rejecting.
      const looksImageByExt = /\.(jpe?g|png|webp|gif|bmp|tiff?)$/i.test(file.name);
      if (file.type ? !file.type.startsWith("image/") : !looksImageByExt) {
        setPhase("error");
        setError("That's not an image. Use a photo or screenshot.");
        return;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        setPhase("error");
        setError("That image is over 10 MB. Try a smaller or cropped photo.");
        return;
      }
      // HEIC/HEIF (the iPhone camera default) can't be decoded by the OCR
      // engine. Catch it up front with actionable copy instead of a confusing
      // failure deep in recognition.
      if (/heic|heif/i.test(file.type) || /\.(heic|heif)$/i.test(file.name)) {
        setPhase("error");
        setError("HEIC photos aren't supported yet. Export it as JPG or PNG, then try again.");
        return;
      }

      setPhase("preparing");
      setProgress(0);

      let worker: TesseractWorker | null = null;
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        if (worker) void worker.terminate().catch(() => {});
      }, OCR_TIMEOUT_MS);

      // ── Phase 1: load the on-device engine (one-time download + init) ──
      try {
        const { createWorker } = await import("tesseract.js");
        worker = await createWorker("eng", 1, {
          ...TESS_OPTS,
          logger: (m) => {
            if (typeof m.progress !== "number") return;
            if (m.status === "recognizing text") {
              setPhase("reading");
              setProgress(m.progress);
            } else if (typeof m.status === "string" && m.status.startsWith("loading")) {
              // Surface the one-time model/core download so it never looks hung.
              setProgress(m.progress);
            }
          },
        });
      } catch (e) {
        clearTimeout(timer);
        if (worker) void worker.terminate().catch(() => {});
        console.error("[ocr:load]", e);
        setPhase("error");
        setError(
          timedOut
            ? "The reader took too long to load. Check your connection and try again."
            : "The on-device reader couldn't start. Refresh and try again.",
        );
        return;
      }

      // ── Phase 2: recognize the image (runs locally, no network) ──
      try {
        const { data } = await worker.recognize(file);
        const text = (data?.text ?? "")
          .replace(/[ \t]+\n/g, "\n") // trim trailing spaces on each line
          .replace(/\n{3,}/g, "\n\n") // collapse big vertical gaps
          .trim();

        if (text.length < 3) {
          setPhase("error");
          setError("Couldn't find readable text. Try a flatter, better lit photo.");
          return;
        }

        onExtract(text.slice(0, maxChars));
        setPhase("done");
      } catch (e) {
        console.error("[ocr:read]", e);
        setPhase("error");
        setError(
          timedOut
            ? "That took too long. Try a smaller or clearer photo."
            : "Couldn't read that image. Try a JPG or PNG screenshot.",
        );
      } finally {
        clearTimeout(timer);
        if (worker) {
          try {
            await worker.terminate();
          } catch {
            /* worker already gone — nothing to clean up */
          }
        }
      }
    },
    [onExtract, maxChars],
  );

  const onPick = () => {
    if (!busy && !disabled) inputRef.current?.click();
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Clear the value so picking the SAME file again still fires onChange.
    e.target.value = "";
    if (file) void runOcr(file);
  };

  // One coarse status string for screen readers: announced once per phase
  // change (no per-percent spam), and it covers the terminal done/error states.
  const srStatus =
    phase === "preparing"
      ? "Downloading the on-device reader"
      : phase === "reading"
        ? "Reading your photo"
        : phase === "done"
          ? "Photo read."
          : phase === "error"
            ? error ?? "Could not read the photo."
            : "";

  const pct = Math.round(progress * 100);

  return (
    <div className="mt-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={onFileChange}
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
      />

      {/* Single live region — coarse status + terminal states, no percent spam. */}
      <p className="sr-only" role="status" aria-live="polite">
        {srStatus}
      </p>

      {/* Persistent trigger: stays mounted across phases so keyboard focus is
          never destroyed mid-scan. Only its inner label changes. */}
      <button
        type="button"
        onClick={onPick}
        disabled={busy || disabled}
        aria-busy={busy}
        className={`group inline-flex items-center gap-2 rounded-full border px-4 py-2
          font-mono text-[10px] uppercase tracking-[0.22em] transition-colors
          disabled:cursor-not-allowed ${
            busy
              ? "border-gold/25 bg-gold/[0.05] text-gold"
              : "border-white/[0.12] bg-white/[0.03] text-cream/70 hover:border-white/[0.25] hover:text-cream disabled:opacity-40"
          }`}
      >
        {busy ? (
          <>
            <span
              className="h-3.5 w-3.5 shrink-0 rounded-full border-2 border-gold/30 border-t-gold motion-safe:animate-spin"
              aria-hidden="true"
            />
            <span>
              {phase === "preparing" ? "Downloading the reader" : "Reading your photo"}{" "}
              <span aria-hidden="true">{pct}%</span>
            </span>
          </>
        ) : (
          <>
            <Camera size={13} weight="bold" aria-hidden="true" />
            {phase === "done" ? "Scan another photo" : label}
          </>
        )}
      </button>

      {phase === "done" && (
        <p className="mt-2 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#22C55E]/90">
          <CheckCircle size={12} weight="fill" aria-hidden="true" />
          {doneLabel}
        </p>
      )}

      {phase === "error" && error && (
        <div className="mt-2 flex items-start gap-2 text-[12px] text-[#EF4444]">
          <Warning size={14} weight="fill" className="mt-0.5 shrink-0" aria-hidden="true" />
          <span className="flex-1">{error}</span>
          <button
            type="button"
            onClick={() => {
              setPhase("idle");
              setError(null);
            }}
            className="text-cream/40 hover:text-cream"
            aria-label="Dismiss error"
          >
            <X size={12} weight="bold" />
          </button>
        </div>
      )}

      <p className="mt-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-cream/30">
        Runs on your device. Nothing is uploaded.
      </p>
    </div>
  );
}
