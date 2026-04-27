"use client";

import { useCallback, useRef, useState } from "react";
import useSWR from "swr";
import { FilePdf, UploadSimple, CheckCircle, Spinner, Warning, ArrowsClockwise } from "@phosphor-icons/react";
import { supabase } from "@/lib/supabase";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { toastError } from "@/lib/toast";

/**
 * Drop a syllabus PDF on a class. Uploads directly to the
 * `class-syllabi` Supabase Storage bucket, then calls
 * /api/classes/[id]/syllabus to register + AI-parse it.
 *
 * States:
 *   - idle       → drop zone (no syllabus, or last attempt failed)
 *   - uploading  → file is mid-upload to Storage
 *   - parsing    → server is reading + AI-extracting
 *   - parsed     → collapsed pill with "Re-upload" affordance
 *   - failed     → error pill with "Try again" affordance
 *
 * The bucket must be created manually in the Supabase dashboard:
 *   - name:        class-syllabi
 *   - private:     yes (no public access)
 *   - max size:    5 MB
 *   - mime types:  application/pdf only
 *   - RLS:         users can write into `${userId}/...` paths only
 */

const MAX_BYTES = 5 * 1024 * 1024;
const STORAGE_BUCKET = "class-syllabi";

interface SyllabusRow {
  id: string;
  filename: string;
  fileSizeBytes: number;
  status: "uploaded" | "parsing" | "parsed" | "failed";
  parseError: string | null;
  parsedTopics: Array<{ topic: string; week_n: number | null; est_hours: number | null }>;
  parsedExams: Array<{ name: string; date_iso: string | null; weight_pct: number | null }>;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  classId: string;
}

type UiPhase = "idle" | "uploading" | "parsing";

export default function SyllabusUpload({ classId }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [progressPct, setProgressPct] = useState(0);
  const [dragActive, setDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data, mutate } = useSWR<{ syllabus: SyllabusRow | null }>(
    classId ? `/api/classes/${classId}/syllabus` : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );
  const syllabus = data?.syllabus ?? null;

  const handleFile = useCallback(async (file: File) => {
    setError(null);

    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      setError("PDF only.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File must be 5 MB or smaller.");
      return;
    }
    if (file.size === 0) {
      setError("File is empty.");
      return;
    }

    // Need an authed Supabase session — the bucket should restrict by RLS to
    // the caller's `${userId}/...` folder.
    const { data: sess } = await supabase.auth.getSession();
    const userId = sess.session?.user?.id;
    if (!userId) {
      setError("Please sign in again.");
      return;
    }

    setPhase("uploading");
    setProgressPct(15);

    const objectKey = `${userId}/${classId}/${cryptoRandomUuid()}.pdf`;
    const upload = await supabase.storage.from(STORAGE_BUCKET).upload(objectKey, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: "application/pdf",
    });
    if (upload.error) {
      setPhase("idle");
      setProgressPct(0);
      const msg = /bucket|not.?found/i.test(upload.error.message)
        ? "Storage bucket missing — ask the team to create the `class-syllabi` bucket."
        : "Upload failed. Try again.";
      setError(msg);
      toastError(msg);
      return;
    }
    setProgressPct(70);

    setPhase("parsing");
    const res = await apiPost<{ ok: boolean; topicsCount: number; examsCount: number }>(
      `/api/classes/${classId}/syllabus`,
      { storagePath: objectKey, filename: file.name, fileSizeBytes: file.size },
    );

    setPhase("idle");
    setProgressPct(0);

    if (!res.ok) {
      setError(res.error ?? "Couldn't parse syllabus.");
      toastError(res.error ?? "Couldn't parse syllabus.");
      void mutate(); // pick up the failed row so we can show its state
      return;
    }
    void mutate();
  }, [classId, mutate]);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void handleFile(file);
  }, [handleFile]);

  const onChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) void handleFile(file);
    e.target.value = "";
  }, [handleFile]);

  // ── Render: parsed (success, collapsed) ─────────────────────────────────────
  if (phase === "idle" && syllabus?.status === "parsed") {
    return (
      <div className="mb-6 rounded-[10px] border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 flex items-center gap-3">
        <CheckCircle size={16} weight="fill" className="text-emerald-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-cream/85 truncate">
            <span className="font-syne font-semibold text-cream">Syllabus parsed</span>{" "}
            <span className="text-cream/50">— {syllabus.parsedTopics.length} topics, {syllabus.parsedExams.length} exams</span>
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40 truncate">
            {syllabus.filename}
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 hover:text-cream transition-colors inline-flex items-center gap-1.5 shrink-0"
        >
          <ArrowsClockwise size={11} weight="bold" /> Re-upload
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={onChange}
        />
      </div>
    );
  }

  // ── Render: parsing ────────────────────────────────────────────────────────
  if (phase === "parsing" || syllabus?.status === "parsing" || syllabus?.status === "uploaded") {
    return (
      <div className="mb-6 rounded-[12px] border border-gold/30 bg-gold/[0.04] px-4 py-4 flex items-center gap-3">
        <Spinner size={16} className="text-gold shrink-0 animate-spin" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-cream/90">
            <span className="font-syne font-semibold text-cream">Reading your syllabus…</span>
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/40 mt-0.5">
            Pulling out topics and exam dates · this takes 5-10 seconds
          </p>
        </div>
      </div>
    );
  }

  // ── Render: uploading ──────────────────────────────────────────────────────
  if (phase === "uploading") {
    return (
      <div className="mb-6 rounded-[12px] border border-gold/30 bg-gold/[0.04] px-4 py-4">
        <div className="flex items-center gap-3 mb-2">
          <UploadSimple size={16} className="text-gold shrink-0" />
          <p className="text-[13px] text-cream/90 font-syne font-semibold">Uploading…</p>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className="h-full bg-gold transition-[width] duration-300 ease-out"
            style={{ width: `${progressPct}%` }}
            aria-hidden="true"
          />
        </div>
      </div>
    );
  }

  // ── Render: idle (drop zone, possibly with last-failure note) ──────────────
  return (
    <div className="mb-6">
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={onDrop}
        className={`w-full rounded-[12px] border border-dashed transition-all duration-200 px-4 py-6 text-left
          ${dragActive
            ? "border-gold/60 bg-gold/[0.06]"
            : "border-white/[0.12] bg-white/[0.015] hover:border-white/[0.22] hover:bg-white/[0.03]"}`}
      >
        <div className="flex items-center gap-4">
          <div className="grid place-items-center w-10 h-10 rounded-lg bg-gold/10 text-gold shrink-0">
            <FilePdf size={18} weight="bold" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-syne font-semibold text-[14px] text-cream leading-snug">
              Drop your syllabus PDF here
            </p>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mt-1">
              We&apos;ll extract topics and exam dates · PDF · max 5 MB
            </p>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/50 shrink-0 hidden sm:inline">
            Click or drop
          </span>
        </div>
      </button>

      {error && (
        <div className="mt-2 rounded-[8px] border border-[#EF4444]/25 bg-[#EF4444]/[0.05] px-3 py-2 flex items-start gap-2">
          <Warning size={12} weight="bold" className="text-[#EF4444] shrink-0 mt-0.5" />
          <p className="text-[12px] text-cream/80">{error}</p>
        </div>
      )}

      {syllabus?.status === "failed" && !error && (
        <div className="mt-2 rounded-[8px] border border-[#EF4444]/25 bg-[#EF4444]/[0.05] px-3 py-2 flex items-start gap-2">
          <Warning size={12} weight="bold" className="text-[#EF4444] shrink-0 mt-0.5" />
          <p className="text-[12px] text-cream/80">
            Last upload couldn&apos;t be parsed{syllabus.parseError ? ` (${syllabus.parseError})` : ""}. Try a clearer PDF.
          </p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        onChange={onChange}
      />
    </div>
  );
}

// crypto.randomUUID is widely available but guard against older browsers /
// SSR with a tiny fallback.
function cryptoRandomUuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // RFC4122 v4-ish fallback
  return "xxxxxxxxxxxx4xxxyxxxxxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
