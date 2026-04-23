/**
 * schema.org JSON-LD emitter for Lionade.
 *
 * Rendered once in the root layout. Gives Google (and other crawlers) a
 * strong, structured signal that "Lionade" is a distinct organization +
 * software product — this is the primary fix for Google's current habit
 * of auto-correcting "lionade" → "lemonade".
 *
 * All strings are static; no user input flows through this component.
 * Multiple schema types (Organization / WebSite / SoftwareApplication)
 * are emitted in one script tag so rich-result eligibility is broad.
 */

const SITE_URL = "https://getlionade.com";
const LOGO_URL = `${SITE_URL}/logo-icon.png`;

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
    email: "support@getlionade.com",
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

// React serializes a single string child on <script> as text content — no
// dangerouslySetInnerHTML needed. Crawlers read the resulting text as the
// JSON-LD payload identically.
export default function StructuredData() {
  return (
    <script type="application/ld+json">
      {JSON.stringify(SCHEMA)}
    </script>
  );
}
