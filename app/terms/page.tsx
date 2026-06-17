import Link from "next/link";
import BackButton from "@/components/BackButton";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const revalidate = 86_400;

const LAST_UPDATED = "February 2026";

const SECTIONS = [
  {
    id: "overview",
    number: "01",
    title: "The Short Version",
    body: (
      <>
        <p>
          Lionade is a study-rewards platform. You earn Fangs for focused study time, you can spend them in-app, and once you cross the payout threshold you can convert them to cash. In exchange we ask you to play fair, follow the rules below, and not break the systems that keep the economy honest.
        </p>
        <p>
          This page is a working draft. The final, lawyer-reviewed Terms of Service are being prepared ahead of broader public launch. Until then, the rules described here are what we actually enforce.
        </p>
      </>
    ),
  },
  {
    id: "eligibility",
    number: "02",
    title: "Who Can Use Lionade",
    body: (
      <>
        <p>
          You must be at least 13 years old to create an account, and at least 18 (or the age of majority in your jurisdiction) to receive cash payouts. School-deployed accounts may have different age handling under verifiable parental consent.
        </p>
        <p>
          One account per person. Creating multiple accounts to farm Fangs, multiply payouts, or manipulate leaderboards is grounds for forfeiture and termination.
        </p>
      </>
    ),
  },
  {
    id: "fangs",
    number: "03",
    title: "Fangs, Payouts, and Economy",
    body: (
      <>
        <p>
          Fangs are an in-app reward unit. They have no monetary value until and unless converted to cash through our payout flow, which is subject to a minimum balance, identity checks, and processor availability (Stripe in most regions).
        </p>
        <p>
          We reserve the right to adjust earn rates, redemption costs, payout thresholds, and processing fees as the economy demands. Material changes will be announced in-app and in your account email before they take effect.
        </p>
        <p>
          Fangs are non-transferable between accounts, do not earn interest, and may be voided if obtained through abuse, exploitation of bugs, or violation of these terms.
        </p>
      </>
    ),
  },
  {
    id: "subscriptions",
    number: "04",
    title: "Subscriptions",
    body: (
      <>
        <p>
          Lionade Pro is an optional paid subscription that unlocks higher Fang earn rates, premium themes, and a few power features. It renews monthly or annually until you cancel from Settings. Cancellation takes effect at the end of the current billing period; we do not pro-rate refunds for unused time except where law requires.
        </p>
        <p>
          Trials, promo codes, and student discounts are honored at the terms stated when you redeem them.
        </p>
      </>
    ),
  },
  {
    id: "conduct",
    number: "05",
    title: "Fair Play",
    body: (
      <>
        <p>
          You agree not to: use automation, bots, or emulators to fake focus sessions; collude to manipulate Compete or leaderboards; harass other users in chat, usernames, or shared content; or reverse-engineer the app to extract Fangs or bypass payout checks.
        </p>
        <p>
          We monitor for these patterns. First offenses usually trigger a warning and Fang clawback; repeated or severe abuse results in account termination without refund.
        </p>
      </>
    ),
  },
  {
    id: "content",
    number: "06",
    title: "Your Content",
    body: (
      <>
        <p>
          You keep ownership of anything you write or upload (notes, custom Mastery topics, profile content). You grant Lionade a limited, worldwide, royalty-free license to host, display, and process that content solely to operate and improve the service.
        </p>
        <p>
          Do not upload content you do not have the right to share, content that targets or harms minors, or content that violates third-party rights. We honor good-faith takedown requests at {" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-electric hover:underline">
            {SUPPORT_EMAIL}
          </a>.
        </p>
      </>
    ),
  },
  {
    id: "termination",
    number: "07",
    title: "Termination",
    body: (
      <>
        <p>
          You can delete your account from Settings at any time. We can suspend or terminate accounts that violate these terms, threaten the integrity of the Fang economy, or expose us to legal risk. If we terminate without cause, we will refund any unused paid subscription time.
        </p>
      </>
    ),
  },
  {
    id: "disclaimers",
    number: "08",
    title: "Disclaimers and Limits",
    body: (
      <>
        <p>
          Lionade is provided as-is. We do not guarantee uninterrupted service, exact Fang values at any future date, or specific cash-payout availability in your region. To the maximum extent permitted by law, our aggregate liability for any claim arising out of the service is limited to the amount you paid us in the prior twelve months, or USD 100 if greater.
        </p>
        <p>
          Nothing in these terms limits liability that cannot be limited under applicable consumer-protection law.
        </p>
      </>
    ),
  },
  {
    id: "changes",
    number: "09",
    title: "Changes",
    body: (
      <>
        <p>
          We will update these terms as the product evolves. Material changes will be announced via in-app notification and email before they take effect. Continued use after the effective date means you accept the updated terms.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    number: "10",
    title: "Contact",
    body: (
      <>
        <p>
          Questions about these terms: email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-electric hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          or use the{" "}
          <Link href="/contact" className="text-electric hover:underline">
            contact form
          </Link>
          .
        </p>
      </>
    ),
  },
];

export default function TermsPage() {
  return (
    <div className="min-h-screen pt-20 pb-16">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <BackButton />

        {/* Hero */}
        <section className="text-center mt-4 mb-12 animate-slide-up">
          <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-gold/75 mb-4">
            Last updated · {LAST_UPDATED}
          </p>
          <h1 className="font-bebas text-6xl sm:text-7xl tracking-wider leading-[0.95]">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              TERMS OF SERVICE
            </span>
          </h1>
          <div
            aria-hidden
            className="mx-auto mt-6 h-px w-24"
            style={{ background: "linear-gradient(90deg, transparent 0%, #F0B429 50%, transparent 100%)" }}
          />
          <p className="mt-6 text-cream/65 text-base leading-relaxed max-w-xl mx-auto">
            Plain-English ground rules for using Lionade. Designed to be readable, enforceable, and fair to honest users.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">
          {/* Sticky TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/55 mb-4">
                Contents
              </p>
              <nav className="space-y-2.5">
                {SECTIONS.map((s) => (
                  <a
                    key={s.id}
                    href={`#${s.id}`}
                    className="group block text-sm text-cream/55 hover:text-cream transition-colors"
                  >
                    <span className="font-mono text-[10px] text-gold/60 group-hover:text-gold mr-2">
                      {s.number}
                    </span>
                    {s.title}
                  </a>
                ))}
              </nav>
            </div>
          </aside>

          {/* Body */}
          <article
            className="rounded-2xl border border-white/[0.08] p-7 sm:p-10 animate-slide-up"
            style={{
              background: "linear-gradient(135deg, rgba(10,16,32,0.85) 0%, rgba(6,12,24,0.85) 100%)",
              animationDelay: "0.1s",
            }}
          >
            <div className="max-w-[680px] mx-auto space-y-12">
              {SECTIONS.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-24">
                  <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-gold/70 mb-2">
                    {s.number} / {s.title}
                  </p>
                  <h2 className="font-bebas text-3xl text-cream tracking-wider mb-4">
                    {s.title}
                  </h2>
                  <div className="space-y-4 text-cream/70 text-[15px] leading-[1.7]">
                    {s.body}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
