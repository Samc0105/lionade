"use client";

// LaunchDock — one fluid expandable circular launcher at bottom-right that
// replaces the three stacked floating triggers (Focus Music, Lock In, Quick
// Note). The widget components still mount + render their own panels; they
// listen for an open/close event from this dock via `lib/launcher-bus.ts`.
//
// On top of the fluid menu:
//   - A blue LIMELIGHT pip + ring lights up next to whichever item is currently
//     active so you can see what's open at a glance (the 21st.dev limelight-nav
//     idea, adapted to a vertical circular column).
//   - The dock is a permanent utility surface, not a modal. The page behind the
//     active panel stays sharp + interactive; we don't dim or blur the world
//     just because Quick Note or Focus Music is open. (The avatar dropdown menu
//     in Navbar owns the only blur-the-page treatment in the app, because that
//     menu is a true modal surface.)
//   - The trigger is a toggle: tap a different item to switch panels (the
//     previous one is closed first); tap the same item to close.
//
// Closed state: one round 56px button with a Plus icon.
// Open state: items pop UP from the trigger, each clip-pathed to a circle, with
// the staggered cubic-bezier slide from 21st.dev's fluid menu. The trigger
// morphs Plus -> X (cross-fade + rotate).

import { useEffect, useRef, useState } from "react";
import { Plus, X, Headphones, Note, Lightning } from "@phosphor-icons/react";
import { useAuth } from "@/lib/auth";
import {
  openLauncherPanel,
  closeLauncherPanel,
  useLauncherActivePanel,
  type LauncherPanel,
} from "@/lib/launcher-bus";

interface Item {
  key: LauncherPanel;
  label: string;
  icon: React.ReactNode;
  accent: string;
}

const ITEMS: Item[] = [
  { key: "notes", label: "Quick note", icon: <Note size={22} weight="bold" />, accent: "#FFD700" },
  { key: "music", label: "Focus music", icon: <Headphones size={22} weight="bold" />, accent: "#A855F7" },
  { key: "lockin", label: "Lock in", icon: <Lightning size={22} weight="bold" />, accent: "#00BFFF" },
];

// Limelight blue — the brand's electric. Used regardless of the item's own
// accent so the active indicator reads consistently across the three options.
const LIMELIGHT = "#00BFFF";
const ITEM_GAP = 64;

export default function LaunchDock() {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const activePanel = useLauncherActivePanel();
  const rootRef = useRef<HTMLDivElement | null>(null);

  // The three panel widgets (Quick Note, Focus Music, Lock In) already gate
  // on `user?.id`, but this dock — the visible launcher — did not, so the
  // buttons showed on the logged-out landing page and did nothing when
  // tapped. Gate the dock the same way. useAuth seeds `user` from
  // localStorage on the client, so defer the auth-driven render until after
  // mount to avoid a hydration mismatch (mirrors FocusLockIn et al.).
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  // Close-on-outside-click for the EXPANDED tray itself. Tapping outside
  // collapses the menu, but does NOT close the active panel — the panel has
  // its own X.
  useEffect(() => {
    if (!expanded) return;
    function onDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setExpanded(false);
    }
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [expanded]);

  // Esc closes the tray.
  useEffect(() => {
    if (!expanded) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  function pick(key: LauncherPanel) {
    setExpanded(false);
    if (activePanel === key) {
      // Toggle off — close the active panel.
      closeLauncherPanel(key);
      return;
    }
    // Switching panels — close the previous one first (idempotent).
    if (activePanel) closeLauncherPanel(activePanel);
    openLauncherPanel(key);
  }

  // Logged-out (or pre-mount) — render nothing. Placed after every hook so
  // the hook order stays stable across renders.
  if (!mounted || !user?.id) return null;

  return (
    <>
      {/* ── Dock root ──────────────────────────────────────────────────────
          Bottom-right; lifted higher on mobile so it doesn't crash into the
          bottom mobile nav. Hidden below sm (mobile nav owns that zone). */}
      <div
        ref={rootRef}
        data-expanded={expanded}
        data-active={activePanel ?? "none"}
        className="fixed z-40 right-4 md:right-6 bottom-[88px] md:bottom-[24px] hidden sm:block"
        style={{ width: 56, height: 56 }}
      >
        {/* Trigger — anchors the stack */}
        <button
          type="button"
          aria-label={expanded ? "Close launcher" : "Open launcher"}
          aria-expanded={expanded}
          onClick={() => setExpanded((e) => !e)}
          className="absolute inset-0 rounded-full flex items-center justify-center shadow-xl shadow-black/40 active:scale-[0.94] transition-all duration-300 will-change-transform z-50"
          style={{
            background: "linear-gradient(135deg, rgba(28,22,48,0.92) 0%, rgba(10,8,18,0.95) 100%)",
            border: activePanel
              ? `1px solid ${LIMELIGHT}80`
              : "1px solid rgba(255,255,255,0.12)",
            boxShadow: activePanel
              ? `0 8px 28px rgba(0,0,0,0.5), 0 0 18px ${LIMELIGHT}40, inset 0 0 0 1px ${LIMELIGHT}30`
              : "0 8px 28px rgba(0,0,0,0.5)",
            backdropFilter: "blur(14px)",
          }}
        >
          {/* Plus -> X morph */}
          <span className="relative inline-block w-6 h-6">
            <span
              className="absolute inset-0 flex items-center justify-center text-cream transition-all duration-300 ease-out"
              style={{
                opacity: expanded ? 0 : 1,
                transform: expanded ? "rotate(120deg) scale(0.6)" : "rotate(0deg) scale(1)",
              }}
            >
              <Plus size={22} weight="bold" />
            </span>
            <span
              className="absolute inset-0 flex items-center justify-center text-cream transition-all duration-300 ease-out"
              style={{
                opacity: expanded ? 1 : 0,
                transform: expanded ? "rotate(0deg) scale(1)" : "rotate(-120deg) scale(0.6)",
              }}
            >
              <X size={22} weight="bold" />
            </span>
          </span>

          {/* When collapsed AND a panel is active, a tiny indicator dot in the
              corner names which panel without expanding the tray. */}
          {!expanded && activePanel && (
            <span
              aria-hidden="true"
              className="absolute -top-0.5 -right-0.5 w-3 h-3 rounded-full pointer-events-none"
              style={{
                background: LIMELIGHT,
                boxShadow: `0 0 8px ${LIMELIGHT}aa`,
              }}
            />
          )}
        </button>

        {/* Items */}
        {ITEMS.map((item, i) => {
          const offset = -(i + 1) * ITEM_GAP;
          const isActive = activePanel === item.key;
          return (
            <button
              key={item.key}
              type="button"
              aria-label={item.label}
              aria-pressed={isActive}
              onClick={() => pick(item.key)}
              tabIndex={expanded ? 0 : -1}
              className="absolute inset-0 rounded-full flex items-center justify-center shadow-lg shadow-black/30 active:scale-[0.94] group will-change-transform"
              style={{
                transform: expanded ? `translateY(${offset}px)` : "translateY(0px)",
                opacity: expanded ? 1 : 0,
                pointerEvents: expanded ? "auto" : "none",
                zIndex: 40 - i,
                background: "linear-gradient(135deg, rgba(28,22,48,0.94) 0%, rgba(10,8,18,0.96) 100%)",
                border: isActive
                  ? `1.5px solid ${LIMELIGHT}`
                  : `1px solid ${item.accent}55`,
                backdropFilter: "blur(14px)",
                boxShadow: isActive
                  ? `0 6px 22px rgba(0,0,0,0.55), 0 0 22px ${LIMELIGHT}55, inset 0 0 0 1px ${LIMELIGHT}30`
                  : "0 6px 22px rgba(0,0,0,0.4)",
                clipPath: i === ITEMS.length - 1 ? "circle(50% at 50% 50%)" : "circle(50% at 50% 55%)",
                transition: expanded
                  ? `transform 320ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 35}ms,
                     opacity 280ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 35}ms,
                     box-shadow 220ms ease-out, border-color 220ms ease-out`
                  : `transform 220ms cubic-bezier(0.4, 0, 0.2, 1),
                     opacity 200ms cubic-bezier(0.4, 0, 0.2, 1)`,
                backfaceVisibility: "hidden",
                WebkitFontSmoothing: "antialiased",
                color: isActive ? LIMELIGHT : item.accent,
              }}
            >
              <span
                className="transition-transform duration-200 group-hover:scale-110"
                style={{
                  filter: isActive
                    ? `drop-shadow(0 0 10px ${LIMELIGHT}cc)`
                    : `drop-shadow(0 0 8px ${item.accent}66)`,
                }}
              >
                {item.icon}
              </span>

              {/* Limelight side-pip on the LEFT of the active item — the
                  vertical-column equivalent of the 21st.dev "limelight" bar.
                  A glowing blue dot + a sideways spotlight gradient. */}
              {isActive && (
                <>
                  <span
                    aria-hidden="true"
                    className="absolute -left-1.5 top-1/2 -translate-y-1/2 w-1.5 h-6 rounded-full pointer-events-none"
                    style={{
                      background: LIMELIGHT,
                      boxShadow: `0 0 12px ${LIMELIGHT}, 0 0 24px ${LIMELIGHT}88`,
                    }}
                  />
                  <span
                    aria-hidden="true"
                    className="absolute -left-12 top-1/2 -translate-y-1/2 pointer-events-none"
                    style={{
                      width: 56,
                      height: 56,
                      background: `radial-gradient(circle at 100% 50%, ${LIMELIGHT}55 0%, transparent 70%)`,
                      filter: "blur(2px)",
                    }}
                  />
                </>
              )}
            </button>
          );
        })}

        {/* Side-tooltip labels when expanded — float to the LEFT so they don't
            drift past the viewport's right edge. */}
        {expanded && (
          <div
            className="absolute right-[72px] flex flex-col justify-end pointer-events-none"
            style={{
              top: -(ITEMS.length) * ITEM_GAP,
              height: ITEMS.length * ITEM_GAP,
              paddingBottom: ITEM_GAP / 2 - 14,
              gap: ITEM_GAP - 28,
            }}
          >
            {/* Buttons stack UPWARD from the trigger (ITEMS[0] closest to the
                bottom), but this column lays out top-to-bottom — reverse the
                array so each label sits beside its own button. */}
            {[...ITEMS].reverse().map((item) => {
              const isActive = activePanel === item.key;
              return (
                <span
                  key={item.key}
                  className="rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.22em] whitespace-nowrap backdrop-blur-md"
                  style={{
                    background: isActive ? `${LIMELIGHT}26` : "rgba(16,12,26,0.7)",
                    border: `1px solid ${isActive ? LIMELIGHT + "80" : item.accent + "40"}`,
                    color: isActive ? "#BFEFFF" : "rgba(238,244,255,0.85)",
                  }}
                >
                  {item.label}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
