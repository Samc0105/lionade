/* eslint-disable @next/next/no-img-element */
/**
 * Shared OG card builder for every `app/<route>/opengraph-image.tsx` (and
 * the matching `twitter-image.tsx`). Rendered by `next/og`'s `ImageResponse`
 * on the Vercel edge runtime — zero API cost, sub-second cold start.
 *
 * Why a shared module instead of one giant tsx per route:
 *   - `ImageResponse` JSX is *very* picky (flex-only, no className, every
 *     element needs explicit `display:'flex'` when it has multiple
 *     children). Centralizing the layout means one bug fix lands
 *     everywhere.
 *   - Per-route files become 8-line config objects — easy to scan, easy
 *     to add new routes.
 *
 * Brand alignment notes:
 *   - 1200x630 is the canonical size for iMessage / Twitter / Discord /
 *     Slack large cards. Anything else gets cropped or downscaled ugly.
 *   - Dark interstellar background matches the in-app SpaceBackground.
 *   - Gold (#f5c542) and electric violet (#7c5cff) are the brand accents.
 *   - Headline font is Inter 800 (bold). Bebas Neue is the in-app brand
 *     display font but loading custom WOFF in edge runtime is finicky and
 *     Bebas's all-caps already renders fine via `textTransform: uppercase`
 *     + Inter 800 letterspacing — visually 95% identical in a share card.
 *   - "getlionade.com" footer uses Inter 500 with `letterSpacing` to
 *     mimic the in-app DM Mono small-caps look without a second font
 *     request (every extra fetch slows the cold render).
 */

import { ImageResponse } from "next/og";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";
// NOTE: Each `opengraph-image.tsx` declares `export const runtime = "edge"`
// inline. Next.js's static analyzer scans for a string literal at file
// scope and won't recognize a re-exported constant, so we do NOT export
// OG_RUNTIME from this module — would silently fall back to nodejs and
// blow build size + cold-start latency.

export type OgCardOptions = {
  /** Big headline. Renders all-caps via CSS. Keep under ~28 chars. */
  headline: string;
  /** Supporting line under the headline. Keep under ~70 chars. */
  subline: string;
  /**
   * Optional accent color for the corner mark + headline underline.
   * Defaults to brand gold. Use violet for play/social, gold for
   * money/pricing/brand, green for mastery/win states.
   */
  accent?: string;
  /**
   * Optional eyebrow label above the headline (e.g. "PRICING",
   * "MASTERY MODE"). Renders in the accent color, small-caps.
   */
  eyebrow?: string;
};

/**
 * Load Inter from the Google Fonts static CDN. Vercel edges cache this
 * per-region after the first hit so we only pay the ~50ms fetch once per
 * cold region. Returns ArrayBuffers ready for `ImageResponse`'s `fonts`
 * option.
 *
 * We use the v12 hashed URLs (stable, won't rotate without a new font
 * release) rather than the dynamic `/css2` endpoint, because
 * `ImageResponse` needs the raw WOFF — not a CSS file.
 */
async function loadFonts() {
  // Inter 500 (regular weight for subline / footer) and Inter 800 (extra
  // bold for headline). These two are the smallest pair that still gives
  // us clean hierarchy.
  const [regular, bold] = await Promise.all([
    fetch(
      "https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa1ZL7.woff",
    ).then((r) => r.arrayBuffer()),
    fetch(
      "https://fonts.gstatic.com/s/inter/v12/UcC73FwrK3iLTeHuS_fvQtMwCp50KnMa2JL7SUc.woff",
    ).then((r) => r.arrayBuffer()),
  ]);
  return { regular, bold };
}

/**
 * Build the actual ImageResponse. Every route's `opengraph-image.tsx`
 * default-exports a function that just calls this with its options.
 */
export async function renderOgCard(opts: OgCardOptions): Promise<ImageResponse> {
  const accent = opts.accent ?? "#f5c542"; // brand gold
  const fonts = await loadFonts();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          // Deep navy base with a soft radial of the accent in the top-
          // right corner. The radial mimics the in-app gold glow without
          // needing a raster image fetch.
          background: `radial-gradient(circle at 85% 15%, ${accent}22 0%, transparent 55%), radial-gradient(circle at 15% 95%, #7c5cff22 0%, transparent 50%), linear-gradient(180deg, #07091a 0%, #0a0d24 60%, #06081a 100%)`,
          color: "#fefae0",
          fontFamily: "Inter",
        }}
      >
        {/* Top row: wordmark left, accent dot right */}
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 56,
                height: 56,
                borderRadius: 14,
                background: accent,
                color: "#07091a",
                fontSize: 38,
                fontWeight: 800,
                letterSpacing: "-0.04em",
              }}
            >
              L
            </div>
            <div
              style={{
                fontSize: 36,
                fontWeight: 800,
                letterSpacing: "0.02em",
                color: "#fefae0",
              }}
            >
              LIONADE
            </div>
          </div>
          {opts.eyebrow ? (
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                letterSpacing: "0.32em",
                color: accent,
                textTransform: "uppercase",
              }}
            >
              {opts.eyebrow}
            </div>
          ) : (
            // Empty flex item so space-between still pushes the wordmark
            // left when no eyebrow is set.
            <div style={{ display: "flex" }} />
          )}
        </div>

        {/* Middle: headline + subline */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 28,
            maxWidth: 1040,
          }}
        >
          <div
            style={{
              fontSize: 110,
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              color: "#fefae0",
            }}
          >
            {opts.headline}
          </div>
          {/* Accent underline. 8px tall pill matches the in-app gold
              underlines on hero headlines. */}
          <div
            style={{
              display: "flex",
              width: 160,
              height: 8,
              background: accent,
              borderRadius: 4,
            }}
          />
          <div
            style={{
              fontSize: 34,
              fontWeight: 500,
              lineHeight: 1.3,
              color: "#cbd0e8",
              maxWidth: 980,
            }}
          >
            {opts.subline}
          </div>
        </div>

        {/* Footer: domain (left) and tagline (right) */}
        <div
          style={{
            display: "flex",
            width: "100%",
            justifyContent: "space-between",
            alignItems: "center",
            borderTop: "1px solid #1d2244",
            paddingTop: 28,
            fontSize: 22,
            color: "#7d83a3",
          }}
        >
          <div
            style={{
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            getlionade.com
          </div>
          <div
            style={{
              fontWeight: 500,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: accent,
            }}
          >
            Study Like It's Your Job
          </div>
        </div>
      </div>
    ),
    {
      ...OG_SIZE,
      fonts: [
        { name: "Inter", data: fonts.regular, weight: 500, style: "normal" },
        { name: "Inter", data: fonts.bold, weight: 800, style: "normal" },
      ],
    },
  );
}
