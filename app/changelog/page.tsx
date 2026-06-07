import Link from "next/link";
import { absoluteUrl } from "@/lib/site-config";
import { getAllEntries, type ChangelogCategory } from "./entries";

/**
 * Public changelog index. Pure server component, SSG. Renders entries as a
 * vertical timeline: a sticky-feel left rail with month + day in Bebas, and
 * an entry card stack on the right. JSON-LD ItemList included for SEO.
 */

const CATEGORY_LABEL: Record<ChangelogCategory, string> = {
  feature: "NEW",
  polish: "POLISH",
  fix: "FIX",
  infra: "INFRA",
};

const CATEGORY_STYLE: Record<
  ChangelogCategory,
  { chipBg: string; chipBorder: string; chipText: string; railDot: string }
> = {
  feature: {
    chipBg: "rgba(240,180,41,0.12)",
    chipBorder: "rgba(240,180,41,0.45)",
    chipText: "#F0B429",
    railDot: "#F0B429",
  },
  polish: {
    chipBg: "rgba(155,89,182,0.14)",
    chipBorder: "rgba(155,89,182,0.45)",
    chipText: "#C29CE5",
    railDot: "#9B59B6",
  },
  fix: {
    chipBg: "rgba(0,191,255,0.12)",
    chipBorder: "rgba(0,191,255,0.45)",
    chipText: "#6AABF0",
    railDot: "#00BFFF",
  },
  infra: {
    chipBg: "rgba(255,255,255,0.05)",
    chipBorder: "rgba(255,255,255,0.18)",
    chipText: "rgba(245,235,215,0.6)",
    railDot: "rgba(245,235,215,0.45)",
  },
};

function formatDayRail(iso: string): { month: string; day: string } {
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" }).toUpperCase();
  const day = d.toLocaleDateString("en-US", { day: "2-digit", timeZone: "UTC" });
  return { month, day };
}

function formatLongDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function ChangelogPage() {
  const entries = getAllEntries();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Lionade Changelog",
    description:
      "Hand-written log of what Lionade has shipped, newest first.",
    itemListOrder: "https://schema.org/ItemListOrderDescending",
    numberOfItems: entries.length,
    itemListElement: entries.map((entry, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: absoluteUrl(`/changelog#${entry.id}`),
      name: entry.title,
      description: entry.summary,
      datePublished: entry.date,
    })),
  };

  return (
    <div className="min-h-screen pt-20 pb-20">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <header className="text-center mb-14 animate-slide-up">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-cream/40 mb-3">
            WHAT WE SHIPPED
          </p>
          <h1 className="font-bebas text-6xl sm:text-7xl tracking-wider leading-none">
            <span className="bg-gradient-to-r from-gold via-[#E5A923] to-electric bg-clip-text text-transparent">
              CHANGELOG
            </span>
          </h1>
          <p className="text-cream/55 text-sm sm:text-base mt-5 max-w-xl mx-auto leading-relaxed">
            We ship daily. Here is what changed.
          </p>

          <div className="mt-6 flex items-center justify-center gap-3 text-[10px] sm:text-[11px] font-mono tracking-[0.25em] uppercase">
            <a
              href="/changelog/feed.xml"
              className="text-cream/45 hover:text-cream transition-colors duration-150"
            >
              SUBSCRIBE VIA RSS
            </a>
            <span className="text-cream/20" aria-hidden>
              ·
            </span>
            <Link
              href="/blog"
              className="text-cream/45 hover:text-cream transition-colors duration-150"
            >
              READ THE BLOG
            </Link>
          </div>
        </header>

        {/* Timeline */}
        <ol className="relative space-y-8 sm:space-y-10">
          {entries.map((entry, i) => {
            const style = CATEGORY_STYLE[entry.category];
            const rail = formatDayRail(entry.date);

            return (
              <li
                key={entry.id}
                id={entry.id}
                className="grid grid-cols-[64px_1fr] sm:grid-cols-[96px_1fr] gap-4 sm:gap-8 scroll-mt-24 animate-slide-up"
                style={{ animationDelay: `${0.06 + i * 0.06}s` }}
              >
                {/* Left rail: date marker */}
                <div className="relative flex flex-col items-center sm:items-end pt-2">
                  <div className="font-bebas text-cream/85 leading-none tracking-wider text-right">
                    <div className="text-2xl sm:text-3xl">{rail.day}</div>
                    <div className="text-[10px] sm:text-xs font-mono tracking-[0.3em] uppercase text-cream/45 mt-1">
                      {rail.month}
                    </div>
                  </div>
                  <span
                    aria-hidden
                    className="hidden sm:block mt-3 h-2.5 w-2.5 rounded-full"
                    style={{
                      background: style.railDot,
                      boxShadow: `0 0 14px ${style.railDot}66`,
                    }}
                  />
                </div>

                {/* Entry card */}
                <article
                  className="rounded-2xl border border-electric/20 p-5 sm:p-7 transition-all duration-300 hover:border-electric/40 hover:-translate-y-0.5"
                  style={{
                    background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
                  }}
                >
                  <div className="flex flex-wrap items-center gap-2.5 mb-3">
                    <span
                      className="inline-flex items-center px-2.5 py-0.5 rounded-full border text-[10px] font-mono tracking-[0.2em] uppercase"
                      style={{
                        background: style.chipBg,
                        borderColor: style.chipBorder,
                        color: style.chipText,
                      }}
                    >
                      {CATEGORY_LABEL[entry.category]}
                    </span>
                    <time
                      dateTime={entry.date}
                      className="font-mono text-[10px] tracking-[0.22em] uppercase text-cream/40"
                    >
                      {formatLongDate(entry.date)}
                    </time>
                  </div>

                  <h2 className="font-bebas text-2xl sm:text-3xl tracking-wider leading-tight mb-3 text-cream">
                    {entry.title}
                  </h2>

                  <p className="text-cream/65 text-sm sm:text-base leading-relaxed">
                    {entry.summary}
                  </p>

                  {entry.highlights.length > 0 && (
                    <ul className="mt-5 space-y-2">
                      {entry.highlights.map((h, hi) => (
                        <li
                          key={hi}
                          className="flex gap-3 text-cream/70 text-sm leading-relaxed"
                        >
                          <span
                            aria-hidden
                            className="mt-2 h-1 w-1 rounded-full shrink-0"
                            style={{ background: style.chipText }}
                          />
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              </li>
            );
          })}
        </ol>

        {/* Footer CTA */}
        <div
          className="mt-16 sm:mt-20 rounded-2xl border border-gold/25 p-8 sm:p-10 text-center animate-slide-up"
          style={{
            background:
              "linear-gradient(135deg, rgba(240,180,41,0.06) 0%, rgba(10,16,32,0.6) 100%)",
            animationDelay: "0.8s",
          }}
        >
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-gold/70 mb-3">
            FRESH OFF THE PRESS
          </p>
          <h2 className="font-bebas text-3xl sm:text-4xl tracking-wider text-cream mb-5">
            TRY WHAT&apos;S NEW
          </h2>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-mono text-xs tracking-[0.25em] uppercase text-navy bg-gradient-to-r from-gold to-[#E5A923] hover:brightness-110 transition-all duration-200 shadow-lg shadow-gold/20"
          >
            Open the dashboard
            <span aria-hidden>→</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
