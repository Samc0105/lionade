import Link from "next/link";
import BackButton from "@/components/BackButton";
import { SUPPORT_EMAIL } from "@/lib/site-config";

export const revalidate = 86_400;

const LAST_UPDATED = "February 2026";

const SECTIONS = [
  {
    id: "summary",
    number: "01",
    title: "The Short Version",
    body: (
      <>
        <p>
          Lionade is a study-rewards app. We collect the minimum data we need to run accounts, track focus time, pay out Fangs, and prevent fraud. We do not sell your data, and we do not run advertising networks on the site.
        </p>
        <p>
          This page is a working draft. The final, lawyer-reviewed Privacy Policy is being prepared ahead of broader public launch. Until then, the practices described here reflect what is actually running in production.
        </p>
      </>
    ),
  },
  {
    id: "collect",
    number: "02",
    title: "Information We Collect",
    body: (
      <>
        <p>
          When you sign up, we collect your email address, display name, and avatar. If you sign in with Google, we receive only the basic profile fields you authorize.
        </p>
        <p>
          When you study, we record focus-session timestamps, durations, subjects, and the Fangs you earn. When you compete, we record game results, ratings, and replays. We log basic device and browser metadata for security and abuse prevention.
        </p>
        <p>
          For cash payouts and Pro subscriptions, payment processing is handled by Stripe. We never see or store your full card details.
        </p>
      </>
    ),
  },
  {
    id: "use",
    number: "03",
    title: "How We Use It",
    body: (
      <>
        <p>
          Account data lets you sign in and recover access. Focus and game data power your dashboard, leaderboards, streaks, and Fang balance. Device metadata helps us catch bots, multi-account abuse, and payout fraud.
        </p>
        <p>
          We send transactional emails (sign-in links, payout confirmations, security alerts). Product emails are opt-in and can be turned off from your settings at any time.
        </p>
      </>
    ),
  },
  {
    id: "share",
    number: "04",
    title: "Who We Share It With",
    body: (
      <>
        <p>
          We use a small set of service providers to run Lionade: Supabase for our database and auth, Stripe for payments, Resend for transactional email, Vercel and CloudFront for hosting and CDN, and Sentry for error reporting. Each receives only the data needed for their specific function.
        </p>
        <p>
          We do not sell, rent, or trade your personal data. We disclose information when legally required (subpoena, lawful request) and will notify affected users where the law permits.
        </p>
      </>
    ),
  },
  {
    id: "rights",
    number: "05",
    title: "Your Choices",
    body: (
      <>
        <p>
          You can edit your profile, change your email, toggle product emails, and delete your account from Settings. Account deletion removes your profile, focus history, and game records within 30 days, except where retention is required for fraud prevention, accounting, or legal compliance.
        </p>
        <p>
          If you are in a jurisdiction with statutory privacy rights (EU, UK, California, others), you can exercise access, correction, deletion, and export rights by emailing {" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-electric hover:underline">
            {SUPPORT_EMAIL}
          </a>.
        </p>
      </>
    ),
  },
  {
    id: "minors",
    number: "06",
    title: "Students Under 13",
    body: (
      <>
        <p>
          Lionade is built for high-school and college students. We do not knowingly create accounts for users under 13. If a younger user signs up, we will close the account and delete their data on request. School-deployed accounts (if any) follow the verifiable-parental-consent rules of COPPA and applicable state laws.
        </p>
      </>
    ),
  },
  {
    id: "security",
    number: "07",
    title: "Security",
    body: (
      <>
        <p>
          Data in transit is encrypted with TLS. Database backups are encrypted at rest. Auth uses short-lived JWTs with rotating refresh tokens. We use row-level security in Supabase to enforce per-user data isolation. No system is unbreakable, but we treat your data like it is ours.
        </p>
      </>
    ),
  },
  {
    id: "contact",
    number: "08",
    title: "Contact",
    body: (
      <>
        <p>
          Questions, requests, or concerns: email{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-electric hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          or use the{" "}
          <Link href="/contact" className="text-electric hover:underline">
            contact form
          </Link>
          . We respond within one business day for privacy matters.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
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
              PRIVACY POLICY
            </span>
          </h1>
          <div
            aria-hidden
            className="mx-auto mt-6 h-px w-24"
            style={{ background: "linear-gradient(90deg, transparent 0%, #F0B429 50%, transparent 100%)" }}
          />
          <p className="mt-6 text-cream/65 text-base leading-relaxed max-w-xl mx-auto">
            What we collect, why we collect it, who we share it with, and how to ask us to delete it. Plain English first, lawyer-grade addendum to follow.
          </p>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-10">
          {/* Sticky TOC */}
          <aside className="hidden lg:block">
            <div className="sticky top-24">
              <p className="font-mono text-[10px] uppercase tracking-[0.28em] text-cream/45 mb-4">
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
