import { absoluteUrl } from "@/lib/site-config";
import { getAllEntries } from "../entries";

/**
 * RSS 2.0 feed for /changelog. Stable URL: /changelog/feed.xml.
 * No deps, no fetches. Built from the same entries.ts the page reads.
 */

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function rfc822(iso: string): string {
  const d = new Date(iso + "T12:00:00Z");
  return d.toUTCString();
}

export async function GET() {
  const entries = getAllEntries();
  const siteUrl = absoluteUrl("/");
  const feedUrl = absoluteUrl("/changelog/feed.xml");
  const channelUrl = absoluteUrl("/changelog");
  const buildDate = entries[0] ? rfc822(entries[0].date) : new Date().toUTCString();

  const items = entries
    .map((entry) => {
      const link = absoluteUrl(`/changelog#${entry.id}`);
      const description = [
        entry.summary,
        ...entry.highlights.map((h) => `- ${h}`),
      ].join("\n");
      return `    <item>
      <title>${escapeXml(entry.title)}</title>
      <link>${escapeXml(link)}</link>
      <guid isPermaLink="false">${escapeXml(entry.id)}</guid>
      <pubDate>${rfc822(entry.date)}</pubDate>
      <category>${escapeXml(entry.category)}</category>
      <description>${escapeXml(description)}</description>
    </item>`;
    })
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Lionade Changelog</title>
    <link>${escapeXml(channelUrl)}</link>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
    <description>What we ship at Lionade, newest first.</description>
    <language>en-us</language>
    <lastBuildDate>${buildDate}</lastBuildDate>
    <generator>${escapeXml(siteUrl)}</generator>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/rss+xml; charset=utf-8",
      "Cache-Control": "public, max-age=600, s-maxage=3600",
    },
  });
}
