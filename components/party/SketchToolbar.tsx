"use client";

// Drawing toolbar for Sketchy Subjects.
// Quick swatches (fast) + an expandable "roulette of colors" picker (a richer
// palette grid + a native color input for any custom color) + 3 brush sizes +
// eraser + undo + clear. No fill bucket, no text tool (anti-cheat per locked
// spec). The chosen color flows out through onColorChange — the single color
// SOURCE; the canvas stroke-sync logic is untouched.

import { useEffect, useRef, useState } from "react";

export type SketchTool = "brush" | "eraser";

// Quick-row swatches. 12 colors picked to read well on the dark canvas bg
// (#0a0a14). Pure black was dropped — invisible on the canvas — and replaced
// with a slate that still reads as "dark." Added pink, cyan, brown, light gray
// to fill the gaps in the original 8 (the missing colors Sam called out).
export const SKETCH_COLORS = [
  "#FFFFFF", // white
  "#F87171", // red
  "#F472B6", // pink
  "#FB923C", // orange
  "#FACC15", // yellow
  "#4ADE80", // green
  "#22D3EE", // cyan
  "#60A5FA", // blue
  "#A78BFA", // purple
  "#92400E", // brown
  "#9CA3AF", // gray
  "#475569", // slate (the dark-but-visible tier — was #0A0A0A black, unusable)
] as const;

// Richer palette for the expanded picker — a spectrum sweep across hues plus a
// neutral ramp, sized for readability on dark canvas. The deepest tier of
// every hue was dropped (it disappeared on #0a0a14); medium and bright tiers
// retained + extra mid-tone neutrals + a wider skin-tone ramp added.
export const SKETCH_PALETTE = [
  // reds / pinks
  "#FECACA", "#FCA5A5", "#EF4444", "#F472B6", "#EC4899", "#BE185D",
  // oranges / ambers
  "#FED7AA", "#FDBA74", "#F97316", "#FDE68A", "#FCD34D", "#F59E0B",
  // yellows / limes
  "#FEF08A", "#FACC15", "#EAB308", "#BEF264", "#A3E635", "#84CC16",
  // greens / teals
  "#BBF7D0", "#86EFAC", "#22C55E", "#A7F3D0", "#5EEAD4", "#14B8A6",
  // blues / cyans
  "#A5F3FC", "#22D3EE", "#0EA5E9", "#BFDBFE", "#60A5FA", "#2563EB",
  // purples / violets
  "#DDD6FE", "#A78BFA", "#8B5CF6", "#F0ABFC", "#D8B4FE", "#A855F7",
  // skin tones (warm + cool ramp)
  "#FFE4C4", "#F1C27D", "#E0AC69", "#C68642", "#8D5524", "#5C3317",
  // grays / mono ramp (cropped to readable tiers)
  "#FFFFFF", "#E5E7EB", "#D1D5DB", "#9CA3AF", "#6B7280", "#475569",
] as const;

export const SKETCH_SIZES = [3, 8, 16] as const;

interface Props {
  tool: SketchTool;
  color: string;
  size: number;
  /** Last 5 colors the drawer reached for, most recent first. Persisted by
   *  the parent (localStorage) so the row survives across rounds. */
  recents?: string[];
  onToolChange: (tool: SketchTool) => void;
  onColorChange: (color: string) => void;
  onSizeChange: (size: number) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}

export default function SketchToolbar({
  tool,
  color,
  size,
  recents = [],
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onClear,
  canUndo,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  // Hovered size — when set, a preview dot at that size appears next to the
  // size buttons. Pure visual aid so the drawer knows what they'd get before
  // tapping. Cleared on mouseleave.
  const [hoveredSize, setHoveredSize] = useState<number | null>(null);
  // Clear-canvas tap-to-confirm. First tap arms the button (red state + new
  // label), second tap within 2s actually clears. Auto-disarms after 2s so
  // a stray first tap doesn't sit primed forever. Common pattern for
  // destructive single-tap actions on touch surfaces — a full modal would
  // break drawing flow.
  const [clearArmed, setClearArmed] = useState(false);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    };
  }, []);

  const quickColors = SKETCH_COLORS as readonly string[];
  // The active brush color is "custom" when it's not one of the quick swatches.
  const isCustomColor = tool === "brush" && !quickColors.includes(color);

  function chooseColor(c: string) {
    onColorChange(c);
    onToolChange("brush");
  }

  function handleClearTap() {
    if (!clearArmed) {
      setClearArmed(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = setTimeout(() => setClearArmed(false), 2000);
      return;
    }
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
    setClearArmed(false);
    onClear();
  }

  // Erase-mode tint — subtle purple wash on the toolbar background so the
  // drawer always knows the eraser is loaded without scanning for the active
  // tool button. The base glass shows through underneath.
  const eraseActive = tool === "eraser";

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 relative transition-colors"
      style={{
        background: eraseActive
          ? "linear-gradient(135deg, rgba(40,24,72,0.85) 0%, rgba(20,12,40,0.85) 100%)"
          : "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
        border: eraseActive ? "1px solid rgba(168,85,247,0.4)" : "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(10px)",
        boxShadow: eraseActive ? "inset 0 0 0 1px rgba(168,85,247,0.18)" : undefined,
      }}
    >
      {/* Quick swatches (fast path) */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {SKETCH_COLORS.map((c) => {
          const active = color === c && tool === "brush";
          return (
            <button
              key={c}
              aria-label={`Color ${c}`}
              onClick={() => chooseColor(c)}
              className={`w-7 h-7 rounded-full transition-transform active:scale-90 ${active ? "scale-110 pa-active-swatch" : "hover:scale-105"}`}
              style={{
                background: c,
                border: active ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.2)",
              }}
            />
          );
        })}

        {/* Recents — last 5 colors the drawer reached for, dedup'd against the
            quick row above so we don't waste slots showing the same swatch
            twice. Tiny divider before the chips so it reads as a distinct
            sub-section. Hidden when empty (cold-start drawer has nothing). */}
        {recents.filter((c) => !quickColors.includes(c)).length > 0 && (
          <>
            <span aria-hidden="true" className="mx-0.5 w-px h-5 bg-white/10" />
            {recents
              .filter((c) => !quickColors.includes(c))
              .slice(0, 5)
              .map((c, i) => {
                const active = color.toLowerCase() === c.toLowerCase() && tool === "brush";
                return (
                  <button
                    key={`recent-${c}-${i}`}
                    aria-label={`Recent color ${c}`}
                    onClick={() => chooseColor(c)}
                    className={`w-6 h-6 rounded-full transition-transform active:scale-90 ${active ? "scale-110 pa-active-swatch" : "hover:scale-110"}`}
                    style={{
                      background: c,
                      border: active ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.18)",
                    }}
                    title={`Recent: ${c}`}
                  />
                );
              })}
          </>
        )}

        {/* Expand / "roulette of colors" affordance. Shows the current custom
            color as the swatch face when one is active. */}
        <button
          type="button"
          aria-label="More colors"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform active:scale-90 ${isCustomColor || pickerOpen ? "scale-110 pa-active-swatch" : "hover:scale-105"}`}
          style={{
            // Conic gradient = the "color wheel" hint; if a custom color is
            // active, ring it in gold and show it as the center.
            background: isCustomColor
              ? color
              : "conic-gradient(from 0deg, #F87171, #FB923C, #FACC15, #4ADE80, #22D3EE, #60A5FA, #A78BFA, #F472B6, #F87171)",
            border: isCustomColor || pickerOpen ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.25)",
          }}
        >
          {!isCustomColor && (
            <span className="text-[10px] font-bold text-white drop-shadow" aria-hidden="true">
              +
            </span>
          )}
        </button>
      </div>

      {/* Expanded picker popover */}
      {pickerOpen && (
        <div
          className="absolute left-2 top-full mt-2 z-20 rounded-xl p-3 w-[15.5rem]"
          style={{
            background: "linear-gradient(135deg, rgba(20,15,32,0.97) 0%, rgba(10,8,20,0.97) 100%)",
            border: "1px solid rgba(168,85,247,0.4)",
            boxShadow: "0 12px 40px rgba(0,0,0,0.5), 0 0 24px rgba(168,85,247,0.12)",
            backdropFilter: "blur(14px)",
          }}
        >
          <p className="font-bebas text-[11px] tracking-[0.25em] text-cream/55 mb-2">
            COLOR ROULETTE
          </p>
          <div className="grid grid-cols-6 gap-1.5">
            {SKETCH_PALETTE.map((c, i) => {
              const active = color.toLowerCase() === c.toLowerCase() && tool === "brush";
              return (
                <button
                  key={`${c}-${i}`}
                  aria-label={`Color ${c}`}
                  onClick={() => chooseColor(c)}
                  className={`w-7 h-7 rounded-md transition-transform active:scale-90 ${active ? "scale-110 pa-active-swatch" : "hover:scale-110"}`}
                  style={{
                    background: c,
                    border: active ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.14)",
                  }}
                />
              );
            })}
          </div>

          {/* Native custom-color input — any color the drawer wants. */}
          <label className="mt-3 flex items-center gap-2 cursor-pointer">
            <span
              className="w-7 h-7 rounded-md flex-shrink-0 relative overflow-hidden"
              style={{ background: color, border: "1px solid rgba(255,255,255,0.2)" }}
            >
              <input
                type="color"
                value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : "#FFFFFF"}
                onChange={(e) => chooseColor(e.target.value)}
                aria-label="Pick a custom color"
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
              />
            </span>
            <span className="font-syne text-xs text-cream/70">Custom color</span>
          </label>
        </div>
      )}

      <div className="w-px h-7 bg-white/10" />

      {/* Sizes — visual swaps based on active tool. Brush = solid dot in the
          current color, eraser = hollow ring (reads as "no fill, just edge").
          Hovering any size shows a live preview swatch at the right of the row
          so the drawer can compare without committing. +/- keys on the canvas
          also drive these (handled in SketchView). */}
      <div
        className="flex items-center gap-1.5 relative"
        onMouseLeave={() => setHoveredSize(null)}
      >
        {SKETCH_SIZES.map((s) => {
          const active = size === s;
          const dotPx = Math.min(20, s + 2);
          return (
            <button
              key={s}
              aria-label={`${eraseActive ? "Eraser" : "Brush"} size ${s}`}
              onClick={() => onSizeChange(s)}
              onMouseEnter={() => setHoveredSize(s)}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${active ? "scale-110" : "hover:scale-105"}`}
              style={{
                background: active ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.04)",
                border: active ? "1px solid rgba(168,85,247,0.6)" : "1px solid rgba(255,255,255,0.08)",
                boxShadow: active ? "0 0 10px rgba(168,85,247,0.45)" : "none",
              }}
            >
              {eraseActive ? (
                // Hollow ring — "this is an eraser of this width."
                <span
                  className="rounded-full block"
                  style={{
                    width: dotPx,
                    height: dotPx,
                    border: "1.5px solid rgba(238,244,255,0.85)",
                    background: "transparent",
                  }}
                />
              ) : (
                // Solid dot in the current brush color so the drawer sees
                // exactly what their stroke will look like.
                <span
                  className="rounded-full block"
                  style={{
                    width: dotPx,
                    height: dotPx,
                    background: color,
                    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.15)",
                  }}
                />
              )}
            </button>
          );
        })}
        {/* Hover preview — appears to the right of the size row when the user
            mouses over a size button. Shows a larger sample at the actual
            stroke width so the drawer doesn't have to tap to see. */}
        {hoveredSize !== null && (
          <div
            className="ml-2 flex items-center gap-1.5 px-2 py-1 rounded-lg pointer-events-none"
            style={{
              background: "rgba(168,85,247,0.12)",
              border: "1px solid rgba(168,85,247,0.3)",
            }}
            aria-hidden="true"
          >
            <span
              className="rounded-full block"
              style={{
                width: hoveredSize * 1.6,
                height: hoveredSize * 1.6,
                background: eraseActive ? "transparent" : color,
                border: eraseActive ? "2px solid rgba(238,244,255,0.85)" : "1px solid rgba(0,0,0,0.15)",
              }}
            />
            <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-cream/55">
              {hoveredSize}px
            </span>
          </div>
        )}
      </div>

      <div className="w-px h-7 bg-white/10" />

      {/* Eraser */}
      <button
        aria-label="Eraser"
        onClick={() => onToolChange("eraser")}
        className={`px-3 py-1.5 rounded-lg font-bebas text-xs tracking-wider transition-all active:scale-95 ${tool === "eraser" ? "scale-105" : ""}`}
        style={{
          background: tool === "eraser" ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.04)",
          border: tool === "eraser" ? "1px solid rgba(168,85,247,0.6)" : "1px solid rgba(255,255,255,0.08)",
          color: tool === "eraser" ? "#E9D5FF" : "rgba(238,244,255,0.65)",
          boxShadow: tool === "eraser" ? "0 0 10px rgba(168,85,247,0.45)" : "none",
        }}
      >
        ERASER
      </button>

      {/* Undo */}
      <button
        aria-label="Undo last stroke"
        onClick={onUndo}
        disabled={!canUndo}
        className="px-3 py-1.5 rounded-lg font-bebas text-xs tracking-wider transition-all active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          color: "rgba(238,244,255,0.75)",
        }}
      >
        UNDO
      </button>

      {/* Clear — tap-to-confirm pattern. First tap arms (red + label change),
          second tap within 2s wipes. Auto-disarms after 2s. */}
      <button
        aria-label={clearArmed ? "Tap again to confirm clearing the canvas" : "Clear canvas"}
        onClick={handleClearTap}
        className="px-3 py-1.5 rounded-lg font-bebas text-xs tracking-wider transition-all active:scale-95"
        style={{
          background: clearArmed ? "rgba(239,68,68,0.28)" : "rgba(239,68,68,0.1)",
          border: clearArmed ? "1px solid rgba(239,68,68,0.7)" : "1px solid rgba(239,68,68,0.3)",
          color: clearArmed ? "#FFFFFF" : "#FCA5A5",
          boxShadow: clearArmed ? "0 0 14px rgba(239,68,68,0.45)" : "none",
        }}
      >
        {clearArmed ? "TAP TO CONFIRM" : "CLEAR"}
      </button>
    </div>
  );
}
