import type { MetadataRoute } from "next";

// PWA manifest for getlionade.com. Picked up automatically by Next.js
// at /manifest.webmanifest. Powers the "Add to Home Screen" experience
// on iOS Safari and Android Chrome so pinned shortcuts get the real
// Lionade icon + name instead of a screenshot of the current page.
//
// Colors mirror --bg-page in globals.css (#04080F) so the splash and
// status-bar tint match the live dark theme exactly. Icons reference
// existing assets in /public so no new image generation is required.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Lionade",
    short_name: "Lionade",
    description:
      "Lionade (not lemonade). The study rewards app for Gen Z. Earn Fangs for studying, redeem for cash and prizes.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#04080F",
    theme_color: "#04080F",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    categories: ["education", "productivity"],
  };
}
