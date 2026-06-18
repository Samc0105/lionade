import Link from "next/link";
import BackButton from "@/components/BackButton";
import { cdnUrl } from "@/lib/cdn";
import HelpClient from "./HelpClient";
import { FAQS } from "./faqs";

export default function HelpPage() {
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQS.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <div className="min-h-screen pt-20 pb-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <BackButton />

        {/* Hero */}
        <section className="text-center mt-4 mb-14 animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/75 mb-5">
            Quick answers
          </p>
          <img
            src={cdnUrl("/logo-icon.png")}
            alt="Lionade"
            className="h-20 w-20 rounded-2xl demo-logo-glow mx-auto mb-6"
          />
          <h1 className="font-bebas text-6xl sm:text-7xl md:text-8xl tracking-wider leading-[0.92]">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              HELP CENTER
            </span>
          </h1>
          <p className="mt-7 max-w-2xl mx-auto text-cream/65 text-base sm:text-lg leading-relaxed">
            The answers to the questions we get most often. Search by keyword, filter by topic, or scroll the whole list. If you do not find what you need, the contact form is one tap away.
          </p>

          <div className="mt-9 inline-flex items-center gap-6 text-xs font-mono uppercase tracking-[0.22em] text-cream/55">
            <span>
              <span className="text-gold">{FAQS.length}</span> answers
            </span>
            <span className="h-3 w-px bg-cream/15" />
            <span>Updated weekly</span>
            <span className="h-3 w-px bg-cream/15" />
            <span>Real humans behind it</span>
          </div>
        </section>

        <HelpClient />

        {/* Still need help CTA */}
        <section
          className="text-center rounded-2xl border border-gold/25 p-10 sm:p-12 animate-slide-up"
          style={{
            animationDelay: "0.2s",
            background:
              "linear-gradient(135deg, rgba(20,16,8,0.7) 0%, rgba(8,6,4,0.7) 100%)",
          }}
        >
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/75 mb-4">
            Still need help?
          </p>
          <h2 className="font-bebas text-4xl sm:text-5xl tracking-wider mb-5 text-cream">
            TALK TO A HUMAN
          </h2>
          <p className="text-cream/65 text-base max-w-xl mx-auto leading-relaxed mb-8">
            We answer every message. Bugs, billing, partnerships, feature ideas, or feedback on the site, send it our way.
          </p>
          <Link
            href="/contact"
            prefetch={false}
            className="inline-block px-9 py-4 rounded-full font-bold text-base transition-transform duration-150 active:scale-[0.98] hover:scale-[1.02] will-change-transform"
            style={{
              background:
                "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: "#04080F",
              boxShadow:
                "0 8px 28px rgba(240,180,41,0.35), inset 0 1px 0 rgba(255,255,255,0.3)",
            }}
          >
            CONTACT SUPPORT
          </Link>
          <p className="mt-6 text-cream/55 text-xs font-mono uppercase tracking-[0.22em]">
            support@getlionade.com
          </p>
        </section>
      </div>
    </div>
  );
}
