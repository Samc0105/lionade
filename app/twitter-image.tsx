/**
 * Twitter card for `/`. Identical to the OG card. Next's static analyzer
 * needs `runtime` declared as a literal in this file, so we wrap the OG
 * default-export rather than re-exporting the literals directly.
 */
import OgImage, {
  alt as ogAlt,
  size as ogSize,
  contentType as ogContentType,
} from "./opengraph-image";

export const runtime = "edge";
export const alt = ogAlt;
export const size = ogSize;
export const contentType = ogContentType;

export default OgImage;
