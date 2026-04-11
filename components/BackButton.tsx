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
  "/quiz": "/learn",
  "/quiz/ap-exams": "/quiz",

  // Sub-pages of /compete
  "/duel": "/compete",
  "/arena": "/compete",
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
  "/compete": "Compete",
  "/profile": "Profile",
  "/quiz": "Quiz",
};

/** Resolves the parent path for the current location, supporting dynamic routes. */
function getParentPath(currentPath: string): string | null {
  // Exact match
  if (currentPath in PARENT_PATHS) return PARENT_PATHS[currentPath];

  // Dynamic route patterns
  // /learn/paths/[subject] → /learn/paths
  if (/^\/learn\/paths\/[^/]+$/.test(currentPath)) return "/learn/paths";

  // No parent → top-level page, hide the back button
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
      onClick={() => router.push(parentPath)}
      className="inline-flex items-center gap-1.5 text-cream/40 hover:text-cream/80
        text-sm font-syne transition-colors mb-4 group"
    >
      <span className="text-base leading-none transition-transform group-hover:-translate-x-0.5">
        &larr;
      </span>
      <span>Back to {buttonLabel}</span>
    </button>
  );
}
