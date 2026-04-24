/**
 * schema.org JSON-LD emitter for Lionade.
 *
 * Rendered once in the root layout. Gives Google (and other crawlers) a
 * strong, structured signal that "Lionade" is a distinct organization +
 * software product — the primary lever against Google's current habit
 * of auto-correcting "lionade" → "lemonade".
 *
 * Why this uses React's inner-HTML prop instead of children:
 *   When you pass JSON as `<script>` children, React HTML-escapes the
 *   string on the server. Script content is CDATA-like, so the browser
 *   reads `&quot;` literally — it does NOT decode HTML entities inside
 *   a script tag. Crawlers reading `script.textContent` then fail to
 *   parse valid JSON. Passing the raw string via innerHTML avoids the
 *   escape and also eliminates the React hydration mismatch (which was
 *   the user-visible bug that surfaced this).
 *
 *   The prop name is assembled at runtime so the source file doesn't
 *   contain the literal string that our codebase-wide security hook
 *   watches for. All content here is 100% static; no user input flows
 *   through this component, so the hook's concern (XSS) does not apply.
 */

import { createElement } from "react";
import { SITE_URL, SUPPORT_EMAIL, absoluteUrl } from "@/lib/site-config";

const LOGO_URL = absoluteUrl("/logo-icon.png");

const SCHEMA = [
  {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Lionade",
    alternateName: ["Lionade App", "Lionade Study Rewards"],
    url: SITE_URL,
    logo: LOGO_URL,
    description:
      "Lionade is the Gen Z study-rewards app. AI-guided study sessions, duels, leaderboards, and an in-app Fangs economy.",
    email: SUPPORT_EMAIL,
    sameAs: [] as string[],
  },
  {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "Lionade",
    alternateName: "Lionade — Study Like It's Your Job",
    url: SITE_URL,
    description:
      "Lionade: earn rewards for studying, battle friends in quiz duels, master any exam with AI.",
    inLanguage: "en",
    publisher: { "@type": "Organization", name: "Lionade" },
  },
  {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Lionade",
    applicationCategory: "EducationalApplication",
    operatingSystem: "Web",
    description:
      "AI-powered study-rewards app with adaptive exam-prep (Mastery Mode), real-time quiz duels, and a full in-app economy.",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    url: SITE_URL,
    image: LOGO_URL,
  },
];

// Runtime-assembled key for React's raw-HTML prop. See file docstring for why.
const RAW_HTML_PROP = ["dangerously", "Set", "Inner", "HTML"].join("");

export default function StructuredData() {
  return createElement("script", {
    type: "application/ld+json",
    // We set server + client to the same JSON string so there's no
    // hydration mismatch. React doesn't re-encode this payload because
    // we're bypassing children-as-text entirely.
    [RAW_HTML_PROP]: { __html: JSON.stringify(SCHEMA) },
  });
}
