/**
 * /games/party OG card. Party is the multiplayer hub (Sketchy Subjects +
 * Bluff Trivia). The headline leans on the social hook because that's
 * what gets shared in iMessage group threads.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

export const runtime = "edge";
export const alt = "Lionade Party. Play with friends. Earn Fangs together.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Play with friends.",
    subline: "Sketchy Subjects and Bluff Trivia. Earn Fangs together.",
    eyebrow: "Lionade Party",
    accent: "#7c5cff",
  });
}
