"use client";

// Drawing toolbar for Sketchy Subjects.
// Quick swatches (fast) + an expandable "roulette of colors" picker (a richer
// palette grid + a native color input for any custom color) + 3 brush sizes +
// eraser + undo + clear. No fill bucket, no text tool (anti-cheat per locked
// spec). The chosen color flows out through onColorChange — the single color
// SOURCE; the canvas stroke-sync logic is untouched.

import { useState } from "react";

export type SketchTool = "brush" | "eraser";

export const SKETCH_COLORS = [
  "#FFFFFF", // white
  "#F87171", // red
  "#FB923C", // orange
  "#FACC15", // yellow
  "#4ADE80", // green
  "#60A5FA", // blue
  "#A78BFA", // purple
  "#0A0A0A", // black (for outlines on light backgrounds)
] as const;

// Richer palette for the expanded picker — a spectrum sweep across hues plus a
// neutral ramp, so the drawer can pick accurate colors without leaving the app.
// Quick swatches above stay for speed; this is the "roulette" overflow.
export const SKETCH_PALETTE = [
  // reds / pinks
  "#FCA5A5", "#EF4444", "#B91C1C", "#F472B6", "#EC4899", "#BE185D",
  // oranges / ambers
  "#FDBA74", "#F97316", "#C2410C", "#FCD34D", "#F59E0B", "#B45309",
  // yellows / limes
  "#FEF08A", "#EAB308", "#A3E635", "#84CC16", "#4D7C0F", "#365314",
  // greens / teals
  "#86EFAC", "#22C55E", "#15803D", "#5EEAD4", "#14B8A6", "#0F766E",
  // blues / cyans
  "#7DD3FC", "#0EA5E9", "#2563EB", "#1E3A8A", "#38BDF8", "#0284C7",
  // purples / violets
  "#C4B5FD", "#8B5CF6", "#6D28D9", "#D8B4FE", "#A855F7", "#7E22CE",
  // browns / skin / neutrals
  "#92400E", "#D2691E", "#E8BEAC", "#C68642", "#8D5524", "#3F2A1D",
  // grays / mono ramp
  "#FFFFFF", "#D1D5DB", "#9CA3AF", "#6B7280", "#374151", "#0A0A0A",
] as const;

export const SKETCH_SIZES = [3, 8, 16] as const;

interface Props {
  tool: SketchTool;
  color: string;
  size: number;
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
  onToolChange,
  onColorChange,
  onSizeChange,
  onUndo,
  onClear,
  canUndo,
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const quickColors = SKETCH_COLORS as readonly string[];
  // The active brush color is "custom" when it's not one of the quick swatches.
  const isCustomColor = tool === "brush" && !quickColors.includes(color);

  function chooseColor(c: string) {
    onColorChange(c);
    onToolChange("brush");
  }

  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5 relative"
      style={{
        background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(10px)",
      }}
    >
      {/* Quick swatches (fast path) */}
      <div className="flex items-center gap-1.5">
        {SKETCH_COLORS.map((c) => {
          const active = color === c && tool === "brush";
          return (
            <button
              key={c}
              aria-label={`Color ${c}`}
              onClick={() => chooseColor(c)}
              className={`w-7 h-7 rounded-full transition-transform active:scale-90 ${active ? "scale-110" : "hover:scale-105"}`}
              style={{
                background: c,
                border: active ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.2)",
                boxShadow: active ? "0 0 10px rgba(255,215,0,0.5)" : "none",
              }}
            />
          );
        })}

        {/* Expand / "roulette of colors" affordance. Shows the current custom
            color as the swatch face when one is active. */}
        <button
          type="button"
          aria-label="More colors"
          aria-expanded={pickerOpen}
          onClick={() => setPickerOpen((o) => !o)}
          className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform active:scale-90 ${isCustomColor || pickerOpen ? "scale-110" : "hover:scale-105"}`}
          style={{
            // Conic gradient = the "color wheel" hint; if a custom color is
            // active, ring it in gold and show it as the center.
            background: isCustomColor
              ? color
              : "conic-gradient(from 0deg, #F87171, #FB923C, #FACC15, #4ADE80, #60A5FA, #A78BFA, #F472B6, #F87171)",
            border: isCustomColor || pickerOpen ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.25)",
            boxShadow: isCustomColor || pickerOpen ? "0 0 10px rgba(255,215,0,0.5)" : "none",
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
          <div className="grid grid-cols-8 gap-1.5">
            {SKETCH_PALETTE.map((c, i) => {
              const active = color.toLowerCase() === c.toLowerCase() && tool === "brush";
              return (
                <button
                  key={`${c}-${i}`}
                  aria-label={`Color ${c}`}
                  onClick={() => chooseColor(c)}
                  className={`w-6 h-6 rounded-md transition-transform active:scale-90 ${active ? "scale-110" : "hover:scale-110"}`}
                  style={{
                    background: c,
                    border: active ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.14)",
                    boxShadow: active ? "0 0 8px rgba(255,215,0,0.55)" : "none",
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

      {/* Sizes */}
      <div className="flex items-center gap-1.5">
        {SKETCH_SIZES.map((s) => (
          <button
            key={s}
            aria-label={`Brush size ${s}`}
            onClick={() => onSizeChange(s)}
            className={`w-7 h-7 rounded-full flex items-center justify-center transition-all active:scale-90 ${size === s ? "scale-110" : "hover:scale-105"}`}
            style={{
              background: size === s ? "rgba(168,85,247,0.25)" : "rgba(255,255,255,0.04)",
              border: size === s ? "1px solid rgba(168,85,247,0.6)" : "1px solid rgba(255,255,255,0.08)",
              boxShadow: size === s ? "0 0 10px rgba(168,85,247,0.45)" : "none",
            }}
          >
            <span
              className="rounded-full bg-cream/80 block"
              style={{ width: Math.min(20, s + 2), height: Math.min(20, s + 2) }}
            />
          </button>
        ))}
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

      {/* Clear */}
      <button
        aria-label="Clear canvas"
        onClick={onClear}
        className="px-3 py-1.5 rounded-lg font-bebas text-xs tracking-wider transition-all active:scale-95"
        style={{
          background: "rgba(239,68,68,0.1)",
          border: "1px solid rgba(239,68,68,0.3)",
          color: "#FCA5A5",
        }}
      >
        CLEAR
      </button>
    </div>
  );
}
