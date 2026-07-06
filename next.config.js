/** @type {import('next').NextConfig} */

// Security headers are applied by middleware.ts on every request.
// Do NOT duplicate them here — duplicate CSP headers can cause
// browsers to block styles/scripts in dev mode.

// Runtime files pdf-parse v2 needs but that Vercel's static file tracer
// cannot discover (see experimental.outputFileTracingIncludes below).
// dist/pdf-parse/web is the 12 MB browser build and is deliberately
// NOT included.
const PDF_PARSE_TRACING_INCLUDES = [
  // CJS entry (what require("pdf-parse") resolves to) + its co-located
  // pdf.worker.mjs, which is loaded at parse time via a non-literal
  // dynamic import (`import(this.workerSrc)`) that tracing can't follow.
  "./node_modules/pdf-parse/dist/pdf-parse/cjs/**/*",
  // ESM entry + worker, in case the import condition is used instead.
  "./node_modules/pdf-parse/dist/pdf-parse/esm/**/*",
  "./node_modules/pdf-parse/dist/node/**/*",
  "./node_modules/pdf-parse/dist/worker/**/*",
  // The ESM build imports pdfjs-dist externally (the CJS build inlines it).
  "./node_modules/pdfjs-dist/legacy/build/pdf.mjs",
  "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  // Native canvas binding — pdf-parse's CJS bundle loads it through
  // createRequire() at require() time to polyfill DOMMatrix. Untraced =
  // "ReferenceError: DOMMatrix is not defined" before any parsing runs.
  // The platform wildcard picks up @napi-rs/canvas-linux-x64-gnu on
  // Vercel build machines (only the host-matching binding is installed).
  "./node_modules/@napi-rs/canvas/**/*",
  "./node_modules/@napi-rs/canvas-*/**/*",
];

const nextConfig = {
  // Compile @lionade/core from its TypeScript source on the fly.
  // No build step needed for the shared package — Next.js transpiles it
  // along with the rest of the app.
  transpilePackages: ["@lionade/core"],
  env: {
    NEXT_PUBLIC_CDN_URL: process.env.NEXT_PUBLIC_CDN_URL || "",
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "*.supabase.co" },
      // CDN host behind NEXT_PUBLIC_CDN_URL — cdnUrl() builds <Image> src
      // like https://d1745aj99cclbu.cloudfront.net/F.png. Without this,
      // next/image throws "hostname is not configured" and 500s the page
      // (the /admin overview's Fang icon is the first <Image> to hit it).
      { protocol: "https", hostname: "d1745aj99cclbu.cloudfront.net" },
    ],
  },
  // IA consolidation (2026-05-28): one Arena. The bare /arena V1 duel page
  // moved under the unified arena at /compete/arena/duel (the "Quiz Duel"
  // mode). Arena V2 (the dark ghost-replay system) and the legacy fake-bot
  // /duel page were both killed. These redirects keep old links + bookmarks
  // alive — query strings (e.g. /arena?challenge=user) are preserved by Next
  // automatically. Not permanent (307) while the IA settles.
  async redirects() {
    return [
      { source: "/arena", destination: "/compete/arena/duel", permanent: false },
      { source: "/arena/v2", destination: "/compete/arena", permanent: false },
      { source: "/duel", destination: "/compete/arena", permanent: false },
    ];
  },
  // pdf-parse pulls in pdfjs-dist, which calls Object.defineProperty on its
  // own module namespace at runtime. Webpack freezes ESM namespaces, so the
  // bundled version throws "Object.defineProperty called on non-object" on
  // first use. Marking it external tells Next.js to require() it at runtime
  // from node_modules instead of bundling, which restores a writable
  // namespace and lets the syllabus parser work.
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse"],
    // Because pdf-parse is external (above), Vercel's node-file-trace must
    // copy its runtime files into the serverless bundle — but two of its
    // loads happen through dynamic, non-literal specifiers that static
    // tracing cannot see. Result before this fix: BOTH PDF routes were
    // runtime-dead in prod, before the AI call ever ran:
    //   1. Missing @napi-rs/canvas → require("pdf-parse") itself throws
    //      "ReferenceError: DOMMatrix is not defined".
    //   2. Missing dist/pdf-parse/cjs/pdf.worker.mjs → parsing throws
    //      'Setting up fake worker failed: Cannot find module "…"'.
    // Keys are matched with picomatch (contains:true) against the
    // normalized route path. `[id]` would parse as a character class, so
    // the dynamic segment uses a `*` wildcard instead.
    outputFileTracingIncludes: {
      "/api/coach/resume/analyze": PDF_PARSE_TRACING_INCLUDES,
      "/api/classes/*/syllabus": PDF_PARSE_TRACING_INCLUDES,
    },
  },
  // @lionade/core is consumed as raw TypeScript source (see transpilePackages
  // above) and uses NodeNext-style ".js" import specifiers that actually
  // resolve to ".ts" files. TypeScript ("moduleResolution: bundler")
  // understands this, but Next/webpack does not rewrite ".js" -> ".ts" at
  // bundle time without an extensionAlias. Without this, every route 500s
  // with: Module not found: Can't resolve './http.js'.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      ...(config.resolve.extensionAlias || {}),
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
      ".cjs": [".cts", ".cjs"],
    };
    return config;
  },
};

module.exports = nextConfig;
