"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { Scroll, Clock, ListChecks, Target, CheckCircle, WarningCircle, DownloadSimple, Copy, ArrowClockwise } from "@phosphor-icons/react";
import Link from "next/link";
import LionDesk from "@/components/liondesk/LionDesk";
import AchievementBanner from "@/components/liondesk/AchievementBanner";
import { dateSeed } from "@/lib/liondesk/generate";
import { recordPlayDay } from "@/lib/liondesk/playstreak";
import { recordShiftConcepts } from "@/lib/liondesk/conceptMastery";
import { recordShiftResult } from "@/lib/liondesk/stats";
import {
  assembleExam, buildCertificate, saveCertificate, getBestCertificate,
  renderCertificateDataUrl, renderCertificateBlob, certificateFilename, drawCertificate,
  EXAM_LENGTH, EXAM_DURATION_SECONDS, EXAM_PASS_SCORE, type ExamCertificate,
} from "@/lib/liondesk/exam";
import type { Shift } from "@/lib/liondesk/types";
import type { State, ShiftResult } from "@/lib/liondesk/engine";

const EXAM_MINUTES = Math.round(EXAM_DURATION_SECONDS / 60);

// The shareable certificate, rendered inline (not in a modal) so it stays
// keyboard and screen reader reachable, the same a11y reasoning as the share
// controls in PlayGeneratedShift. The canvas is a single static frame (reduced
// motion safe by construction) and the buttons reuse the exam canvas util. The
// card is cosmetic: it grants nothing and reads no balance.
function CertificatePanel({ cert, saveRef }: { cert: ExamCertificate; saveRef?: RefObject<HTMLButtonElement> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState("");
  const statusTimer = useRef<number | null>(null);

  // Draw the preview once the card data is known.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas) drawCertificate(canvas, cert);
  }, [cert]);
  useEffect(() => () => { if (statusTimer.current) window.clearTimeout(statusTimer.current); }, []);

  function flash(msg: string) {
    setStatus(msg);
    if (statusTimer.current) window.clearTimeout(statusTimer.current);
    statusTimer.current = window.setTimeout(() => setStatus(""), 3200);
  }

  function save() {
    try {
      // A synchronous data URL keeps the download inside the click gesture so it
      // is never blocked, the same pattern as the shift result card.
      const dataUrl = renderCertificateDataUrl(cert);
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = certificateFilename(cert);
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      flash("Certificate saved to your downloads.");
      // Best effort clipboard copy where supported. A failure is silent, the
      // download already gave a reliable path on every browser.
      if (typeof window !== "undefined" && "ClipboardItem" in window && navigator.clipboard?.write) {
        renderCertificateBlob(cert)
          .then((blob) => navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]))
          .then(() => flash("Certificate saved and copied to your clipboard."))
          .catch(() => {});
      }
    } catch {
      flash("Could not build the certificate. Try again.");
    }
  }

  async function copyImage() {
    if (typeof window === "undefined" || !("ClipboardItem" in window) || !navigator.clipboard?.write) {
      flash("Copy is not available here. Use Save image instead.");
      return;
    }
    try {
      const blob = await renderCertificateBlob(cert);
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("Certificate copied to your clipboard.");
    } catch {
      flash("Could not copy. Use Save image instead.");
    }
  }

  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.12) 0%, rgba(168,85,247,0.06) 55%, rgba(12,16,32,0.96) 100%)", border: "1px solid rgba(255,215,0,0.32)" }}>
      <div className="flex items-center gap-2 mb-2">
        <Scroll size={20} weight="fill" color="#FFD700" aria-hidden="true" />
        <h2 className="font-bebas text-2xl text-cream tracking-wider leading-none">YOU ARE CERTIFIED</h2>
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#2BBE6B" }}>
          <CheckCircle size={15} weight="fill" aria-hidden="true" /> Passed
        </span>
      </div>
      <p className="text-cream/65 text-xs leading-relaxed mb-3">
        You scored {cert.score} of 100 (grade {cert.grade}) and cleared the {cert.passScore} pass bar. Save the certificate below and share it anywhere. It is a cosmetic credential, nothing is granted.
      </p>

      {/* The certificate image, rendered at full size and downscaled with CSS. */}
      <div className="rounded-xl overflow-hidden border border-white/[0.08] bg-black mb-3" style={{ aspectRatio: "1200 / 630" }}>
        <canvas ref={canvasRef} width={1200} height={630} className="block w-full h-full" aria-label={`TechHub certification, grade ${cert.grade}, score ${cert.score} of 100`} />
      </div>

      <div className="flex flex-wrap gap-2">
        <button ref={saveRef} type="button" onClick={save} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gold/40 text-gold text-[11px] hover:bg-gold/10 transition-colors">
          <DownloadSimple size={13} weight="bold" aria-hidden="true" /> Save certificate
        </button>
        <button type="button" onClick={copyImage} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/15 text-cream/80 text-[11px] hover:bg-white/[0.06] transition-colors">
          <Copy size={13} weight="bold" aria-hidden="true" /> Copy image
        </button>
      </div>
      <p role="status" aria-live="polite" className="font-mono text-[10px] text-cream/50 mt-2 min-h-[1.2em]">{status}</p>
    </div>
  );
}

// A finished but failing attempt: show the gap to the bar and point to a retake.
function NotPassedPanel({ result }: { result: ShiftResult }) {
  return (
    <div className="rounded-2xl p-4 sm:p-5" style={{ background: "linear-gradient(135deg, rgba(239,68,68,0.12) 0%, rgba(168,85,247,0.05) 55%, rgba(12,16,32,0.96) 100%)", border: "1px solid rgba(239,68,68,0.3)" }}>
      <div className="flex items-center gap-2 mb-2">
        <WarningCircle size={20} weight="fill" color="#F87171" aria-hidden="true" />
        <h2 className="font-bebas text-2xl text-cream tracking-wider leading-none">NOT CERTIFIED YET</h2>
      </div>
      <p className="text-cream/65 text-xs leading-relaxed">
        You scored {result.score} of 100, just short of the {EXAM_PASS_SCORE} pass bar. Run it back to try the exam again. Today's form is the same for everyone and refreshes at midnight.
      </p>
    </div>
  );
}

/**
 * Certification exam mode (Idea 32). Runs a timed, fixed length, mixed concept
 * exam through the shared LionDesk runner, then issues a shareable certificate on
 * a pass. The exam form is date seeded, so today's exam is the same for every
 * candidate (a fair bar) and refreshes daily. Client only and mount guarded so no
 * localStorage value flashes a zero. The economy stays server authoritative: the
 * certificate is cosmetic and grants nothing, and the Fangs a run previews are
 * still granted server side only.
 */
export default function ExamMode() {
  const [mounted, setMounted] = useState(false);
  const [shift, setShift] = useState<Shift | null>(null);
  const [runKey, setRunKey] = useState(0);
  const [result, setResult] = useState<ShiftResult | null>(null);
  const [cert, setCert] = useState<ExamCertificate | null>(null);
  const [best, setBest] = useState<ExamCertificate | null>(null);
  const [newAch, setNewAch] = useState<string[]>([]);
  // Once the player dismisses the desk's end of shift report (its Back button is
  // wired to onExit below), the desk unmounts. That releases the report's
  // document level focus trap so the certificate panel above stops being
  // unreachable behind it and a keyboard user can finally Save or Copy it.
  const [finished, setFinished] = useState(false);
  const saveRef = useRef<HTMLButtonElement>(null);
  const retakeRef = useRef<HTMLButtonElement>(null);

  // Build the date seeded exam after mount so the date and the POOL draw never
  // run during SSR, and read the local best certificate the same way.
  useEffect(() => {
    setMounted(true);
    setShift(assembleExam({ seed: dateSeed() }));
    setBest(getBestCertificate());
  }, []);

  // When the report is dismissed (finished), the desk unmounts and its focus
  // trap releases. Move focus into the result so a keyboard user lands on the
  // primary action: Save on a pass, Run it back on a miss.
  useEffect(() => {
    if (!finished) return;
    if (cert?.passed) saveRef.current?.focus();
    else retakeRef.current?.focus();
  }, [finished, cert]);

  function retake() {
    // Same date seeded form (today's exam), fresh attempt. Remounts the desk and
    // clears the finished state so the next report can be played and dismissed.
    setShift(assembleExam({ seed: dateSeed() }));
    setRunKey((k) => k + 1);
    setResult(null);
    setCert(null);
    setNewAch([]);
    setFinished(false);
  }

  function onComplete(r: ShiftResult, state: State) {
    if (!shift) return;
    // Same recording as every other generated run: counts the day played, folds
    // the exact per item outcomes into concept mastery, and logs the run for
    // achievements. None of this grants Fangs (the server owns the economy).
    recordPlayDay();
    recordShiftConcepts(shift, state);
    setNewAch(recordShiftResult(shift, r));
    const c = buildCertificate(shift, r);
    setResult(r);
    setCert(c);
    if (c.passed) setBest(saveCertificate(c));
  }

  return (
    <div className="space-y-3">
      <AchievementBanner ids={newAch} />

      {/* Exam briefing: the rules, always visible above the desk. */}
      <div className="rounded-2xl p-4 sm:p-5" style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.10) 0%, rgba(168,85,247,0.06) 55%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(255,215,0,0.24)" }}>
        <div className="flex items-center gap-2">
          <Scroll size={18} weight="fill" color="#FFD700" aria-hidden="true" />
          <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">EXAM BRIEFING</h2>
          {mounted && best && (
            <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: "#2BBE6B" }} title={`Best grade ${best.grade}, score ${best.score}`}>
              <CheckCircle size={15} weight="fill" aria-hidden="true" /> Certified
            </span>
          )}
        </div>
        <p className="text-cream/60 text-[11px] mt-1.5 leading-relaxed">
          A timed certification covering every track. Clear the pass bar to earn a shareable certificate. Today's exam is the same for every candidate and refreshes at midnight. Cosmetic only, nothing is granted.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3">
          <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <ListChecks size={16} weight="fill" color="#C9A2F2" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-bebas text-base text-cream tracking-wide leading-none">{EXAM_LENGTH} tickets</p>
              <p className="text-cream/55 text-[11px] mt-0.5">Mixed concepts, all tracks.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <Clock size={16} weight="fill" color="#F87171" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-bebas text-base text-cream tracking-wide leading-none">{EXAM_MINUTES} minutes</p>
              <p className="text-cream/55 text-[11px] mt-0.5">The clock starts on clock in.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 rounded-xl p-2.5" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)" }}>
            <Target size={16} weight="fill" color="#FFD700" aria-hidden="true" />
            <div className="min-w-0">
              <p className="font-bebas text-base text-cream tracking-wide leading-none">{EXAM_PASS_SCORE} to pass</p>
              <p className="text-cream/55 text-[11px] mt-0.5">A higher bar than a normal clear.</p>
            </div>
          </div>
        </div>
      </div>

      {/* Result: the certificate on a pass, the gap to the bar on a miss. Rendered
          above the desk so it sits in reading order before the controls below. */}
      {cert?.passed && <CertificatePanel cert={cert} saveRef={saveRef} />}
      {result && !cert?.passed && <NotPassedPanel result={result} />}

      {/* The exam runs through the shared desk. Its clock in briefing is the start,
          and its report's Run it back retakes the same form. Dismissing the report
          (its Back button, wired to onExit) sets finished, which unmounts the desk
          so the report's focus trap releases and the certificate panel above
          becomes keyboard reachable, with the nav row below taking the desk's place. */}
      {!shift ? (
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-10 text-center text-cream/40 font-mono text-sm">assembling the exam...</div>
      ) : finished ? (
        <div className="flex flex-wrap gap-2">
          <button ref={retakeRef} type="button" onClick={retake} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl font-bold text-sm text-[#04080F]" style={{ background: "linear-gradient(135deg,#FFD700,#FFA500)" }}>
            <ArrowClockwise size={15} weight="bold" aria-hidden="true" /> Run it back
          </button>
          <Link href="/learn/techhub" className="inline-flex items-center px-4 py-2 rounded-xl border border-white/15 text-cream/80 text-sm font-semibold hover:bg-white/[0.05] transition-colors">Back to TechHub</Link>
        </div>
      ) : (
        <LionDesk key={`${shift.id}-${runKey}`} shift={shift} onComplete={onComplete} onReplay={retake} onExit={() => setFinished(true)} />
      )}

      <p className="font-mono text-[10px] text-cream/40 leading-relaxed">
        Fangs and XP shown on the desk are a preview. They are granted for real once a solve is validated on the server, so the in game economy stays tamper proof. The certificate is a cosmetic credential.
      </p>
    </div>
  );
}
