"use client";

// SketchCanvas — HTML5 canvas drawing surface for Sketchy Subjects.
//
// Two modes (controlled by `readonly` prop):
//   1. Drawer mode (readonly=false): captures mouse/touch input, buffers
//      stroke points, broadcasts batches via Supabase Realtime to other
//      players, and POSTs persistence batches every ~500ms for late joiners.
//   2. Guesser mode (readonly=true): subscribes to the realtime channel and
//      paints incoming strokes. Also fetches initial stroke history (for
//      late-joiner replay) when mounted.
//
// Canvas coordinates are normalized to a 1000x600 logical space so they
// reproduce identically on every guesser's screen regardless of viewport.
//
// Stroke batches are sent at 30Hz (every 33ms) — high enough for smooth
// drawing, low enough to fit comfortably within Realtime broadcast limits.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { apiGet, apiPost } from "@/lib/api-client";
import { sketchStrokesChannel, SKETCH_EVENTS } from "@/lib/party/realtime-channels";
import { subscribeResilient } from "@/lib/realtime-resilient";

// Logical canvas coordinate space. All strokes are stored in this space and
// re-projected to whatever physical size the canvas is rendered at.
const LOGICAL_W = 1000;
const LOGICAL_H = 600;

// Canvas "paper" color. Light cream (playtest 2026-06: the old near-black
// #0a0a14 made the palette's Black / Navy / Dark Gray inks invisible — the
// locked 16-color palette is designed for a light drawing surface). The
// eraser repaints with this EXACT color so erases stay invisible; persisted
// eraser strokes are stored as "__erase__" and resolve to whatever this
// constant is at replay time, so history stays consistent with the bg.
export const SKETCH_CANVAS_BG = "#EEF4FF";

export interface SketchCanvasProps {
  roomCode: string;
  roundId: string;
  /** When true, this client cannot draw — it just renders incoming strokes. */
  readonly: boolean;
  /**
   * When true, the canvas is hard-blocked from drawing — input handlers no-op
   * AND a CSS class kills pointer events. Distinct from `readonly`: a drawer
   * is NOT readonly (they can still see their own strokes paint), but during
   * the celebrating / reveal phases they should not be able to add new strokes
   * after a guess lands. Set by SketchView when `phase` enters celebrating or
   * reveal so the round-end stamp visually locks the canvas.
   */
  disabled?: boolean;
  /** Currently selected brush color (drawer only) */
  color?: string;
  /** Currently selected brush size (drawer only) */
  size?: number;
  /** Current tool (drawer only) */
  tool?: "brush" | "eraser";
  /** Called when the local user finishes a stroke, used for undo state */
  onStrokeCountChange?: (n: number) => void;
  /** Fires every time a remote stroke arrives over the realtime channel. The
   *  guesser side uses this to show a "drawer is sketching..." indicator that
   *  pulses when strokes are arriving and fades when the drawer pauses. */
  onRemoteStrokeArrived?: () => void;
  /** Imperative ref handles for parent toolbar (undo / clear) */
  undoRef?: React.MutableRefObject<(() => void) | null>;
  clearRef?: React.MutableRefObject<(() => void) | null>;
}

interface StrokePayload {
  stroke_num: number;
  color: string;
  size: number;
  points: number[][];
  is_eraser?: boolean;
}

export default function SketchCanvas({
  roomCode,
  roundId,
  readonly,
  disabled = false,
  color = "#000000",
  size = 8,
  tool = "brush",
  onStrokeCountChange,
  onRemoteStrokeArrived,
  undoRef,
  clearRef,
}: SketchCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The complete stroke list (logical-coordinate). We render from this so undo
  // and re-render are clean.
  const strokesRef = useRef<StrokePayload[]>([]);
  // Currently-being-drawn stroke (drawer only).
  const inProgressRef = useRef<StrokePayload | null>(null);
  const nextStrokeNum = useRef(1);
  const flushTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // Strokes captured since the last persist batch (drawer only).
  const pendingPersist = useRef<StrokePayload[]>([]);
  // Strokes broadcast since the last realtime tick (we send each new stroke
  // segment as it grows so the guesser sees smooth motion, not jumps).
  const broadcastTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const [, force] = useState(0);
  const repaint = useCallback(() => force((n) => n + 1), []);

  // ── Single subscribed channel ref + helper ──
  // Must use channelRef; supabase.channel().send() silently no-ops on an
  // unsubscribed handle, which would silently drop strokes on fresh tabs.
  // Populated by the realtime-subscribe useEffect below.
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);

  const sendBroadcast = useCallback(
    async (event: string, payload: Record<string, unknown>) => {
      const ch = channelRef.current;
      if (!ch || !subscribedRef.current) return;
      const status = await ch.send({ type: "broadcast", event, payload });
      if (status !== "ok") {
        await new Promise((r) => setTimeout(r, 150));
        const retry = await ch.send({ type: "broadcast", event, payload });
        if (retry !== "ok") {
          console.warn("[SketchCanvas] broadcast retry failed", event, retry);
        }
      }
    },
    [],
  );

  // ── Initial late-joiner replay: fetch any persisted strokes for this round ──
  useEffect(() => {
    let cancelled = false;
    async function loadHistory() {
      const res = await apiGet<{ strokes: StrokePayload[] }>(
        `/api/party/sketch/rounds/${roundId}/strokes`,
      );
      if (cancelled) return;
      if (res.ok && res.data?.strokes) {
        strokesRef.current = res.data.strokes;
        nextStrokeNum.current =
          (res.data.strokes[res.data.strokes.length - 1]?.stroke_num ?? 0) + 1;
        repaint();
        onStrokeCountChange?.(strokesRef.current.length);
      }
    }
    void loadHistory();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roundId]);

  // ── Realtime subscribe: live stroke updates from the drawer ──
  useEffect(() => {
    const ch = supabase.channel(sketchStrokesChannel(roomCode));
    ch.on("broadcast", { event: SKETCH_EVENTS.STROKE }, (msg: { payload?: unknown }) => {
      const payload = (msg.payload ?? {}) as { stroke?: StrokePayload };
      if (!payload.stroke) return;
      const incoming = payload.stroke;
      // Replace-or-append by stroke_num so partial strokes (drawer still drawing)
      // get progressively updated in place.
      const idx = strokesRef.current.findIndex((s) => s.stroke_num === incoming.stroke_num);
      if (idx >= 0) {
        strokesRef.current[idx] = incoming;
      } else {
        strokesRef.current.push(incoming);
      }
      repaint();
      onRemoteStrokeArrived?.();
    });
    ch.on("broadcast", { event: SKETCH_EVENTS.CLEAR_CANVAS }, () => {
      strokesRef.current = [];
      repaint();
      onStrokeCountChange?.(0);
    });
    // Tier 1 lifecycle (2026-06-04): resilient subscribe — see SketchView.
    const handle = subscribeResilient(ch, {
      label: `sketch-strokes:${roomCode}`,
      // Stroke channel is silent on give-up — SketchView's room channel
      // already toasts the user once, no need to double-toast.
      silentOnGiveUp: true,
      onSubscribed: () => { subscribedRef.current = true; },
      onUnsubscribed: () => { subscribedRef.current = false; },
    });
    channelRef.current = ch;
    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      handle.cancel();
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomCode]);

  // ── Persist batch loop (drawer only): POST pending strokes every 500ms ──
  useEffect(() => {
    if (readonly) return;
    flushTimer.current = setInterval(async () => {
      if (pendingPersist.current.length === 0) return;
      const batch = pendingPersist.current;
      pendingPersist.current = [];
      // Convert eraser strokes to background color so the persisted history
      // replays correctly (we draw eraser as a "paint with bg color" stroke).
      const wireBatch = batch.map((s) => ({
        stroke_num: s.stroke_num,
        color: s.is_eraser ? "__erase__" : s.color,
        size: s.size,
        points: s.points,
      }));
      try {
        await apiPost(`/api/party/sketch/rounds/${roundId}/strokes`, { strokes: wireBatch });
      } catch (e) {
        console.warn("[SketchCanvas] persist failed", e);
      }
    }, 500);
    return () => {
      if (flushTimer.current) clearInterval(flushTimer.current);
    };
  }, [readonly, roundId]);

  // ── Render loop ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    function repaintAll() {
      if (!canvas || !ctx) return;
      const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;
      const targetW = canvas.clientWidth * dpr;
      const targetH = canvas.clientHeight * dpr;
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      // Clear with the paper color so eraser strokes look "erased".
      ctx.fillStyle = SKETCH_CANVAS_BG;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const scaleX = canvas.width / LOGICAL_W;
      const scaleY = canvas.height / LOGICAL_H;

      function paintStroke(s: StrokePayload) {
        if (!ctx) return;
        if (s.points.length < 1) return;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        const isErase = s.is_eraser || s.color === "__erase__";
        ctx.strokeStyle = isErase ? SKETCH_CANVAS_BG : s.color;
        ctx.lineWidth = (isErase ? Math.max(s.size, 14) : s.size) * Math.min(scaleX, scaleY);
        ctx.beginPath();
        const first = s.points[0];
        ctx.moveTo(first[0] * scaleX, first[1] * scaleY);
        for (let i = 1; i < s.points.length; i++) {
          const p = s.points[i];
          ctx.lineTo(p[0] * scaleX, p[1] * scaleY);
        }
        if (s.points.length === 1) {
          // Dot — draw a tiny line so the single click still shows up.
          ctx.lineTo(first[0] * scaleX + 0.01, first[1] * scaleY + 0.01);
        }
        ctx.stroke();
      }

      strokesRef.current.forEach(paintStroke);
      if (inProgressRef.current) paintStroke(inProgressRef.current);
    }
    repaintAll();
  });

  // ── Input handlers (drawer only) ──

  const getLogicalCoords = useCallback((clientX: number, clientY: number): [number, number] => {
    const canvas = canvasRef.current;
    if (!canvas) return [0, 0];
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * LOGICAL_W;
    const y = ((clientY - rect.top) / rect.height) * LOGICAL_H;
    return [Math.round(x), Math.round(y)];
  }, []);

  const broadcastInProgress = useCallback(async () => {
    const cur = inProgressRef.current;
    if (!cur) return;
    // 30Hz mid-stroke ticks: skip the retry helper here — losing one frame is
    // imperceptible and the final stroke broadcast in onPointerUp is the
    // authoritative one. Keep it cheap.
    const ch = channelRef.current;
    if (!ch || !subscribedRef.current) return;
    await ch.send({
      type: "broadcast",
      event: SKETCH_EVENTS.STROKE,
      payload: { stroke: { ...cur, color: cur.is_eraser ? "__erase__" : cur.color } },
    });
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (readonly || disabled) return;
      e.preventDefault();
      const [x, y] = getLogicalCoords(e.clientX, e.clientY);
      inProgressRef.current = {
        stroke_num: nextStrokeNum.current++,
        color,
        size,
        points: [[x, y]],
        is_eraser: tool === "eraser",
      };
      try {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      } catch {
        /* ignore */
      }
      // Start a broadcast loop that ticks at 33ms while we're drawing.
      if (broadcastTimer.current) clearInterval(broadcastTimer.current);
      broadcastTimer.current = setInterval(() => {
        void broadcastInProgress();
      }, 33);
      repaint();
    },
    [readonly, disabled, color, size, tool, getLogicalCoords, broadcastInProgress, repaint],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (readonly || disabled || !inProgressRef.current) return;
      const [x, y] = getLogicalCoords(e.clientX, e.clientY);
      const cur = inProgressRef.current;
      const last = cur.points[cur.points.length - 1];
      // Skip points that are too close together to keep payload size small.
      if (last && Math.hypot(x - last[0], y - last[1]) < 1.5) return;
      cur.points.push([x, y]);
      repaint();
    },
    [readonly, disabled, getLogicalCoords, repaint],
  );

  const onPointerUp = useCallback(() => {
    if (readonly || disabled || !inProgressRef.current) return;
    if (broadcastTimer.current) {
      clearInterval(broadcastTimer.current);
      broadcastTimer.current = null;
    }
    const final = inProgressRef.current;
    inProgressRef.current = null;
    strokesRef.current.push(final);
    pendingPersist.current.push(final);
    // Final broadcast so guessers definitely have the completed stroke.
    void sendBroadcast(SKETCH_EVENTS.STROKE, {
      stroke: { ...final, color: final.is_eraser ? "__erase__" : final.color },
    });
    onStrokeCountChange?.(strokesRef.current.length);
    repaint();
  }, [readonly, disabled, sendBroadcast, onStrokeCountChange, repaint]);

  // ── Imperative undo/clear handles for the parent toolbar ──
  useEffect(() => {
    if (!undoRef) return;
    undoRef.current = () => {
      if (readonly) return;
      strokesRef.current.pop();
      onStrokeCountChange?.(strokesRef.current.length);
      // Broadcast an undo as a clear+repaint signal (lazy: send a "full strokes"
      // payload to all clients). For V1 we use clear_canvas + re-broadcast all.
      void (async () => {
        await sendBroadcast(SKETCH_EVENTS.CLEAR_CANVAS, {});
        for (const s of strokesRef.current) {
          await sendBroadcast(SKETCH_EVENTS.STROKE, {
            stroke: { ...s, color: s.is_eraser ? "__erase__" : s.color },
          });
        }
      })();
      repaint();
    };
  }, [undoRef, readonly, sendBroadcast, onStrokeCountChange, repaint]);

  useEffect(() => {
    if (!clearRef) return;
    clearRef.current = () => {
      if (readonly) return;
      strokesRef.current = [];
      onStrokeCountChange?.(0);
      void sendBroadcast(SKETCH_EVENTS.CLEAR_CANVAS, {});
      repaint();
    };
  }, [clearRef, readonly, sendBroadcast, onStrokeCountChange, repaint]);

  const aspectStyle = useMemo(
    () => ({ aspectRatio: `${LOGICAL_W} / ${LOGICAL_H}` }),
    [],
  );

  return (
    <div
      className={`w-full rounded-2xl overflow-hidden relative ${disabled ? "pointer-events-none" : ""}`}
      style={{
        ...aspectStyle,
        background: SKETCH_CANVAS_BG,
        border: "1px solid rgba(255,255,255,0.14)",
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        touchAction: "none",
      }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{
          cursor:
            readonly || disabled ? "default" : tool === "eraser" ? "cell" : "crosshair",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
      />
    </div>
  );
}
