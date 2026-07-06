"use client";

import { useCallback, useRef, useState } from "react";
import { UploadSimple, FilePdf, Spinner } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";

/**
 * ResumeUpload — drag-drop dropzone + client-side magic-byte check.
 *
 * The server re-validates everything (size + %PDF magic + content), but
 * we do a quick client check so the user gets immediate feedback on a
 * .docx without burning a round-trip.
 *
 * Uses raw fetch() because apiPost doesn't accept FormData (it stringifies
 * the body as JSON). We hand-attach the Bearer token the same way
 * apiClient does so auth still works.
 */

const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

/**
 * Turn the analyze route's error response into a specific, actionable message.
 * The route returns real reasons (scanned PDF, too large, too short, parser
 * error), but this component used to collapse every one of them into a blind
 * "try again" that left the user with no idea what to fix. Surfacing the actual
 * cause is the fix. Copy is dash-free per the house style.
 *
 * Matching order: the stable machine `code` field first (exact match), then
 * prose-substring matching as a fallback for older deployed servers that only
 * send the prose `error`. Copy edits to the server prose can no longer degrade
 * the mapping to the generic fallback.
 */
const RESUME_ERROR_COPY: Record<string, string> = {
  too_large:
    "That PDF is over the 5 MB limit. Export or compress a smaller file and try again.",
  too_short:
    "We could not pull any readable text from that PDF. If it is a scan or a photo, export a text-based PDF (from Google Docs or Word) and upload that instead.",
  insufficient_analysis:
    "That resume is a bit thin for a full review. Add more detail (bullets, roles, outcomes) and upload again.",
  not_pdf: "That file is not a readable PDF. Export a fresh PDF and try again.",
  empty_file: "That file looks empty. Pick your resume PDF and try again.",
  no_file: "The upload did not go through. Refresh the page and try again.",
  bad_multipart: "The upload did not go through. Refresh the page and try again.",
  // parser_unavailable is a fault on OUR side (pdf-parse failed to load on the
  // server). Do not tell the user to re-export their file; it is fine.
  parser_unavailable:
    "Our PDF reader hit a snag on our side. Your file is fine. Try again shortly.",
  parse_failed:
    "We could not read that PDF. Try re-exporting it as a standard PDF and upload again.",
  ai_failed: "Ninny had trouble reviewing that one. Give it another go in a moment.",
  save_failed: "Something glitched while saving your review. Try again.",
};

function friendlyResumeError(
  status: number,
  body: { code?: unknown; error?: unknown; message?: unknown },
): string {
  const msg = typeof body?.message === "string" ? body.message : "";

  // 1. Stable machine code (exact match) — the source of truth.
  const machineCode = typeof body?.code === "string" ? body.code : "";
  if (machineCode === "pro_required")
    return msg || "Resume Coach is a Pro feature. Upgrade to unlock it.";
  if (machineCode && RESUME_ERROR_COPY[machineCode]) return RESUME_ERROR_COPY[machineCode];

  // 2. Prose fallback for old deployed servers that predate the code field.
  const code = typeof body?.error === "string" ? body.error.toLowerCase() : "";

  if (status === 403) return msg || "Resume Coach is a Pro feature. Upgrade to unlock it.";
  if (status === 413 || code.includes("too large")) return RESUME_ERROR_COPY.too_large;
  if (code.includes("too short") || code.includes("less than 100"))
    return RESUME_ERROR_COPY.too_short;
  if (code.includes("insufficient")) return RESUME_ERROR_COPY.insufficient_analysis;
  if (code.includes("not a valid pdf") || code.includes("real pdf"))
    return RESUME_ERROR_COPY.not_pdf;
  if (code.includes("empty")) return RESUME_ERROR_COPY.empty_file;
  if (code.includes("no file") || code.includes("multipart")) return RESUME_ERROR_COPY.no_file;
  if (code.includes("parser")) return RESUME_ERROR_COPY.parser_unavailable;
  if (code.includes("read that pdf")) return RESUME_ERROR_COPY.parse_failed;
  if (status === 502 || code.includes("analysis") || code === "ai analysis failed")
    return RESUME_ERROR_COPY.ai_failed;
  if (code.includes("save")) return RESUME_ERROR_COPY.save_failed;
  return "Couldn't analyze that resume. Try again.";
}

interface Props {
  onAnalyzed: (sessionId: string, analysis: ResumeAnalysis) => void;
}

export interface ResumeAnalysis {
  strengths: string[];
  weaknesses: string[];
  questions: { bullet: string; ask: string }[];
  answers: {
    question_index: number;
    user_response: string;
    improved_bullet: string;
    created_at: string;
  }[];
}

export default function ResumeUpload({ onAnalyzed }: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filename, setFilename] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    if (file.size > MAX_FILE_SIZE_BYTES) {
      setError("PDF is over 5 MB. Trim it down and try again.");
      return;
    }
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      setError("That doesn't look like a PDF.");
      return;
    }

    // Client-side magic-byte check — read the first 4 bytes
    try {
      const head = await file.slice(0, 4).arrayBuffer();
      const bytes = new Uint8Array(head);
      const sig = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
      if (sig !== "%PDF") {
        setError("That file isn't a real PDF.");
        return;
      }
    } catch {
      // If we can't read the head, let the server do the full check
    }

    setFilename(file.name);
    setBusy(true);
    try {
      const { data: sess } = await supabase.auth.getSession();
      const token = sess.session?.access_token ?? null;
      if (!token) {
        setError("Not signed in. Refresh and try again.");
        setBusy(false);
        return;
      }

      const fd = new FormData();
      fd.append("file", file);

      const res = await fetch("/api/coach/resume/analyze", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        console.error("[coach:resume-analyze] failed", res.status, body);
        setError(friendlyResumeError(res.status, body));
        setBusy(false);
        return;
      }

      if (!body?.sessionId || !body?.analysis) {
        console.error("[coach:resume-analyze] incomplete response", body);
        setError("Something glitched. Try again.");
        setBusy(false);
        return;
      }

      onAnalyzed(body.sessionId, body.analysis);
    } catch (e) {
      console.error("[ResumeUpload]", e);
      setError("Something broke on the way up. Try again.");
      setBusy(false);
    }
  }, [onAnalyzed]);

  const onDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const onInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    // reset input so the same file can be re-picked
    if (inputRef.current) inputRef.current.value = "";
  }, [handleFile]);

  return (
    <div className="animate-slide-up" style={{ animationDelay: "0.04s" }}>
      <style jsx>{`
        @keyframes coach-upload-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(255,215,0,0.0), 0 12px 32px rgba(0,0,0,0.25); }
          50%      { box-shadow: 0 0 0 6px rgba(255,215,0,0.10), 0 12px 32px rgba(0,0,0,0.25); }
        }
        .coach-upload-pulse { animation: coach-upload-glow 1.6s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) {
          .coach-upload-pulse { animation: none; }
        }
      `}</style>
      <div
        role="button"
        tabIndex={0}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => {
          if ((e.key === "Enter" || e.key === " ") && !busy) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        aria-label="Upload your resume as a PDF"
        aria-busy={busy}
        className={`relative rounded-2xl border backdrop-blur transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-gold/60 ${dragging ? "coach-upload-pulse" : ""}`}
        style={{
          background: dragging
            ? "rgba(255,215,0,0.08)"
            : "rgba(255,255,255,0.04)",
          borderColor: dragging
            ? "rgba(255,215,0,0.55)"
            : "rgba(255,255,255,0.10)",
          borderStyle: "dashed",
          borderWidth: "1.5px",
          padding: "56px 24px",
        }}
      >
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          onChange={onInputChange}
          className="hidden"
          aria-hidden="true"
        />

        <div className="flex flex-col items-center justify-center text-center gap-4 pointer-events-none">
          {busy ? (
            <>
              <Spinner
                size={40}
                weight="bold"
                color="#FFD700"
                aria-hidden="true"
                className="animate-spin"
              />
              <div>
                <p className="font-bebas text-2xl text-cream tracking-[0.08em]">
                  Ninny is reading your resume
                </p>
                <p className="font-syne text-xs text-cream/55 mt-1">
                  {filename ?? "Working on it"} <span className="text-cream/35">·</span> usually 8 to 12 seconds
                </p>
              </div>
            </>
          ) : (
            <>
              {dragging ? (
                <FilePdf size={44} weight="duotone" color="#FFD700" aria-hidden="true" />
              ) : (
                <UploadSimple size={40} weight="bold" color="#EEF4FF" aria-hidden="true" />
              )}
              <div>
                <p
                  className="font-bebas text-2xl tracking-[0.08em] transition-colors"
                  style={{ color: dragging ? "#FFD700" : "#EEF4FF" }}
                >
                  {dragging ? "Drop to upload" : "Drop your resume PDF here"}
                </p>
                <p className="font-syne text-xs text-cream/55 mt-1">
                  or click to pick a file <span className="text-cream/35">·</span> PDF only <span className="text-cream/35">·</span> max 5 MB
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-xl px-4 py-3 border border-red-400/40 bg-red-500/10"
        >
          <p className="font-syne text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  );
}
