/**
 * /learn/vocab OG card. The Word Bank surface. Frames vocab as
 * compounding leverage instead of rote drilling.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

export const runtime = "edge";
export const alt = "Lionade Word Banks. Stack vocab that compounds.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Stack vocab that compounds.",
    subline: "Word Banks. SAT, ACT, LSAT, GRE, plus any deck you import.",
    eyebrow: "Word Banks",
    accent: "#7c5cff",
  });
}
