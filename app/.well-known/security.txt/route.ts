import { SITE_HOST, SECURITY_EMAIL, SUPPORT_EMAIL, absoluteUrl } from "@/lib/site-config";

// RFC 9116 security.txt, served at /.well-known/security.txt. A machine- and
// human-readable pointer to how to report a vulnerability in Lionade. The
// Expires field is required by the RFC; we roll it ~10 months out and let the
// route revalidate daily so the file never reads as stale even if untouched.
export const revalidate = 86_400;

export function GET(): Response {
  const expires = new Date();
  expires.setMonth(expires.getMonth() + 10);

  const lines = [
    `# Security policy for ${SITE_HOST}.`,
    `# Full vulnerability disclosure policy: ${absoluteUrl("/security")}`,
    "",
    `Contact: mailto:${SECURITY_EMAIL}`,
    `Contact: mailto:${SUPPORT_EMAIL}`,
    `Expires: ${expires.toISOString()}`,
    `Preferred-Languages: en`,
    `Canonical: ${absoluteUrl("/.well-known/security.txt")}`,
    `Policy: ${absoluteUrl("/security")}`,
    "",
  ];

  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
