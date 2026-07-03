"use client";

import { useRouter, usePathname } from "next/navigation";

// ─── Logical parent map ──────────────────────────────────────────────────
// Maps each sub-page to its logical parent. Top-level pages (Dashboard,
// Learn, Compete, Social, Games, Shop, Home) have no entry — those are
// destinations, not children, so no back button is shown.
//
// This is route-based navigation, NOT browser history (`router.back()`),
// so it works correctly even on direct URL loads, page refreshes, and
// when the user opens a link in a new tab.
// ─────────────────────────────────────────────────────────────────────────

const PARENT_PATHS: Record<string, string> = {
  // Sub-pages of /learn
  "/learn/ninny": "/learn",
  "/learn/paths": "/learn",
  "/learn/techhub": "/learn",
  "/learn/sim": "/learn",
  "/learn/vocab": "/learn",
  "/learn/review": "/learn",
  "/learn/resume-coach": "/learn",
  "/learn/mastery": "/learn",
  "/academia": "/learn",
  "/focus/rooms": "/learn",
  "/study-dna": "/dashboard",
  "/classes": "/dashboard",
  "/quiz": "/learn",
  "/quiz/ap-exams": "/quiz",

  // Account / settings / info pages
  "/help": "/dashboard",
  "/security": "/settings",
  "/account": "/settings",
  "/pricing": "/",
  "/status": "/",

  // Sub-pages of /compete
  "/compete/blitz": "/compete",
  "/compete/arena": "/compete",
  "/compete/arena/duel": "/compete/arena",
  "/games/party": "/games",
  "/leaderboard": "/compete",

  // Sub-pages reached via avatar dropdown
  "/profile": "/dashboard",
  "/settings": "/dashboard",
  "/wallet": "/dashboard",
  "/badges": "/profile",

  // Static / footer pages
  "/about": "/",
  "/contact": "/",
  "/terms": "/",
  "/privacy": "/",
  "/demo": "/",
};

/** Map a friendly label for each parent path (used in the back button text) */
const PARENT_LABELS: Record<string, string> = {
  "/": "Home",
  "/dashboard": "Dashboard",
  "/learn": "Learn",
  "/learn/paths": "Paths",
  "/learn/techhub": "TechHub",
  "/learn/mastery": "Mastery Mode",
  "/compete": "Compete",
  "/compete/arena": "Arena",
  "/games": "Games",
  "/games/party": "Party",
  "/focus/rooms": "Focus Rooms",
  "/profile": "Profile",
  "/quiz": "Quiz",
  "/settings": "Settings",
  "/classes": "Classes",
  "/blog": "Blog",
};

// Genuine top-level destinations — a single-segment route here has no parent, so
// the fail-safe fallback below must NOT invent one (prevents a stray back button
// on a hub page that happens to render <BackButton>).
const TOP_LEVEL = new Set(["dashboard", "learn", "compete", "games", "social", "shop"]);

/** Resolves the parent path for the current location, supporting dynamic routes. */
function getParentPath(currentPath: string): string | null {
  // Exact match
  if (currentPath in PARENT_PATHS) return PARENT_PATHS[currentPath];

  // Dynamic route patterns
  // /learn/paths/[subject] → /learn/paths
  if (/^\/learn\/paths\/[^/]+$/.test(currentPath)) return "/learn/paths";

  // /games/party/[code] → /games/party
  if (/^\/games\/party\/[^/]+$/.test(currentPath)) return "/games/party";

  // /focus/rooms/[code] → /focus/rooms
  if (/^\/focus\/rooms\/[^/]+$/.test(currentPath)) return "/focus/rooms";

  // /compete/arena/[mode]/[matchId] → /compete/arena
  if (/^\/compete\/arena\/[^/]+\/[^/]+$/.test(currentPath)) return "/compete/arena";

  // Every TechHub sub-page (tracks, tutorial, shift, surprise, lab, kb, oneonone,
  // achievements, nightshift, etc.) returns to the TechHub hub. The hub itself
  // maps to /learn via the exact match in PARENT_PATHS above.
  if (/^\/learn\/techhub\/.+/.test(currentPath)) return "/learn/techhub";

  // /learn/mastery/[examId] → /learn/mastery ; /classes/[id] → /classes
  if (/^\/learn\/mastery\/[^/]+$/.test(currentPath)) return "/learn/mastery";
  if (/^\/classes\/[^/]+$/.test(currentPath)) return "/classes";

  // Fail-safe fallback: derive a parent by stripping the last path segment, so a
  // route absent from every map above can NEVER yield an invisible back button
  // (the class of bug where <BackButton/> renders nothing). Route-derived, so it
  // still works on direct load / refresh (no router.back dependency).
  const segs = currentPath.split("/").filter(Boolean);
  if (segs.length >= 2) return "/" + segs.slice(0, -1).join("/");
  if (segs.length === 1 && !TOP_LEVEL.has(segs[0])) return "/dashboard";

  // Only the true root '/' (and top-level hubs) have no parent.
  return null;
}

interface Props {
  /** Override the auto-resolved parent path */
  href?: string;
  /** Override the auto-resolved label */
  label?: string;
}

export default function BackButton({ href, label }: Props) {
  const router = useRouter();
  const pathname = usePathname();

  const parentPath = href ?? getParentPath(pathname ?? "");

  // Top-level page — render nothing
  if (!parentPath) return null;

  const buttonLabel = label ?? PARENT_LABELS[parentPath] ?? "Back";

  return (
    <button
      type="button"
      onClick={() => router.push(parentPath)}
      className="inline-flex items-center gap-1.5 text-cream/60 hover:text-cream
        text-sm font-syne transition-colors mb-4 group rounded
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cream/70
        focus-visible:ring-offset-2 focus-visible:ring-offset-navy"
    >
      <span
        aria-hidden="true"
        className="text-base leading-none transition-transform motion-safe:group-hover:-translate-x-0.5"
      >
        &larr;
      </span>
      <span>Back to {buttonLabel}</span>
    </button>
  );
}
