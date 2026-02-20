/** @type {import('next').NextConfig} */

// Security headers are applied by middleware.ts on every request.
// Do NOT duplicate them here — duplicate CSP headers can cause
// browsers to block styles/scripts in dev mode.

const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "api.dicebear.com" },
      { protocol: "https", hostname: "*.supabase.co" },
    ],
  },
};

module.exports = nextConfig;
