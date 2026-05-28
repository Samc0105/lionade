"use client";

// Drawing toolbar for Sketchy Subjects.
// 8 colors + 3 brush sizes + eraser + undo + clear. No fill bucket, no text
// tool (anti-cheat per locked spec).

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
  return (
    <div
      className="flex flex-wrap items-center gap-3 rounded-xl px-3 py-2.5"
      style={{
        background: "linear-gradient(135deg, rgba(16,12,26,0.85) 0%, rgba(8,6,16,0.85) 100%)",
        border: "1px solid rgba(255,255,255,0.08)",
        backdropFilter: "blur(10px)",
      }}
    >
      {/* Colors */}
      <div className="flex items-center gap-1.5">
        {SKETCH_COLORS.map((c) => {
          const active = color === c && tool === "brush";
          return (
            <button
              key={c}
              aria-label={`Color ${c}`}
              onClick={() => {
                onColorChange(c);
                onToolChange("brush");
              }}
              className={`w-7 h-7 rounded-full transition-transform active:scale-90 ${active ? "scale-110" : "hover:scale-105"}`}
              style={{
                background: c,
                border: active ? "2px solid #FFD700" : "1px solid rgba(255,255,255,0.2)",
                boxShadow: active ? "0 0 10px rgba(255,215,0,0.5)" : "none",
              }}
            />
          );
        })}
      </div>

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
