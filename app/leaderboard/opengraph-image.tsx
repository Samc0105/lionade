/**
 * /leaderboard OG card. Live ladder. Card frames the leaderboard as a
 * stakes signal so the share recipient knows ranks are public.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

export const runtime = "edge";
export const alt = "Lionade live leaderboard. Climb the ladder.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Climb the ladder.",
    subline: "Live ranks updated every claim. Public ladder, public bragging rights.",
    eyebrow: "Leaderboard",
    accent: "#f5c542",
  });
}
