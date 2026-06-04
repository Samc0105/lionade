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
        setError(body?.message ?? body?.error ?? "Couldn't analyze that resume.");
        setBusy(false);
        return;
      }

      if (!body?.sessionId || !body?.analysis) {
        setError("Server returned an incomplete response.");
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
        className="relative rounded-2xl border backdrop-blur transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-electric/60"
        style={{
          background: dragging
            ? "rgba(74,144,217,0.10)"
            : "rgba(255,255,255,0.04)",
          borderColor: dragging
            ? "rgba(74,144,217,0.55)"
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
                  {filename ?? "Working on it"} — usually 8 to 12 seconds
                </p>
              </div>
            </>
          ) : (
            <>
              {dragging ? (
                <FilePdf size={44} weight="duotone" color="#4A90D9" aria-hidden="true" />
              ) : (
                <UploadSimple size={40} weight="bold" color="#EEF4FF" aria-hidden="true" />
              )}
              <div>
                <p className="font-bebas text-2xl text-cream tracking-[0.08em]">
                  Drop your resume PDF here
                </p>
                <p className="font-syne text-xs text-cream/55 mt-1">
                  or click to pick a file · PDF only · max 5 MB
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
