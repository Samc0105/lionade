"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CATEGORIES, FAQS, type Faq, type FaqCategory } from "./faqs";

type Filter = "All" | FaqCategory;

const ALL_FILTERS: Filter[] = ["All", ...CATEGORIES];

function FaqItem({ faq, defaultOpen }: { faq: Faq; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div
      className="rounded-2xl border border-electric/20 overflow-hidden relative"
      style={{
        background:
          "linear-gradient(135deg, rgba(10,16,32,0.85) 0%, rgba(6,12,24,0.85) 100%)",
      }}
    >
      <div
        aria-hidden
        className="absolute top-0 left-0 h-full w-[3px]"
        style={{
          background:
            "linear-gradient(180deg, rgba(240,180,41,0.5) 0%, rgba(76,150,225,0.5) 100%)",
        }}
      />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`faq-panel-${faq.id}`}
        id={`faq-trigger-${faq.id}`}
        className="w-full flex items-start gap-4 text-left px-6 py-5 sm:px-8 sm:py-6 group focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 rounded-2xl"
      >
        <div className="flex-1">
          <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/70 mb-2">
            {faq.category}
          </p>
          <h2 className="font-bebas text-2xl sm:text-3xl tracking-wider text-cream group-hover:text-gold transition-colors duration-150">
            {faq.question}
          </h2>
        </div>
        <span
          aria-hidden
          className="mt-1 flex-shrink-0 w-9 h-9 rounded-full border border-cream/15 flex items-center justify-center text-cream/70 group-hover:text-gold group-hover:border-gold/40 transition-all duration-150 will-change-transform"
          style={{
            transform: open ? "rotate(45deg)" : "rotate(0deg)",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M7 1V13M1 7H13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </span>
      </button>

      <div
        id={`faq-panel-${faq.id}`}
        role="region"
        aria-labelledby={`faq-trigger-${faq.id}`}
        aria-hidden={!open}
        className="grid help-panel transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none"
        style={{
          gridTemplateRows: open ? "1fr" : "0fr",
          opacity: open ? 1 : 0,
        }}
      >
        <div className="overflow-hidden">
          <p className="px-6 pb-6 sm:px-8 sm:pb-8 text-cream/75 text-base leading-relaxed max-w-3xl">{faq.answer}</p>
        </div>
      </div>
    </div>
  );
}

export default function HelpClient() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    return FAQS.filter((faq) => {
      const matchesCategory = filter === "All" || faq.category === filter;
      if (!matchesCategory) return false;
      if (!normalizedQuery) return true;
      const haystack = `${faq.question} ${faq.answer} ${faq.category}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [filter, normalizedQuery]);

  const countByCategory = useMemo(() => {
    const map = new Map<Filter, number>();
    map.set("All", FAQS.length);
    for (const cat of CATEGORIES) {
      map.set(cat, FAQS.filter((f) => f.category === cat).length);
    }
    return map;
  }, []);

  return (
    <>
      {/* Search */}
      <section
        className="mb-8 animate-slide-up"
        style={{ animationDelay: "0.05s" }}
      >
        <div
          className="relative rounded-2xl border border-electric/25 overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, rgba(10,16,32,0.85) 0%, rgba(6,12,24,0.85) 100%)",
            boxShadow: "0 8px 32px rgba(76,150,225,0.08)",
          }}
        >
          <div className="flex items-center gap-3 px-5 py-4 sm:px-6 sm:py-5">
            <svg
              aria-hidden
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              className="text-gold/70 flex-shrink-0"
            >
              <circle cx="9" cy="9" r="6.5" stroke="currentColor" strokeWidth="1.6" />
              <path d="M14 14L18 18" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the help center"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-label="Search the help center"
              className="flex-1 bg-transparent outline-none text-cream placeholder:text-cream/55 text-base"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="text-cream/55 hover:text-cream text-xs font-mono uppercase tracking-[0.22em] transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
      </section>

      {/* Category chips */}
      <section
        className="mb-10 animate-slide-up"
        style={{ animationDelay: "0.1s" }}
      >
        <div className="flex flex-wrap gap-2">
          {ALL_FILTERS.map((cat) => {
            const active = filter === cat;
            const count = countByCategory.get(cat) ?? 0;
            return (
              <button
                key={cat}
                type="button"
                onClick={() => setFilter(cat)}
                aria-pressed={active}
                className="px-4 py-2 rounded-full font-mono text-[10px] uppercase tracking-[0.22em] transition-all duration-150 will-change-transform active:scale-[0.97]"
                style={
                  active
                    ? {
                        background:
                          "linear-gradient(135deg, rgba(240,180,41,0.95) 0%, rgba(184,150,12,0.95) 100%)",
                        color: "#04080F",
                        boxShadow: "0 4px 14px rgba(240,180,41,0.3)",
                      }
                    : {
                        background: "rgba(10,16,32,0.6)",
                        color: "rgba(247,243,235,0.65)",
                        border: "1px solid rgba(76,150,225,0.2)",
                      }
                }
              >
                {cat} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* FAQ list */}
      <section className="space-y-3 mb-20">
        {filtered.length === 0 ? (
          <div
            className="rounded-2xl border border-cream/10 p-10 text-center"
            style={{
              background:
                "linear-gradient(135deg, rgba(10,16,32,0.6) 0%, rgba(6,12,24,0.6) 100%)",
            }}
          >
            <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-gold/70 mb-3">
              Nothing here
            </p>
            <h2 className="font-bebas text-3xl tracking-wider text-cream mb-3">
              NO MATCHES FOUND
            </h2>
            <p className="text-cream/60 text-sm max-w-md mx-auto">
              Try a different keyword, switch to All, or ask us directly.
            </p>
            <Link href="/contact" prefetch={false} className="inline-block mt-5">
              <span className="font-mono text-[11px] uppercase tracking-[0.28em] text-gold hover:text-cream transition-colors">
                Contact support &rarr;
              </span>
            </Link>
          </div>
        ) : (
          filtered.map((faq, i) => (
            <div
              key={faq.id}
              className="animate-slide-up"
              style={{ animationDelay: `${0.1 + Math.min(i, 8) * 0.03}s` }}
            >
              <FaqItem faq={faq} defaultOpen={false} />
            </div>
          ))
        )}
      </section>
    </>
  );
}
