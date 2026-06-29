// Certification exam mode (Idea 32). A timed, mixed concept exam assembled from
// the shared ticket POOL across ALL career tracks, with a fixed length, a time
// limit, and a higher pass bar than a normal shift clear. Clearing it issues a
// shareable certificate (a static PNG drawn to an offscreen canvas, the same
// approach as the Idea 26 share result card in lib/liondesk/shareCard.ts).
//
// Deterministic by design: the exam form is seeded (the same exam for every
// candidate on a given day, like the Daily Combo), so the bar is fair and the
// same for everyone. The reducer, SLA math, and scoring all come from the shared
// engine, so the exam plays by the same rules as every other shift.
//
// The economy stays server authoritative: nothing here grants Fangs. The
// certificate is a cosmetic artifact (a credential to show off), the local best
// certificate record is display only, and the Fangs a finished run previews are
// still granted server side only, never from the client.

import type { Shift, ShiftItem } from "./types";
import type { ShiftResult } from "./engine";
import { POOL, MASTER_KB, MASTER_INVENTORY, MASTER_AD, type PoolEntry } from "./pool";
import { CONCEPTS, conceptForItem } from "./concepts";

/** How many tickets make up one certification exam. Fixed for every form. */
export const EXAM_LENGTH = 8;

/** The exam clock, in shift seconds. Longer than a standard shift to fit the
 *  broader, mixed concept board, but still timed so it plays like a real exam. */
export const EXAM_DURATION_SECONDS = 720;

/**
 * The score a run must reach to pass the exam and earn the certificate. Set well
 * above the normal clear gate (PASS_SCORE is 50 in lib/liondesk/scoring.ts): a
 * certification should mean a strong, broad performance, so the bar is an 80 (an
 * A on the shared grade ladder). This gates the certificate only. It never grants
 * Fangs, and the server still owns the real, clamped economy.
 */
export const EXAM_PASS_SCORE = 80;

/** Gold seal accent for the exam chrome and the certificate. */
export const EXAM_ACCENT = "#FFD700";

// A small, self contained deterministic RNG so the exam form is reproducible from
// its seed (the same generator the shift combiner uses, kept private there). With
// a fixed seed the exact same exam assembles for everyone, which is what keeps the
// certification bar fair.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: readonly T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export interface ExamOpts {
  /** Form seed. The same seed assembles the same exam for everyone (fairness). */
  seed?: number;
  /** Override the default fixed length. Defaults to EXAM_LENGTH. */
  count?: number;
  /** Override the exam name shown on the desk and the certificate. */
  name?: string;
}

/**
 * Assemble one certification exam Shift. Draws from the shared POOL across ALL
 * tracks (no track filter) and spreads the picks across as many distinct concepts
 * as possible by round robin over concept buckets, so the exam is genuinely mixed
 * concept and the certificate can list a broad coverage. Deterministic for a given
 * seed. Chain follow ups are stripped so the board stays exactly `count` tickets
 * (a fixed length exam), and the master KB / inventory / AD are unioned in so every
 * drawn ticket's tools resolve no matter which shift it came from. Pure and
 * deterministic, safe to call after mount. Grants nothing.
 */
export function assembleExam(opts: ExamOpts = {}): Shift {
  const seed = (opts.seed ?? 1) >>> 0;
  const rnd = mulberry32(seed);
  const count = opts.count ?? EXAM_LENGTH;

  // Bucket the seed shuffled pool by concept so we can round robin for coverage.
  const shuffled = shuffle(POOL, rnd);
  const buckets = new Map<string, PoolEntry[]>();
  for (const p of shuffled) {
    const c = conceptForItem(p.item);
    const arr = buckets.get(c);
    if (arr) arr.push(p);
    else buckets.set(c, [p]);
  }

  // Round robin: round 0 takes one ticket from every concept (max spread), round
  // 1 takes a second from each, and so on, until the board is full. Array.from
  // over the Map values keeps this typecheck clean on a low target (no spread of
  // a Map iterator).
  const lanes = Array.from(buckets.values());
  const picked: PoolEntry[] = [];
  for (let round = 0; picked.length < count; round++) {
    let progressed = false;
    for (const lane of lanes) {
      if (picked.length >= count) break;
      if (lane.length > round) { picked.push(lane[round]); progressed = true; }
    }
    if (!progressed) break;
  }

  // Strip the chain trigger fields so a follow up never appears mid exam and the
  // length stays fixed, then stagger arrivals like a normal generated shift.
  const items: ShiftItem[] = picked.slice(0, count).map((p, i) => {
    const base: ShiftItem = { ...p.item, arriveAfter: i < 3 ? 0 : (i - 2) * 18 };
    delete base.chainOnResolve;
    delete base.chainOnFail;
    return base;
  });

  return {
    // The track field only tints the desk chrome; the exam is cross track, so a
    // neutral home track is fine. The accent below drives the gold exam styling.
    id: `exam-${seed}`,
    track: "helpdesk",
    order: -1,
    name: opts.name ?? "Certification Exam",
    rank: "Certification Exam",
    accent: EXAM_ACCENT,
    durationSeconds: EXAM_DURATION_SECONDS,
    startingBudget: 3000,
    inventory: MASTER_INVENTORY,
    kb: MASTER_KB,
    adUsers: MASTER_AD,
    items,
    modifiers: [],
  };
}

/** The distinct concept labels an exam board covers, in taxonomy display order. */
export function examConcepts(shift: Shift): string[] {
  const present = new Set<string>();
  for (const it of shift.items) present.add(conceptForItem(it));
  return CONCEPTS.filter((c) => present.has(c.id)).map((c) => c.label);
}

/* ───────────────────────── certificate ───────────────────────── */

export interface ExamCertificate {
  /** Whether this attempt met EXAM_PASS_SCORE. Only passes are saved/shown. */
  passed: boolean;
  /** 0 to 100 final score. */
  score: number;
  /** Letter grade, "S" through "D". */
  grade: string;
  /** 0 to 100 customer satisfaction at the end of the exam. */
  csat: number;
  resolved: number;
  total: number;
  /** Distinct concept labels the exam covered. */
  concepts: string[];
  /** Friendly issue date, e.g. "June 29, 2026". No dashes. */
  dateLabel: string;
  /** ISO day key (YYYY-MM-DD) for storage and comparison. */
  dateIso: string;
  /** Deterministic, dash free credential id, e.g. "LXTHA1B2C3". */
  credentialId: string;
  /** The pass threshold this attempt was graded against (display). */
  passScore: number;
}

// A short, deterministic, dash free credential id from the run's identity, so the
// same pass always prints the same id and two passes never collide by chance.
function credentialIdFrom(parts: string): string {
  let h = 0;
  for (let i = 0; i < parts.length; i++) h = (h * 31 + parts.charCodeAt(i)) >>> 0;
  const tail = (h >>> 0).toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `LXTH${tail}`;
}

/**
 * Build the certificate for a finished exam from its Shift and ShiftResult. Pure
 * and deterministic for a given result + date. The certificate is cosmetic: it
 * reflects the run, grants nothing, and reads no balance.
 */
export function buildCertificate(shift: Shift, result: ShiftResult, when: Date = new Date()): ExamCertificate {
  const dateIso = when.toISOString().slice(0, 10);
  return {
    passed: result.score >= EXAM_PASS_SCORE,
    score: result.score,
    grade: result.grade,
    csat: result.csat,
    resolved: result.resolved,
    total: result.total,
    concepts: examConcepts(shift),
    dateLabel: when.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }),
    dateIso,
    credentialId: credentialIdFrom(`${shift.id}:${result.score}:${dateIso}`),
    passScore: EXAM_PASS_SCORE,
  };
}

/* ── certificate canvas. Mirrors lib/liondesk/shareCard.ts: a single static PNG
 *    drawn to an offscreen 2D canvas, no new dependencies, no remote images, so
 *    the canvas never taints and toBlob / toDataURL always succeed. One frame, so
 *    it is reduced motion safe by construction. ── */

const W = 1200;
const H = 630;
const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

function gradeColor(grade: string): string {
  if (grade === "S" || grade === "A") return "#2BBE6B";
  if (grade === "B") return "#4A90D9";
  if (grade === "C") return "#F59E0B";
  return "#EF4444";
}

function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}...`).width > maxW) t = t.slice(0, -1);
  return `${t}...`;
}

// Word wrap `text` into lines that each fit `maxW`, in the font set on the
// context. Returns the lines; the caller draws them. No dashes are introduced.
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
      if (lines.length >= maxLines) break;
    } else {
      line = test;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  if (lines.length === maxLines) lines[maxLines - 1] = truncate(ctx, lines[maxLines - 1], maxW);
  return lines;
}

/**
 * Draw the certificate onto the given canvas (sized to 1200x630). Pure, static,
 * synchronous. Safe on an offscreen canvas, so it causes no layout shift.
 */
export function drawCertificate(canvas: HTMLCanvasElement, c: ExamCertificate): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const gc = gradeColor(c.grade);

  // Dark interstellar base.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b1022");
  bg.addColorStop(1, "#05070e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Gold glow top right, purple glow bottom left, for depth.
  const glow = ctx.createRadialGradient(W - 220, 120, 40, W - 220, 120, 560);
  glow.addColorStop(0, hexToRgba(EXAM_ACCENT, 0.26));
  glow.addColorStop(1, hexToRgba(EXAM_ACCENT, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(150, H - 70, 30, 150, H - 70, 480);
  glow2.addColorStop(0, "rgba(168,85,247,0.16)");
  glow2.addColorStop(1, "rgba(168,85,247,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Glass panel plus an inner gold frame for the diploma feel.
  const pad = 26;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.stroke();
  roundRect(ctx, pad + 14, pad + 14, W - (pad + 14) * 2, H - (pad + 14) * 2, 20);
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(EXAM_ACCENT, 0.32);
  ctx.stroke();

  const left = 72;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Wordmark.
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 30px ${SANS}`;
  ctx.fillText("LIONADE", left, 92);
  const lw = ctx.measureText("LIONADE").width;
  ctx.fillStyle = "rgba(231,238,250,0.5)";
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText("TECHHUB", left + lw + 16, 92);

  // Heading.
  ctx.fillStyle = EXAM_ACCENT;
  ctx.font = `700 22px ${MONO}`;
  ctx.fillText("CERTIFICATE OF COMPLETION", left, 156);
  ctx.fillStyle = "#EEF4FF";
  ctx.font = `800 58px ${SANS}`;
  ctx.fillText(truncate(ctx, "TechHub Support Certification", 760), left, 218);

  // Grade badge, top right.
  const cx = W - 168;
  const cy = 142;
  const r = 80;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = hexToRgba(gc, 0.12);
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = gc;
  ctx.stroke();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = gc;
  ctx.font = `800 88px ${SANS}`;
  ctx.fillText(c.grade, cx, cy + 6);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(231,238,250,0.45)";
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText("GRADE", cx, cy + r + 28);
  ctx.textAlign = "left";

  // Score line plus passing pill.
  ctx.fillStyle = "rgba(231,238,250,0.85)";
  ctx.font = `700 24px ${SANS}`;
  ctx.fillText(`Final score ${c.score} of 100`, left, 270);
  ctx.font = `700 15px ${MONO}`;
  const passText = `PASSING SCORE ${c.passScore}`;
  const ptw = ctx.measureText(passText).width;
  const pillY = 286;
  roundRect(ctx, left, pillY, ptw + 30, 32, 16);
  ctx.fillStyle = hexToRgba(EXAM_ACCENT, 0.14);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(EXAM_ACCENT, 0.5);
  ctx.stroke();
  ctx.fillStyle = EXAM_ACCENT;
  ctx.fillText(passText, left + 15, pillY + 21);

  // Concepts demonstrated.
  const region = W - left - 72;
  ctx.fillStyle = "rgba(231,238,250,0.45)";
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText("CONCEPTS DEMONSTRATED", left, 372);
  ctx.fillStyle = "rgba(231,238,250,0.82)";
  ctx.font = `600 22px ${SANS}`;
  const conceptText = c.concepts.length ? c.concepts.join(", ") : "Cross track support fundamentals";
  const lines = wrapLines(ctx, conceptText, region, 3);
  lines.forEach((ln, i) => ctx.fillText(ln, left, 404 + i * 32));

  // Footer: date and credential on the left, domain on the right.
  ctx.fillStyle = "rgba(231,238,250,0.7)";
  ctx.font = `600 20px ${SANS}`;
  ctx.fillText(truncate(ctx, `Issued ${c.dateLabel}`, 620), left, H - 78);
  ctx.fillStyle = "rgba(231,238,250,0.45)";
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText(`CREDENTIAL ${c.credentialId}`, left, H - 52);
  ctx.textAlign = "right";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 22px ${SANS}`;
  ctx.fillText("getlionade.com", W - 72, H - 60);
  ctx.textAlign = "left";
}

/** Synchronous: draw on a fresh offscreen canvas and return a PNG data URL. */
export function renderCertificateDataUrl(c: ExamCertificate): string {
  const canvas = document.createElement("canvas");
  drawCertificate(canvas, c);
  return canvas.toDataURL("image/png");
}

/** Async: draw the certificate and resolve a PNG Blob (clipboard copy path). */
export function renderCertificateBlob(c: ExamCertificate): Promise<Blob> {
  const canvas = document.createElement("canvas");
  drawCertificate(canvas, c);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))), "image/png");
  });
}

/** A safe, descriptive download filename, e.g. "lionade-techhub-certificate-A.png". */
export function certificateFilename(c: ExamCertificate): string {
  return `lionade-techhub-certificate-${c.grade}.png`;
}

/* ───────────────────────── local best record (display only) ───────────────────────── */
// The player's best passing certificate, kept locally so the exam can show their
// standing and let them re open the card. Client only, grants nothing; the economy
// stays server authoritative. Same robust read / save shape as conceptMastery.ts.

const CERT_KEY = "lionade.techhub.exam.cert.v1";

export function getBestCertificate(): ExamCertificate | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(CERT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === "object" && (p as ExamCertificate).passed ? (p as ExamCertificate) : null;
  } catch {
    return null;
  }
}

/**
 * Persist a passing certificate, keeping the best one (highest score wins, ties
 * keep the earlier issue date). A failing attempt is ignored. Returns the stored
 * best. No op and a passthrough on the server. Grants nothing.
 */
export function saveCertificate(c: ExamCertificate): ExamCertificate | null {
  if (!c.passed) return getBestCertificate();
  if (typeof window === "undefined") return c;
  const prev = getBestCertificate();
  const best = prev && prev.score >= c.score ? prev : c;
  try { window.localStorage.setItem(CERT_KEY, JSON.stringify(best)); } catch { /* ignore */ }
  return best;
}

/** Whether the player has earned the certification at least once. Client only. */
export function isCertified(): boolean {
  return getBestCertificate() !== null;
}
