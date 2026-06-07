/**
 * /learn/resume-coach OG card. Resume Coach grades a pasted resume and
 * proposes rewrites. Headline pitches the outcome (get the callback) not
 * the mechanic.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

export const runtime = "edge";
export const alt = "Lionade Resume Coach. Get the callback.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Get the callback.",
    subline: "Drop your resume. Ninny rewrites every bullet for impact and ATS.",
    eyebrow: "Resume Coach",
    accent: "#f5c542",
  });
}
