/**
 * /learn/mastery OG card. Mastery Mode is the chat-first Ninny-led
 * exam-prep flow. Card sells the outcome ("master what counts") not the
 * mechanic.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

export const runtime = "edge";
export const alt = "Lionade Mastery Mode. Master what counts.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Master what counts.",
    subline:
      "Chat-first Ninny teaches and quizzes you on the exact topics you pick. Slow-fill to 100%.",
    eyebrow: "Mastery Mode",
    // Electric violet accent for the AI/tutor surface.
    accent: "#7c5cff",
  });
}
