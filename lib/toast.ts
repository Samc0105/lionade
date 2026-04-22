/**
 * Standalone toast event store.
 *
 * Allows non-React code paths (SWR onError, fetch catch blocks, background
 * jobs) to emit toasts. The <ToastProvider /> subscribes on mount and pipes
 * events into its React state.
 *
 * Usage from outside React:
 *   import { toastError } from "@/lib/toast";
 *   apiGet("/foo").catch((e) => toastError(e.message));
 */

export type ToastType = "error" | "success" | "info";

export type ToastAction = {
  label: string;
  onClick: () => void;
};

export type ToastOptions = {
  type?: ToastType;
  duration?: number;
  action?: ToastAction;
};

export type ToastPayload = {
  message: string;
  options?: ToastOptions;
};

type Listener = (payload: ToastPayload) => void;

/**
 * Tiny event emitter. Not exported as a class — we want a stable singleton
 * that behaves identically across HMR boundaries.
 */
function createToastStore() {
  const listeners = new Set<Listener>();

  return {
    /** Subscribe to toast events. Returns an unsubscribe function. */
    subscribe(fn: Listener): () => void {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },

    /** Emit a toast event. All subscribers (usually just one Provider) receive it. */
    emit(_event: "toast", payload: ToastPayload): void {
      listeners.forEach((fn) => {
        try {
          fn(payload);
        } catch {
          // Listener errors must not break other subscribers
        }
      });
    },

    /** For tests / teardown */
    _clear(): void {
      listeners.clear();
    },
  };
}

export const toastStore = createToastStore();

/** Queue an error toast from anywhere (even outside React). */
export function toastError(msg: string, opts?: Omit<ToastOptions, "type">): void {
  toastStore.emit("toast", { message: msg, options: { ...opts, type: "error" } });
}

/** Queue a success toast from anywhere (even outside React). */
export function toastSuccess(msg: string, opts?: Omit<ToastOptions, "type">): void {
  toastStore.emit("toast", { message: msg, options: { ...opts, type: "success" } });
}

/** Queue an info toast from anywhere (even outside React). */
export function toastInfo(msg: string, opts?: Omit<ToastOptions, "type">): void {
  toastStore.emit("toast", { message: msg, options: { ...opts, type: "info" } });
}
