// Tiny window-event bus for the unified bottom-right LaunchDock.
//
// Each floating panel (Focus Music, Lock In, Quick Note) keeps its own state +
// panel JSX, but its standalone trigger button has been replaced by a single
// fluid expandable menu (LaunchDock). The dock dispatches an "open-panel"
// CustomEvent; each widget listens for its name and opens itself. Each widget
// also dispatches a "close-panel" event when its panel actually closes, so the
// dock can light up the limelight indicator for whichever panel is currently
// active and overlay a backdrop-blur on the rest of the screen.
//
// SSR-safe: every API guards on `typeof window`.

import { useEffect, useRef, useState } from "react";

export type LauncherPanel = "music" | "lockin" | "notes";

const OPEN_EVENT = "lionade:open-panel";
const CLOSE_EVENT = "lionade:close-panel";

export function openLauncherPanel(name: LauncherPanel): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ name: LauncherPanel }>(OPEN_EVENT, { detail: { name } }));
}

export function closeLauncherPanel(name: LauncherPanel): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<{ name: LauncherPanel }>(CLOSE_EVENT, { detail: { name } }));
}

/** Subscribe a panel to its open event. Calls `onOpen` when the dock asks for
 *  the panel by `name`. Handler is captured in a ref so the listener stays
 *  attached across renders. */
export function useOpenLauncherPanel(name: LauncherPanel, onOpen: () => void): void {
  const ref = useRef(onOpen);
  useEffect(() => { ref.current = onOpen; }, [onOpen]);
  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent<{ name: LauncherPanel }>;
      if (ce.detail?.name === name) ref.current();
    }
    window.addEventListener(OPEN_EVENT, handler);
    return () => window.removeEventListener(OPEN_EVENT, handler);
  }, [name]);
}

/** Subscribe a panel to its close event. Called when the dock REQUESTS close
 *  (user tapped a different dock item) so the widget closes itself. The widget
 *  should ALSO call `closeLauncherPanel(name)` from its own close handlers to
 *  announce its closure to the dock; this listener is for the inbound side. */
export function useCloseLauncherPanel(name: LauncherPanel, onClose: () => void): void {
  const ref = useRef(onClose);
  useEffect(() => { ref.current = onClose; }, [onClose]);
  useEffect(() => {
    function handler(e: Event) {
      const ce = e as CustomEvent<{ name: LauncherPanel }>;
      if (ce.detail?.name === name) ref.current();
    }
    window.addEventListener(CLOSE_EVENT, handler);
    return () => window.removeEventListener(CLOSE_EVENT, handler);
  }, [name]);
}

/** Dock-side hook that tracks which panel is currently active (open). Returns
 *  null when nothing is open. Updates as open/close events fire. */
export function useLauncherActivePanel(): LauncherPanel | null {
  const [active, setActive] = useState<LauncherPanel | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      const ce = e as CustomEvent<{ name: LauncherPanel }>;
      if (ce.detail?.name) setActive(ce.detail.name);
    }
    function onClose(e: Event) {
      const ce = e as CustomEvent<{ name: LauncherPanel }>;
      // Only clear if the closing panel is the active one — guards against a
      // race where a quick reopen of another panel already shifted active.
      setActive((cur) => (cur === ce.detail?.name ? null : cur));
    }
    window.addEventListener(OPEN_EVENT, onOpen);
    window.addEventListener(CLOSE_EVENT, onClose);
    return () => {
      window.removeEventListener(OPEN_EVENT, onOpen);
      window.removeEventListener(CLOSE_EVENT, onClose);
    };
  }, []);

  return active;
}
