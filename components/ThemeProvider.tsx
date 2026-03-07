"use client";

import { useEffect } from "react";

function applyPrefs() {
  const el = document.documentElement;
  const theme = localStorage.getItem("theme") || "dark";
  el.dataset.theme = theme;
  el.dataset.fontSize = localStorage.getItem("fontSize") || "medium";
  el.classList.toggle("light", theme === "light");
}

/** Test if a color string is "dark" (used as a dark-mode background) */
function isDarkBg(bg: string): boolean {
  if (!bg) return false;
  // Match hex colors like #0a1020, #04080F etc.
  const hexMatch = bg.match(/#([0-9a-f]{6})/i);
  if (hexMatch) {
    const r = parseInt(hexMatch[1].slice(0, 2), 16);
    const g = parseInt(hexMatch[1].slice(2, 4), 16);
    const b = parseInt(hexMatch[1].slice(4, 6), 16);
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    if (lum < 35) return true;
  }
  // Match rgba with very low alpha backgrounds like rgba(4, 8, 15, 0.9)
  const rgbaMatch = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (rgbaMatch) {
    const r = parseInt(rgbaMatch[1]);
    const g = parseInt(rgbaMatch[2]);
    const b = parseInt(rgbaMatch[3]);
    const lum = (r * 299 + g * 587 + b * 114) / 1000;
    if (lum < 35) return true;
  }
  return false;
}

function fixDarkBackgrounds() {
  if (!document.documentElement.classList.contains("light")) return;

  const all = document.querySelectorAll<HTMLElement>("[style]");
  all.forEach((el) => {
    const bg = el.style.background || el.style.backgroundColor;
    if (bg && isDarkBg(bg)) {
      // Don't touch tiny decorative elements (dots, lines, accents)
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      if (w < 20 && h < 20) return;
      // Don't touch thin accent lines
      if (h <= 3 || w <= 3) return;

      el.style.background = "#ffffff";
      el.style.borderColor = "#fde68a";
      if (!el.style.border || el.style.border === "none") {
        el.style.border = "1px solid #fde68a";
      }
      el.style.boxShadow = "0 1px 3px rgba(0,0,0,0.08)";
    }
  });
}

export default function ThemeProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    applyPrefs();

    // Fix dark inline backgrounds after React renders
    const timer = setTimeout(fixDarkBackgrounds, 100);
    // Also observe DOM changes for client-rendered content
    const observer = new MutationObserver(() => {
      fixDarkBackgrounds();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });

    const handler = (e: StorageEvent) => {
      if (["theme", "fontSize"].includes(e.key ?? "")) {
        applyPrefs();
        setTimeout(fixDarkBackgrounds, 50);
      }
    };
    window.addEventListener("storage", handler);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      window.removeEventListener("storage", handler);
    };
  }, []);

  return <>{children}</>;
}
