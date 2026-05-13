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
    ],
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
};

module.exports = nextConfig;
