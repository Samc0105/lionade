/**
 * /pricing OG card. Headline + tier summary so the share preview tells
 * the recipient what the plans are without them clicking.
 */
import { OG_CONTENT_TYPE, OG_SIZE, renderOgCard } from "@/lib/og-card";

export const runtime = "edge";
export const alt = "Lionade pricing. Free, Pro $6.99, Platinum $14.99.";
export const size = OG_SIZE;
export const contentType = OG_CONTENT_TYPE;

export default async function Image() {
  return renderOgCard({
    headline: "Pick your grind tier.",
    subline:
      "Free forever. Pro at $6.99/mo. Platinum at $14.99/mo with zero ads and every feature unlocked.",
    eyebrow: "Pricing",
    // Gold accent reinforces "this is the money page".
    accent: "#f5c542",
  });
}
