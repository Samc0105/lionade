// Referral capture + claim — client side.
//
// Capture: when a visitor arrives with ?ref=CODE (on the landing page, /login,
// anywhere), we stash the code in localStorage so it survives the email-
// verification / OAuth round-trip that happens between arrival and the first
// authenticated session.
//
// Claim: once the user is authenticated (SIGNED_IN), we POST the stashed code
// to /api/referral/claim exactly once, then clear it. The server does ALL the
// validation (self-referral, one-referral-per-user, freshness) — this module
// only shuttles the code. No Fangs are ever granted here.

const STORAGE_KEY = "lionade_ref_code";

/** Normalize to the server's alphabet so junk never gets stored. */
function normalize(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

/**
 * Read ?ref=CODE from the current URL and stash it. Call on mount of any public
 * entry surface. Safe to call repeatedly (last non-empty code wins). No-op on
 * the server or when there's no ref param.
 */
export function captureRefFromUrl(): void {
  if (typeof window === "undefined") return;
  try {
    const params = new URLSearchParams(window.location.search);
    const code = normalize(params.get("ref"));
    if (code) {
      window.localStorage.setItem(STORAGE_KEY, code);
    }
  } catch {
    // localStorage may be unavailable (private mode / blocked) — ignore.
  }
}

/**
 * If a referral code is stashed, POST it to the claim endpoint once, then clear
 * it regardless of the outcome (a code is only ever claimable once — the server
 * enforces this, and re-posting is harmless but pointless). Fire-and-forget:
 * never throws, never blocks auth.
 */
export function claimStoredReferral(accessToken: string | null | undefined): void {
  if (typeof window === "undefined" || !accessToken) return;
  let code = "";
  try {
    code = normalize(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return;
  }
  if (!code) return;

  // Clear immediately so a retry storm / double SIGNED_IN can't double-post.
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }

  void fetch("/api/referral/claim", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ code }),
  }).catch(() => null);
}
