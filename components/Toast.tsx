"use client";

/**
 * Lionade toast system.
 *
 * Single ToastProvider mounted once in app/layout.tsx. Exposes useToast() for
 * React code and subscribes to the lib/toast.ts event store so non-React code
 * (SWR onError, fetch .catch) can also queue toasts.
 *
 * Design rules enforced here:
 *   - GPU-accelerated transitions (transform + opacity only)
 *   - Motion tokens (--ease-out-expo, --ease-out-emil, --dur-state, --dur-enter)
 *   - prefers-reduced-motion ⇒ instant show/hide, no transitions
 *   - No gradient text, no decorative glassmorphism, no emoji
 *   - Radius tokens: card = var(--radius-md) (20px), close button = 8px
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  toastStore,
  type ToastAction,
  type ToastOptions,
  type ToastType,
} from "@/lib/toast";

// ─────────────────────────────────────────────────────────────────────────────
// Types

type ToastRecord = {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  action?: ToastAction;
  /** Marked true when exit animation starts; removed from DOM after exit duration. */
  leaving: boolean;
};

type ToastContextValue = {
  toast: (message: string, options?: ToastOptions) => string;
  dismiss: (id: string) => void;
  /** Pause the auto-dismiss timer for this toast (hover/focus). */
  pause: (id: string) => void;
  /** Resume the auto-dismiss timer using remaining time (mouse leave / blur). */
  resume: (id: string) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Constants

const MAX_TOASTS = 3;
const DEFAULT_DURATION_ERROR = 4000;
const DEFAULT_DURATION_OTHER = 2500;
const EXIT_DURATION_MS = 220;
const ENTER_DURATION_MS = 400;

const COLORS: Record<ToastType, { dot: string; border: string; role: "status" | "alert" }> = {
  error: {
    dot: "#EF4444",
    border: "rgba(239, 68, 68, 0.3)",
    role: "alert",
  },
  success: {
    dot: "#22C55E",
    border: "rgba(34, 197, 94, 0.3)",
    role: "status",
  },
  info: {
    dot: "#4A90D9",
    border: "rgba(74, 144, 217, 0.3)",
    role: "status",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Context

const ToastContext = createContext<ToastContextValue | null>(null);

/** Hook returns { toast, dismiss }. Must be called within <ToastProvider />. */
export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback: log but don't crash. This keeps dev ergonomics good if someone
    // forgets to mount the provider.
    if (process.env.NODE_ENV !== "production") {
      console.warn("[Toast] useToast() called outside <ToastProvider />");
    }
    return {
      toast: () => "",
      dismiss: () => {},
      pause: () => {},
      resume: () => {},
    };
  }
  return ctx;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers

/** Cheap enough id without depending on crypto.randomUUID (works in older browsers). */
function makeId(): string {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Detect reduced-motion preference. SSR-safe. */
function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  /** Dismiss timers keyed by toast id — cleared on manual dismiss or unmount. */
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  /** Per-toast timing metadata: remaining ms when paused, or startedAt for computing remaining on pause. */
  type Timing = { duration: number; startedAt: number; remaining: number };
  const timings = useRef<Map<string, Timing>>(new Map());

  /** Remove from array after exit animation has played. */
  const removeAfterExit = useCallback((id: string) => {
    const exit = prefersReducedMotion() ? 0 : EXIT_DURATION_MS;
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, exit);
  }, []);

  /** Start exit animation, then remove. Safe to call multiple times. */
  const dismiss = useCallback(
    (id: string) => {
      const existing = timers.current.get(id);
      if (existing) {
        clearTimeout(existing);
        timers.current.delete(id);
      }
      timings.current.delete(id);
      setToasts((prev) => {
        // If already leaving, no-op
        const target = prev.find((t) => t.id === id);
        if (!target || target.leaving) return prev;
        return prev.map((t) => (t.id === id ? { ...t, leaving: true } : t));
      });
      removeAfterExit(id);
    },
    [removeAfterExit]
  );

  /** Pause the auto-dismiss timer. Called on hover enter or focus. WCAG 2.2.1. */
  const pause = useCallback((id: string) => {
    const t = timers.current.get(id);
    const info = timings.current.get(id);
    if (!t || !info) return;
    clearTimeout(t);
    timers.current.delete(id);
    const elapsed = Date.now() - info.startedAt;
    info.remaining = Math.max(info.duration - elapsed, 200);
  }, []);

  /** Resume the auto-dismiss timer using remaining time. */
  const resume = useCallback(
    (id: string) => {
      const info = timings.current.get(id);
      if (!info) return;
      // If a timer is already running (wasn't paused), do nothing.
      if (timers.current.has(id)) return;
      info.startedAt = Date.now();
      info.duration = info.remaining;
      const handle = setTimeout(() => dismiss(id), info.remaining);
      timers.current.set(id, handle);
    },
    [dismiss]
  );

  /** Queue a new toast. Returns its id. */
  const toast = useCallback(
    (message: string, options?: ToastOptions): string => {
      const type: ToastType = options?.type ?? "info";
      const duration =
        options?.duration ??
        (type === "error" ? DEFAULT_DURATION_ERROR : DEFAULT_DURATION_OTHER);

      const id = makeId();
      const record: ToastRecord = {
        id,
        message,
        type,
        duration,
        action: options?.action,
        leaving: false,
      };

      setToasts((prev) => {
        // Newest first. If we overflow MAX_TOASTS, auto-dismiss the oldest.
        const next = [record, ...prev];
        if (next.length > MAX_TOASTS) {
          const overflow = next.slice(MAX_TOASTS);
          // Schedule dismissal on next tick so animations stay clean.
          queueMicrotask(() => {
            overflow.forEach((o) => dismiss(o.id));
          });
        }
        return next;
      });

      // Auto-dismiss timer + track start time so pause/resume can compute remaining
      const handle = setTimeout(() => {
        dismiss(id);
      }, duration);
      timers.current.set(id, handle);
      timings.current.set(id, { duration, startedAt: Date.now(), remaining: duration });

      return id;
    },
    [dismiss]
  );

  // Subscribe to the standalone toastStore so non-React code can emit toasts.
  useEffect(() => {
    const unsubscribe = toastStore.subscribe((payload) => {
      toast(payload.message, payload.options);
    });
    return unsubscribe;
  }, [toast]);

  // Clear all timers on unmount
  useEffect(() => {
    const map = timers.current;
    const tMap = timings.current;
    return () => {
      map.forEach((h) => clearTimeout(h));
      map.clear();
      tMap.clear();
    };
  }, []);

  const contextValue = useMemo<ToastContextValue>(
    () => ({ toast, dismiss, pause, resume }),
    [toast, dismiss, pause, resume]
  );

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} onPause={pause} onResume={resume} />
    </ToastContext.Provider>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Viewport (fixed container)

function ToastViewport({
  toasts,
  onDismiss,
  onPause,
  onResume,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      className="
        pointer-events-none
        fixed z-[60]
        left-0 right-0 bottom-4 px-4
        sm:left-auto sm:right-4 sm:bottom-4 sm:px-0
        flex flex-col-reverse gap-2
        sm:items-end
      "
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} onPause={onPause} onResume={onResume} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Individual toast

function ToastItem({
  toast,
  onDismiss,
  onPause,
  onResume,
}: {
  toast: ToastRecord;
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (id: string) => void;
}) {
  const color = COLORS[toast.type];
  const reduced = prefersReducedMotion();

  /**
   * Entry animation: start hidden then flip visible on next frame. Using
   * rAF (not setTimeout 0) so the browser paints the initial state first.
   */
  const [entered, setEntered] = useState<boolean>(reduced);

  useEffect(() => {
    if (reduced) return;
    let raf1 = 0;
    let raf2 = 0;
    raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEntered(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [reduced]);

  /** Whole-toast tap dismiss — but ignore clicks on interactive children. */
  const onRootClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, a")) return;
    onDismiss(toast.id);
  };

  /** Transform / opacity drive enter + exit. transition prop changes with state. */
  const show = entered && !toast.leaving;
  const transform = show ? "translateY(0)" : "translateY(12px)";
  const opacity = show ? 1 : 0;
  const transition = reduced
    ? "none"
    : toast.leaving
    ? `transform ${EXIT_DURATION_MS}ms var(--ease-out-emil), opacity ${EXIT_DURATION_MS}ms var(--ease-out-emil)`
    : `transform ${ENTER_DURATION_MS}ms var(--ease-out-expo), opacity ${ENTER_DURATION_MS}ms var(--ease-out-expo)`;

  return (
    <div
      role={color.role}
      onClick={onRootClick}
      onMouseEnter={() => onPause(toast.id)}
      onMouseLeave={() => onResume(toast.id)}
      onFocusCapture={() => onPause(toast.id)}
      onBlurCapture={() => onResume(toast.id)}
      className="
        pointer-events-auto
        w-full sm:w-auto sm:max-w-[420px] sm:min-w-[280px]
        min-h-[56px]
        cursor-pointer
        select-none
        flex items-center gap-3
        px-4 py-3
        font-syne
      "
      style={{
        background: "rgba(12, 16, 32, 0.95)",
        border: `1px solid ${color.border}`,
        borderRadius: "var(--radius-md)",
        color: "#EEF4FF",
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.4)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
        transform,
        opacity,
        transition,
        willChange: reduced ? undefined : "transform, opacity",
      }}
    >
      {/* Icon dot — 8px, colored by type */}
      <span
        aria-hidden="true"
        className="shrink-0 inline-block"
        style={{
          width: 8,
          height: 8,
          borderRadius: 9999,
          background: color.dot,
          boxShadow: `0 0 0 3px ${color.border}`,
        }}
      />

      {/* Message — truncates to 2 lines */}
      <div
        className="flex-1 min-w-0 text-[14px] leading-snug"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        <span className="font-bebas tracking-wide uppercase text-[11px] mr-2" style={{ color: "rgba(238,244,255,0.6)" }}>
          {labelFor(toast.type)}
        </span>
        <span style={{ color: "#EEF4FF" }}>{toast.message}</span>
      </div>

      {/* Optional action — outlined button */}
      {toast.action ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className="
            shrink-0
            font-bebas tracking-wider uppercase text-[12px]
            px-3 py-1.5
            transition-colors
          "
          style={{
            color: "#EEF4FF",
            border: `1px solid ${color.border}`,
            borderRadius: 8,
            background: "transparent",
            transitionDuration: "var(--dur-state)",
            transitionTimingFunction: "var(--ease-out-emil)",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "rgba(238,244,255,0.08)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          {toast.action.label}
        </button>
      ) : null}

      {/* Close button */}
      <button
        type="button"
        aria-label="Dismiss notification"
        onClick={(e) => {
          e.stopPropagation();
          onDismiss(toast.id);
        }}
        className="
          shrink-0
          inline-flex items-center justify-center
          w-7 h-7
          transition-colors
        "
        style={{
          color: "rgba(238,244,255,0.6)",
          background: "transparent",
          borderRadius: 8,
          transitionDuration: "var(--dur-state)",
          transitionTimingFunction: "var(--ease-out-emil)",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = "#EEF4FF";
          e.currentTarget.style.background = "rgba(238,244,255,0.08)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = "rgba(238,244,255,0.6)";
          e.currentTarget.style.background = "transparent";
        }}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
        >
          <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
        </svg>
      </button>
    </div>
  );
}

function labelFor(type: ToastType): string {
  switch (type) {
    case "error":
      return "Error";
    case "success":
      return "Success";
    case "info":
    default:
      return "Info";
  }
}
