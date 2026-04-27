"use client";

import { useEffect, useRef, useState } from "react";
import { ShareNetwork, DownloadSimple, X, Copy, Check } from "@phosphor-icons/react";
import { toastSuccess, toastError } from "@/lib/toast";

/**
 * ShareCard — flexible, canvas-rendered milestone share image for Lionade.
 *
 * Why canvas: PNG export must work on every browser without an external
 * library, and `navigator.share()` accepts Blob files. Rendering with
 * direct canvas API keeps the bundle small (no html2canvas).
 *
 * One template, several "kinds" of stat layouts. Caller passes a
 * `card: ShareCardData` shape and the modal handles preview + share.
 *
 *   <ShareCard
 *     open={open}
 *     onClose={() => setOpen(false)}
 *     card={{
 *       headline: "DAILY DRILL",
 *       subline: "5/5 perfect",
 *       bigNumber: { value: "+45", label: "Fangs earned" },
 *       stats: [
 *         { label: "Streak", value: "12d" },
 *         { label: "Day", value: "Tuesday" },
 *       ],
 *     }}
 *   />
 *
 * Default size: 1080x1080 (Instagram square / X large card). Renders
 * identically on every device because it's all canvas math.
 */

export interface ShareCardData {
  /** Top tag, e.g. "DAILY DRILL", "MASTERY", "FOCUS LOCK-IN" */
  headline: string;
  /** One-line context, e.g. "Perfect run" or "AWS Sec Specialty" */
  subline?: string;
  /** Big centerpiece number — the headline number of this card */
  bigNumber: { value: string; label: string };
  /** Up to 3 secondary stats shown in a row at the bottom */
  stats?: Array<{ label: string; value: string }>;
  /** Accent color (hex). Defaults to gold. */
  accent?: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  card: ShareCardData;
  /** Used as the share text and PNG filename. Defaults to "lionade-card". */
  shareTitle?: string;
}

const CARD_W = 1080;
const CARD_H = 1080;

export default function ShareCard({ open, onClose, card, shareTitle = "Lionade" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [busy, setBusy] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);

  // Render once when modal opens (or card data changes).
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawShareCard(canvas, card);
  }, [open, card]);

  // Esc closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const slug = (shareTitle || "lionade")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "lionade";

  const handleShare = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const blob = await canvasToBlob(canvas);
      if (!blob) {
        toastError("Couldn't build the image. Try again.");
        return;
      }
      const file = new File([blob], `${slug}.png`, { type: "image/png" });

      // Web Share API — only available on HTTPS + many mobile browsers.
      // Even where it works, file-share support varies. Try it; on
      // failure / unsupported, fall back to a download.
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
        share?: (data: ShareData) => Promise<void>;
      };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        try {
          await nav.share!({ files: [file], title: shareTitle, text: `${shareTitle} · made with Lionade` });
          toastSuccess("Shared!", { duration: 2500 });
          return;
        } catch {
          // user cancelled or share threw — fall through to download
        }
      }
      downloadBlob(blob, `${slug}.png`);
      toastSuccess("Image downloaded — post it anywhere.", { duration: 3000 });
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setBusy(true);
    try {
      const blob = await canvasToBlob(canvas);
      if (!blob) { toastError("Couldn't build image."); return; }
      downloadBlob(blob, `${slug}.png`);
      toastSuccess("Saved.");
    } finally { setBusy(false); }
  };

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText("https://getlionade.com");
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 1800);
    } catch {
      toastError("Couldn't copy.");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/75 backdrop-blur-md px-4 py-8"
      role="dialog"
      aria-modal="true"
      aria-label="Share your stats"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="relative w-full max-w-md rounded-[16px] border border-white/[0.1] bg-gradient-to-br from-navy to-[#0a0f1d] p-5 shadow-2xl animate-slide-up">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute top-3 right-3 grid place-items-center w-8 h-8 rounded-full text-cream/40 hover:text-cream hover:bg-white/[0.05]"
        >
          <X size={14} weight="bold" />
        </button>

        <div className="flex items-center gap-1.5 mb-3">
          <ShareNetwork size={13} className="text-gold" weight="fill" />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.3em] text-gold">
            Share
          </span>
        </div>

        {/* Preview — render the canvas at a smaller display size. The
            actual image stays at 1080×1080 for export; we just downscale
            via CSS for the on-screen preview. */}
        <div className="aspect-square rounded-[12px] overflow-hidden border border-white/[0.06] bg-black mb-4">
          <canvas
            ref={canvasRef}
            width={CARD_W}
            height={CARD_H}
            className="block w-full h-full"
            aria-label={`${card.headline} share preview`}
          />
        </div>

        <div className="grid grid-cols-3 gap-2 mb-3">
          <button
            type="button"
            onClick={handleShare}
            disabled={busy}
            className="rounded-[8px] bg-gold text-navy hover:bg-gold/90
              font-mono text-[10px] uppercase tracking-[0.22em] py-2.5
              inline-flex items-center justify-center gap-1.5
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <ShareNetwork size={12} weight="fill" /> Share
          </button>
          <button
            type="button"
            onClick={handleDownload}
            disabled={busy}
            className="rounded-[8px] border border-white/[0.1] text-cream/80 hover:text-cream hover:border-white/[0.25]
              font-mono text-[10px] uppercase tracking-[0.22em] py-2.5
              inline-flex items-center justify-center gap-1.5
              disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <DownloadSimple size={12} weight="bold" /> Save
          </button>
          <button
            type="button"
            onClick={handleCopyLink}
            className="rounded-[8px] border border-white/[0.1] text-cream/80 hover:text-cream hover:border-white/[0.25]
              font-mono text-[10px] uppercase tracking-[0.22em] py-2.5
              inline-flex items-center justify-center gap-1.5 transition-colors"
          >
            {copiedLink
              ? <><Check size={12} weight="bold" /> Copied</>
              : <><Copy size={12} weight="bold" /> Link</>}
          </button>
        </div>

        <p className="font-mono text-[9px] uppercase tracking-[0.22em] text-cream/30 text-center">
          Native share on phones · PNG download on desktop
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Canvas drawing — pure 2D context. Designed for 1080×1080 export.
// All values are absolute so the layout never depends on font metrics
// from the viewport.
// ─────────────────────────────────────────────────────────────────────────────
function drawShareCard(canvas: HTMLCanvasElement, card: ShareCardData) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const W = canvas.width;
  const H = canvas.height;
  const accent = card.accent || "#FFD700";

  // ── Background — deep gradient with starfield ────────────────────────────
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#04080F");
  bg.addColorStop(0.5, "#0a1428");
  bg.addColorStop(1, "#04080F");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle accent glow at center
  const glow = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W * 0.6);
  glow.addColorStop(0, hexA(accent, 0.18));
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Sparse starfield (deterministic seed for reproducibility)
  let seed = 1337;
  const rand = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  for (let i = 0; i < 60; i++) {
    const x = rand() * W;
    const y = rand() * H;
    const r = 0.5 + rand() * 1.5;
    ctx.globalAlpha = 0.3 + rand() * 0.4;
    ctx.fillStyle = "#EEF4FF";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // ── Top accent bar ───────────────────────────────────────────────────────
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, 8);

  // ── Brand corner — "LIONADE" wordmark ────────────────────────────────────
  ctx.font = "700 38px 'Bebas Neue', 'Helvetica Neue', sans-serif";
  ctx.fillStyle = "#FFD700";
  ctx.textBaseline = "top";
  ctx.textAlign = "left";
  ctx.fillText("LIONADE", 56, 56);

  ctx.font = "500 18px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = "rgba(238,244,255,0.5)";
  const tagline = "STUDY · EARN · CLIMB";
  ctx.textAlign = "right";
  ctx.fillText(tagline, W - 56, 64);

  // ── Headline tag (top-center) ────────────────────────────────────────────
  ctx.textAlign = "center";
  ctx.font = "500 26px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = accent;
  const headline = card.headline.toUpperCase();
  // Letter-spaced render
  drawSpacedText(ctx, headline, W / 2, 200, 6);

  // Optional subline
  if (card.subline) {
    ctx.font = "500 32px 'Syne', 'Helvetica Neue', sans-serif";
    ctx.fillStyle = "rgba(238,244,255,0.78)";
    wrapText(ctx, card.subline, W / 2, 252, W - 200, 38);
  }

  // ── Big centerpiece ──────────────────────────────────────────────────────
  // Glowy big number, optional "+" treatment
  const cy = card.subline ? H * 0.5 + 20 : H * 0.5;
  ctx.shadowColor = hexA(accent, 0.7);
  ctx.shadowBlur = 60;
  ctx.font = "700 280px 'Bebas Neue', 'Helvetica Neue', sans-serif";
  ctx.fillStyle = accent;
  ctx.textBaseline = "middle";
  ctx.fillText(card.bigNumber.value, W / 2, cy);
  ctx.shadowBlur = 0;

  // Big-number label below
  ctx.font = "500 28px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = "rgba(238,244,255,0.55)";
  drawSpacedText(ctx, card.bigNumber.label.toUpperCase(), W / 2, cy + 170, 5);

  // ── Stats row at the bottom ──────────────────────────────────────────────
  const stats = (card.stats || []).slice(0, 3);
  if (stats.length > 0) {
    const rowY = H - 200;
    const colW = W / stats.length;
    stats.forEach((s, i) => {
      const cx = colW * i + colW / 2;
      ctx.font = "700 64px 'Bebas Neue', 'Helvetica Neue', sans-serif";
      ctx.fillStyle = "#EEF4FF";
      ctx.textAlign = "center";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(s.value, cx, rowY);

      ctx.font = "500 20px 'DM Mono', ui-monospace, monospace";
      ctx.fillStyle = "rgba(238,244,255,0.45)";
      drawSpacedText(ctx, s.label.toUpperCase(), cx, rowY + 30, 4);
    });
  }

  // ── Footer ───────────────────────────────────────────────────────────────
  ctx.font = "500 22px 'DM Mono', ui-monospace, monospace";
  ctx.fillStyle = "rgba(238,244,255,0.35)";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  drawSpacedText(ctx, "GETLIONADE.COM", W / 2, H - 64, 6);
}

// ── helpers ──────────────────────────────────────────────────────────────────
function hexA(hex: string, a: number): string {
  // Accepts "#RRGGBB"; converts to rgba(r,g,b,a).
  const m = hex.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function drawSpacedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  letterSpacing: number,
) {
  // Render letter-by-letter with extra spacing between glyphs. Canvas
  // doesn't support letter-spacing natively in older browsers, so we DIY.
  const widths = text.split("").map(ch => ctx.measureText(ch).width);
  const total = widths.reduce((a, w) => a + w, 0) + letterSpacing * (text.length - 1);
  let x = cx - total / 2;
  text.split("").forEach((ch, i) => {
    ctx.textAlign = "left";
    ctx.fillText(ch, x, cy);
    x += widths[i] + letterSpacing;
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  ctx.textAlign = "center";
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, cx, cy + i * lineHeight));
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise(resolve => canvas.toBlob(b => resolve(b), "image/png", 1));
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
