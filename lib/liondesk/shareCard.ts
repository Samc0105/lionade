// Shareable shift result card (Idea 26). Renders a single static PNG that
// summarizes a finished LionDesk shift: track, grade, score, the Fangs preview,
// resolved count, CSAT, difficulty, and a replay link. It draws to an offscreen
// 2D canvas with no new dependencies and no remote images, so the canvas never
// taints and toBlob / toDataURL always succeed across browsers. The output is a
// single frame (no animation), so it is reduced motion safe by construction.
//
// The economy stays server authoritative: the Fangs printed here are exactly the
// preview number the report already shows (state.fangs) and are labelled as a
// preview. The card grants nothing, reads no balance, and talks to no backend.

export interface ShareCardData {
  /** Human track name, e.g. "IT Support". */
  trackLabel: string;
  /** The shift name, e.g. "Surprise Shift". */
  shiftName: string;
  /** Letter grade, "S" through "D". */
  grade: string;
  /** 0 to 100 score. */
  score: number;
  /** 0 to 100 customer satisfaction at shift end. */
  csat: number;
  /** Preview Fangs for the shift (display only, server still owns the grant). */
  fangs: number;
  resolved: number;
  total: number;
  /** Difficulty label, e.g. "Normal". */
  difficultyLabel: string;
  /** Shift accent hex, e.g. "#A855F7". */
  accent: string;
  /** Friendly footer line about replaying. No URL, no dashes. */
  replayLabel: string;
}

const W = 1200;
const H = 630;

// Mirrors the report's gradeColor so the card and the on screen report agree.
function gradeColor(grade: string): string {
  if (grade === "S" || grade === "A") return "#2BBE6B";
  if (grade === "B") return "#4A90D9";
  if (grade === "C") return "#F59E0B";
  return "#EF4444";
}

// "#RRGGBB" plus an alpha to an rgba() string. Falls back to the raw input for
// any value it cannot parse, so a stray named color never throws mid draw.
function hexToRgba(hex: string, a: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
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

// Clip a string to a pixel width with a trailing ellipsis, measured in the font
// currently set on the context.
function truncate(ctx: CanvasRenderingContext2D, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + "...").width > maxW) t = t.slice(0, -1);
  return t + "...";
}

const SANS = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';

function statTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  value: string,
  label: string,
  color: string,
): void {
  roundRect(ctx, x, y, w, h, 16);
  ctx.fillStyle = "rgba(255,255,255,0.03)";
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.stroke();
  ctx.textAlign = "left";
  ctx.fillStyle = color;
  ctx.font = `800 42px ${SANS}`;
  ctx.fillText(truncate(ctx, value, w - 36), x + 20, y + 60);
  ctx.fillStyle = "rgba(231,238,250,0.5)";
  ctx.font = `600 15px ${MONO}`;
  ctx.fillText(truncate(ctx, label, w - 36), x + 20, y + 96);
}

/**
 * Draw the result card onto the given canvas (sized to 1200x630). Pure, static,
 * synchronous. Safe to call on an offscreen canvas, so it causes no layout shift.
 */
export function drawShareCard(canvas: HTMLCanvasElement, d: ShareCardData): void {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const accent = d.accent || "#A855F7";
  const gc = gradeColor(d.grade);

  // Dark interstellar base gradient.
  const bg = ctx.createLinearGradient(0, 0, 0, H);
  bg.addColorStop(0, "#0b1022");
  bg.addColorStop(1, "#05070e");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Accent glow top right, grade colored glow bottom left, for depth.
  const glow = ctx.createRadialGradient(W - 210, 130, 40, W - 210, 130, 540);
  glow.addColorStop(0, hexToRgba(accent, 0.3));
  glow.addColorStop(1, hexToRgba(accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const glow2 = ctx.createRadialGradient(140, H - 70, 30, 140, H - 70, 480);
  glow2.addColorStop(0, hexToRgba(gc, 0.16));
  glow2.addColorStop(1, hexToRgba(gc, 0));
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, W, H);

  // Glass panel.
  const pad = 26;
  roundRect(ctx, pad, pad, W - pad * 2, H - pad * 2, 26);
  ctx.fillStyle = "rgba(255,255,255,0.02)";
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "rgba(255,255,255,0.10)";
  ctx.stroke();

  const left = 70;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";

  // Wordmark.
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 30px ${SANS}`;
  ctx.fillText("LIONADE", left, 96);
  const lw = ctx.measureText("LIONADE").width;
  ctx.fillStyle = "rgba(231,238,250,0.5)";
  ctx.font = `600 20px ${MONO}`;
  ctx.fillText("TECHHUB", left + lw + 16, 96);

  // Track + status line.
  ctx.fillStyle = accent;
  ctx.font = `700 22px ${MONO}`;
  ctx.fillText(truncate(ctx, `${d.trackLabel.toUpperCase()} · SHIFT COMPLETE`, 760), left, 178);

  // Shift name (truncated to the left column).
  ctx.fillStyle = "#EEF4FF";
  ctx.font = `800 60px ${SANS}`;
  ctx.fillText(truncate(ctx, d.shiftName, 740), left, 244);

  // Difficulty pill.
  ctx.font = `700 17px ${MONO}`;
  const diffText = `${d.difficultyLabel.toUpperCase()} DIFFICULTY`;
  const dtw = ctx.measureText(diffText).width;
  roundRect(ctx, left, 270, dtw + 32, 36, 18);
  ctx.fillStyle = hexToRgba(accent, 0.14);
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = hexToRgba(accent, 0.5);
  ctx.stroke();
  ctx.fillStyle = accent;
  ctx.fillText(diffText, left + 16, 294);

  // Grade badge, top right.
  const cx = W - 168;
  const cy = 150;
  const r = 84;
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
  ctx.font = `800 92px ${SANS}`;
  ctx.fillText(d.grade, cx, cy + 6);
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgba(231,238,250,0.45)";
  ctx.font = `600 16px ${MONO}`;
  ctx.fillText("GRADE", cx, cy + r + 30);
  ctx.textAlign = "left";

  // Stat tiles.
  const ty = 350;
  const th = 132;
  const cols = 4;
  const gap = 18;
  const region = W - left - 70;
  const tw = (region - gap * (cols - 1)) / cols;
  statTile(ctx, left + (tw + gap) * 0, ty, tw, th, `${d.score}`, "SCORE", accent);
  statTile(ctx, left + (tw + gap) * 1, ty, tw, th, `${d.resolved}/${d.total}`, "RESOLVED", "#2BBE6B");
  statTile(ctx, left + (tw + gap) * 2, ty, tw, th, `${d.csat}%`, "CSAT", "#4A90D9");
  statTile(ctx, left + (tw + gap) * 3, ty, tw, th, `${d.fangs}`, "FANGS · PREVIEW", "#FFD700");

  // Footer: friendly replay line on the left, domain on the right.
  ctx.fillStyle = "rgba(231,238,250,0.7)";
  ctx.font = `600 23px ${SANS}`;
  ctx.fillText(truncate(ctx, d.replayLabel, 760), left, H - 64);
  ctx.textAlign = "right";
  ctx.fillStyle = "#FFD700";
  ctx.font = `800 23px ${SANS}`;
  ctx.fillText("getlionade.com", W - 70, H - 64);
  ctx.textAlign = "left";
}

/** Synchronous: draw the card on a fresh offscreen canvas and return a PNG data URL. */
export function renderShareCardDataUrl(d: ShareCardData): string {
  const canvas = document.createElement("canvas");
  drawShareCard(canvas, d);
  return canvas.toDataURL("image/png");
}

/** Async: draw the card and resolve a PNG Blob (used for the clipboard copy path). */
export function renderShareCardBlob(d: ShareCardData): Promise<Blob> {
  const canvas = document.createElement("canvas");
  drawShareCard(canvas, d);
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob returned null"))),
      "image/png",
    );
  });
}

/** A safe, descriptive download filename, e.g. "lionade-surprise-shift-A.png". */
export function shareCardFilename(d: ShareCardData): string {
  const slug =
    d.shiftName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "shift";
  return `lionade-${slug}-${d.grade}.png`;
}
