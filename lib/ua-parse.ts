/**
 * Dependency-free user-agent classifier for the Data & Usage > Session
 * history list. Deliberately coarse: we only surface a device class and a
 * browser family to the user, not a full UA-string breakdown.
 *
 * Server-only by convention (called from the sessions route), but it's a
 * pure string function with no imports, so it's safe anywhere.
 *
 * Order matters: Edge and Chrome both contain "Chrome"; iOS Chrome ("CriOS")
 * and Firefox ("FxiOS") both run on WebKit and contain "Safari". We check the
 * more specific token first in every ambiguous case.
 */

export type UaDevice = "Mobile" | "Tablet" | "Desktop";
export type UaBrowser = "Chrome" | "Safari" | "Firefox" | "Edge" | "Other";

export function parseDevice(ua: string | null | undefined): UaDevice {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "Desktop";
  // Tablets first — iPads and Android tablets often also match "mobile" tokens.
  if (s.includes("ipad")) return "Tablet";
  if (s.includes("tablet")) return "Tablet";
  // Android without "mobile" is conventionally a tablet.
  if (s.includes("android") && !s.includes("mobile")) return "Tablet";
  if (s.includes("mobile") || s.includes("iphone") || s.includes("ipod")) {
    return "Mobile";
  }
  return "Desktop";
}

export function parseBrowser(ua: string | null | undefined): UaBrowser {
  const s = ua ?? "";
  // Edge identifies as "Edg/" (and legacy "Edge/" / "EdgA/" / "EdgiOS/").
  if (/\bedg(a|ios|e)?\//i.test(s)) return "Edge";
  // Firefox, incl. iOS Firefox (FxiOS).
  if (/firefox\//i.test(s) || /fxios\//i.test(s)) return "Firefox";
  // Chrome, incl. iOS Chrome (CriOS). Must come before Safari since Chrome
  // UAs also contain "Safari".
  if (/chrome\//i.test(s) || /crios\//i.test(s)) return "Chrome";
  // Safari is the WebKit fallback: has "Safari" but none of the above.
  if (/safari\//i.test(s)) return "Safari";
  return "Other";
}

/** Convenience: parse both halves at once. */
export function parseUserAgent(ua: string | null | undefined): {
  device: UaDevice;
  browser: UaBrowser;
} {
  return { device: parseDevice(ua), browser: parseBrowser(ua) };
}
