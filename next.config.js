/** @type {import('next').NextConfig} */

// Security headers are applied by middleware.ts on every request.
// Do NOT duplicate them here — duplicate CSP headers can cause
// browsers to block styles/scripts in dev mode.

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
