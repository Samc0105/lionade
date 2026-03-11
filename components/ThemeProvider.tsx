"use client";

import { useEffect } from "react";

/** Apply theme + font-size from localStorage to the DOM */
function applyTheme() {
  const el = document.documentElement;
  const theme = localStorage.getItem("theme") || "dark";
  el.dataset.theme = theme;
  el.dataset.fontSize = localStorage.getItem("fontSize") || "medium";
  el.classList.toggle("light", theme === "light");
}

/** Luminance test — returns true if ANY color in the string is very dark */
function isDarkColor(color: string): boolean {
  if (!color) return false;
  // Check all hex colors in the string (gradients have multiple)
  const hexMatches = Array.from(color.matchAll(/#([0-9a-f]{6})/gi));
  for (const hex of hexMatches) {
    const r = parseInt(hex[1].slice(0, 2), 16);
    const g = parseInt(hex[1].slice(2, 4), 16);
    const b = parseInt(hex[1].slice(4, 6), 16);
    if ((r * 299 + g * 587 + b * 114) / 1000 < 50) return true;
  }
  const rgb = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgb) {
    const r = parseInt(rgb[1]);
    const g = parseInt(rgb[2]);
    const b = parseInt(rgb[3]);
    return (r * 299 + g * 587 + b * 114) / 1000 < 50;
  }
  return false;
}

const FIXED = "data-theme-fixed";

/** In light mode, override inline dark backgrounds to white */
function fixInlineBackgrounds() {
  if (!document.documentElement.classList.contains("light")) return;
  document.querySelectorAll<HTMLElement>("[style]").forEach((el) => {
    if (el.hasAttribute(FIXED)) return; // already handled
    const bg = el.style.background || el.style.backgroundColor;
    if (!bg || !isDarkColor(bg)) return;
    // Skip tiny decorative elements
    if ((el.offsetWidth < 20 && el.offsetHeight < 20) || el.offsetHeight <= 3 || el.offsetWidth <= 3) return;
    // Save originals for restore
    el.setAttribute(FIXED, JSON.stringify({
      bg: el.style.background,
      bgc: el.style.backgroundColor,
      bc: el.style.borderColor,
      b: el.style.border,
      bs: el.style.boxShadow,
    }));
    el.style.background = "#ffffff";
    el.style.borderColor = "#fde68a";
    if (!el.style.border || el.style.border === "none") el.style.border = "1px solid #fde68a";
    el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
  });
}

/** Undo all inline fixes (switching back to dark) */
function undoInlineBackgrounds() {
  document.querySelectorAll<HTMLElement>(`[${FIXED}]`).forEach((el) => {
    try {
      const o = JSON.parse(el.getAttribute(FIXED) || "{}");
      el.style.background = o.bg || "";
      el.style.backgroundColor = o.bgc || "";
      el.style.borderColor = o.bc || "";
      el.style.border = o.b || "";
      el.style.boxShadow = o.bs || "";
    } catch { /* */ }
    el.removeAttribute(FIXED);
  });
}

/** Handle theme change — called from same-tab event or cross-tab storage */
function onThemeChange() {
  applyTheme();
  if (document.documentElement.classList.contains("light")) {
    fixInlineBackgrounds();
  } else {
    undoInlineBackgrounds();
  }
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyTheme();

    // Initial fix for inline dark backgrounds — stagger for async-rendered content
    const timer = setTimeout(fixInlineBackgrounds, 100);
    const timer2 = setTimeout(fixInlineBackgrounds, 600);
    const timer3 = setTimeout(fixInlineBackgrounds, 1500);

    // Watch for new DOM nodes (e.g. client-rendered content) — only childList, no style attrs
    let fixing = false;
    const observer = new MutationObserver(() => {
      if (fixing || !document.documentElement.classList.contains("light")) return;
      fixing = true;
      requestAnimationFrame(() => {
        fixInlineBackgrounds();
        fixing = false;
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });

    // Listen for same-tab theme changes (dispatched by profile page)
    const handleThemeChange = () => onThemeChange();
    window.addEventListener("themechange", handleThemeChange);

    // Listen for cross-tab theme changes
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "theme" || e.key === "fontSize") onThemeChange();
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      clearTimeout(timer3);
      observer.disconnect();
      window.removeEventListener("themechange", handleThemeChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  return <>{children}</>;
}
