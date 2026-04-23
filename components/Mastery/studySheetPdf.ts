/**
 * Mastery Mode → Study Sheet PDF generator.
 *
 * Client-side only. Gathers everything the user has seen this session
 * (teach cards, mnemonics, pitfalls, subtopic mastery) and lays it out as
 * a clean printable sheet using jsPDF's built-in fonts.
 *
 * No network calls here — the data has already been loaded by the session
 * page. Keeps the download instant and avoids burning another round-trip.
 */

import jsPDF from "jspdf";
import type { MessageShape } from "@/components/Mastery/MasteryMessage";

// ── Input shape ──────────────────────────────────────────────────────────────
export interface SubtopicSummary {
  name: string;
  weight: number;      // 0..1
  pMastery: number;    // 0..1
  displayPct: number;  // 0..100
  attempts: number;
  correct: number;
}

export interface StudySheetInput {
  examTitle: string;
  overallDisplayPct: number;
  pPass: number;
  readyThreshold: number;
  sessionDurationSec: number;
  questionsAnswered: number;
  correctCount: number;
  subtopics: SubtopicSummary[];
  messages: MessageShape[];
}

// ── Geometry ─────────────────────────────────────────────────────────────────
const MARGIN_X = 40;
const PAGE_W = 595;   // A4 portrait points (jsPDF default)
const PAGE_H = 842;
const LINE_H = 14;

export function downloadStudySheet(input: StudySheetInput): void {
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  let y = MARGIN_X;

  // Header
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  y += 6;
  doc.text("Mastery Mode — Study Sheet", MARGIN_X, y);
  y += 22;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(80);
  doc.text(input.examTitle, MARGIN_X, y);
  y += LINE_H;

  const minutes = Math.round(input.sessionDurationSec / 60);
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    `Generated ${new Date().toLocaleString()} · ${minutes} min this session · ${input.correctCount}/${input.questionsAnswered} right`,
    MARGIN_X, y,
  );
  y += LINE_H * 1.6;

  // Overall progress line
  doc.setDrawColor(220);
  doc.setLineWidth(0.6);
  doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
  y += 14;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(20);
  doc.text("Progress", MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  const overallTxt =
    `${Math.round(input.overallDisplayPct)}% overall` +
    `  ·  ${Math.round(input.pPass * 100)}% P(pass)` +
    `  ·  ready at ${Math.round(input.readyThreshold * 100)}%`;
  doc.text(overallTxt, MARGIN_X + 70, y);
  y += LINE_H * 1.4;

  // Per-subtopic bars
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text("Subtopic mastery", MARGIN_X, y);
  y += LINE_H;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const s of input.subtopics) {
    ensureRoom(doc, y, 18);
    y = yFrame(y, doc); // might reset on new page
    doc.setTextColor(40);
    const left = `${s.name}`;
    const right = `${Math.round(s.displayPct)}%`;
    doc.text(left, MARGIN_X, y);
    doc.text(right, PAGE_W - MARGIN_X, y, { align: "right" });
    // Weight chip + attempts
    doc.setTextColor(140);
    doc.setFontSize(8);
    doc.text(
      `weight ${Math.round(s.weight * 100)}  ·  ${s.correct}/${s.attempts} answered`,
      MARGIN_X, y + 10,
    );
    doc.setFontSize(10);
    y += 6;
    // Bar
    const barW = PAGE_W - MARGIN_X * 2;
    const barY = y + 4;
    doc.setDrawColor(230); doc.setFillColor(235, 235, 240);
    doc.rect(MARGIN_X, barY, barW, 3, "F");
    doc.setFillColor(60, 80, 140);
    doc.rect(MARGIN_X, barY, barW * (s.displayPct / 100), 3, "F");
    y += 16;
  }

  y += LINE_H * 0.5;

  // Teach cards — walk messages in order
  const teachMsgs = input.messages.filter(m => m.kind === "teach");
  if (teachMsgs.length > 0) {
    ensureRoom(doc, y, 40);
    y = yFrame(y, doc);
    doc.setDrawColor(220);
    doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
    y += 14;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text(`Key concepts covered (${teachMsgs.length})`, MARGIN_X, y);
    y += LINE_H * 1.3;

    for (const m of teachMsgs) {
      const p = m.payload as {
        title?: string; tldr?: string; bullets?: string[];
        mnemonic?: string | null; commonPitfall?: string | null; subtopicName?: string;
      } | null;
      if (!p) continue;

      ensureRoom(doc, y, 60);
      y = yFrame(y, doc);

      // Title
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(20);
      const titleLines = doc.splitTextToSize(p.title ?? "Teaching", PAGE_W - MARGIN_X * 2);
      doc.text(titleLines, MARGIN_X, y);
      y += LINE_H * titleLines.length;

      // Subtopic tag
      if (p.subtopicName) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8.5);
        doc.setTextColor(120);
        doc.text(p.subtopicName, MARGIN_X, y);
        y += LINE_H * 0.9;
      }

      // TLDR
      if (p.tldr) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(60);
        const lines = doc.splitTextToSize(p.tldr, PAGE_W - MARGIN_X * 2);
        ensureRoom(doc, y, LINE_H * lines.length + 4);
        y = yFrame(y, doc);
        doc.text(lines, MARGIN_X, y);
        y += LINE_H * lines.length + 2;
      }

      // Bullets
      if (Array.isArray(p.bullets) && p.bullets.length) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(40);
        for (const b of p.bullets) {
          const text = `• ${b}`;
          const lines = doc.splitTextToSize(text, PAGE_W - MARGIN_X * 2 - 10);
          ensureRoom(doc, y, LINE_H * lines.length);
          y = yFrame(y, doc);
          doc.text(lines, MARGIN_X + 6, y);
          y += LINE_H * lines.length;
        }
      }

      // Mnemonic
      if (p.mnemonic) {
        y += 4;
        doc.setFillColor(255, 247, 214);
        doc.setDrawColor(220, 200, 130);
        const lines = doc.splitTextToSize(`Remember: ${p.mnemonic}`, PAGE_W - MARGIN_X * 2 - 14);
        const h = LINE_H * lines.length + 10;
        ensureRoom(doc, y, h);
        y = yFrame(y, doc);
        doc.roundedRect(MARGIN_X, y - 10, PAGE_W - MARGIN_X * 2, h, 4, 4, "FD");
        doc.setTextColor(90, 70, 20);
        doc.setFont("helvetica", "italic");
        doc.setFontSize(9.5);
        doc.text(lines, MARGIN_X + 7, y);
        y += LINE_H * lines.length + 4;
      }

      // Pitfall
      if (p.commonPitfall) {
        doc.setFillColor(253, 235, 235);
        doc.setDrawColor(230, 180, 180);
        const lines = doc.splitTextToSize(`Common pitfall: ${p.commonPitfall}`, PAGE_W - MARGIN_X * 2 - 14);
        const h = LINE_H * lines.length + 10;
        ensureRoom(doc, y, h);
        y = yFrame(y, doc);
        doc.roundedRect(MARGIN_X, y - 10, PAGE_W - MARGIN_X * 2, h, 4, 4, "FD");
        doc.setTextColor(130, 40, 40);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(9.5);
        doc.text(lines, MARGIN_X + 7, y);
        y += LINE_H * lines.length + 4;
      }

      y += LINE_H;
    }
  }

  // All mnemonics at the end as a quick cheat sheet
  const mnemonics = teachMsgs
    .map(m => {
      const p = m.payload as { mnemonic?: string; subtopicName?: string } | null;
      return p?.mnemonic ? { mnemonic: p.mnemonic, subtopic: p.subtopicName ?? "" } : null;
    })
    .filter((x): x is { mnemonic: string; subtopic: string } => !!x);

  if (mnemonics.length > 0) {
    ensureRoom(doc, y, 50);
    y = yFrame(y, doc);
    doc.setDrawColor(220);
    doc.line(MARGIN_X, y, PAGE_W - MARGIN_X, y);
    y += 14;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.setTextColor(20);
    doc.text("Remember tips", MARGIN_X, y);
    y += LINE_H * 1.2;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(40);
    for (const m of mnemonics) {
      const text = m.subtopic ? `${m.subtopic} — ${m.mnemonic}` : m.mnemonic;
      const lines = doc.splitTextToSize(`• ${text}`, PAGE_W - MARGIN_X * 2 - 10);
      ensureRoom(doc, y, LINE_H * lines.length);
      y = yFrame(y, doc);
      doc.text(lines, MARGIN_X + 6, y);
      y += LINE_H * lines.length;
    }
  }

  // Footer on last page
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(150);
  doc.text("lionade.app · Mastery Mode", PAGE_W - MARGIN_X, PAGE_H - 24, { align: "right" });

  // Trigger download
  const safeName = input.examTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "mastery";
  doc.save(`${safeName}-study-sheet.pdf`);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Page-break if there isn't `needed` pts of vertical room left. Returns the
 *  new y-position (either the same y or the top of a fresh page). */
function ensureRoom(doc: jsPDF, y: number, needed: number): void {
  if (y + needed > PAGE_H - MARGIN_X) {
    doc.addPage();
  }
}
function yFrame(y: number, doc: jsPDF): number {
  // If a new page was added, reset y to top margin.
  // getNumberOfPages is authoritative; when addPage ran, we're on the new page.
  const pageCount = doc.getNumberOfPages();
  const currentPage = doc.getCurrentPageInfo().pageNumber;
  if (currentPage === pageCount && y > PAGE_H - MARGIN_X) return MARGIN_X;
  return y;
}
