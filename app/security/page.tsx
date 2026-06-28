import Link from "next/link";
import BackButton from "@/components/BackButton";
import { SUPPORT_EMAIL, SECURITY_EMAIL } from "@/lib/site-config";

export const revalidate = 86_400;

const LAST_UPDATED = "June 2026";

const SECTIONS = [
  {
    id: "commitment",
    number: "01",
    title: "Our Commitment",
    body: (
      <>
        <p>
          We take the security of Lionade and the safety of our users' data seriously. We welcome good-faith security research and will work with you to verify, fix, and credit valid findings. This page explains how to report a vulnerability and what you can expect from us in return.
        </p>
        <p>
          This is a working version of our policy. A formal, lawyer-reviewed vulnerability disclosure policy is being prepared ahead of broader public launch. Until then, the commitments described here are what we actually follow.
        </p>
      </>
    ),
  },
  {
    id: "report",
    number: "02",
    title: "How to Report",
    body: (
      <>
        <p>
          Email{" "}
          <a href={`mailto:${SECURITY_EMAIL}`} className="text-electric hover:underline">
            {SECURITY_EMAIL}
          </a>{" "}
          with the details. If that address bounces, use{" "}
          <a href={`mailto:${SUPPORT_EMAIL}`} className="text-electric hover:underline">
            {SUPPORT_EMAIL}
          </a>{" "}
          and put "security" in the subject.
        </p>
        <p>A useful report includes:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>A clear description of the issue and its impact.</li>
          <li>The affected URL, endpoint, or screen.</li>
          <li>Step-by-step instructions to reproduce it, and a proof of concept if you have one.</li>
          <li>Any accounts, tools, or conditions needed to trigger it.</li>
        </ul>
        <p>
          Please report promptly after you find an issue, and give us a reasonable window to fix it before any public discussion. The machine-readable version of this contact lives at{" "}
          <a href="/.well-known/security.txt" className="text-electric hover:underline">
            /.well-known/security.txt
          </a>
          .
        </p>
      </>
    ),
  },
  {
    id: "scope",
    number: "03",
    title: "Scope",
    body: (
      <>
        <p>The following are in scope:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>The Lionade web app at getlionade.com and its API.</li>
          <li>The Lionade iOS app.</li>
          <li>Authentication and account takeover, the Fang economy and cash payouts, payment and billing flows, the AI features (Ninny), and any control that lets one user reach another user's data or actions.</li>
        </ul>
        <p>
          If you are unsure whether something is in scope, ask first. We would rather hear from you.
        </p>
      </>
    ),
  },
  {
    id: "out-of-scope",
    number: "04",
    title: "Out of Scope",
    body: (
      <>
        <p>The following are not in scope and usually will not be accepted:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Issues in third-party platforms we build on (such as Supabase, Stripe, Vercel, or Apple). Report those to the vendor directly.</li>
          <li>Volumetric denial of service, distributed denial of service, or brute-force and rate-limit exhaustion.</li>
          <li>Social engineering of our team or our users, and physical attacks.</li>
          <li>Email configuration opinions (SPF, DKIM, DMARC) with no demonstrated impact.</li>
          <li>Missing security headers or best-practice suggestions with no concrete, reproducible exploit.</li>
          <li>Self-inflicted issues, clickjacking on pages with no sensitive action, and findings that require a jailbroken device or a long-outdated browser.</li>
          <li>Automated scanner output with no validated, reproducible finding behind it.</li>
        </ul>
        <p>
          One important line for a real-money app: reporting a flaw that lets someone mint, duplicate, or improperly cash out Fangs is in scope and genuinely welcome. Actually farming, withdrawing, or profiting from such a flaw, or attempting real payouts or chargebacks to prove a point, is not authorized research and is not protected by safe harbor. Demonstrate economy and payout flaws against test accounts and stop before any real money changes hands.
        </p>
      </>
    ),
  },
  {
    id: "safe-harbor",
    number: "05",
    title: "Safe Harbor",
    body: (
      <>
        <p>
          If you make a good-faith effort to follow this policy while researching, we will treat your research as authorized, we will not pursue or support legal action against you for it, and we will work with you to resolve the issue quickly. To stay within good faith:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Only test against accounts you own or have explicit permission to use.</li>
          <li>Never access, collect, store, or share another person's personal information, and never interact with other users. Our service includes minors. If a vulnerability exposes any other user's data, capture only the minimum proof needed (a single redacted record), stop immediately, and report it. Do not retain that data, and delete any copy once we confirm receipt.</li>
          <li>Do not degrade, disrupt, or take our service offline.</li>
          <li>Give us a reasonable chance to remediate before disclosing publicly.</li>
        </ul>
        <p>
          To the extent your research follows this policy, we consider it authorized under the Computer Fraud and Abuse Act and similar state laws, and exempt from the anti-circumvention provisions of the Digital Millennium Copyright Act (Section 1201). We waive any claim against you under our Terms of Service for activity conducted in compliance with this policy. If a third party brings legal action against you for research that complied with this policy, we will make this authorization known and take reasonable steps to make clear that your actions were authorized.
        </p>
        <p>
          This is our commitment to you, not formal legal advice. The exact wording will be finalized in the lawyer-reviewed version. If in doubt about whether an action is allowed, ask us first.
        </p>
      </>
    ),
  },
  {
    id: "expect",
    number: "06",
    title: "What to Expect From Us",
    body: (
      <>
        <p>When you send a valid report, we will:</p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Acknowledge it within a few business days.</li>
          <li>Keep you updated as we triage, confirm, and fix.</li>
          <li>Let you know when the issue is resolved.</li>
          <li>Credit you publicly once it is fixed, with your permission.</li>
        </ul>
        <p>
          Our goal is to resolve valid reports and coordinate any public disclosure with you within 90 days of acknowledgment. Some issues take longer, and we will keep you informed if they do. We ask that you keep findings confidential until we confirm a fix or that window has passed, whichever comes first.
        </p>
        <p>
          We are a small team, so timelines are best-effort, but every report is read and taken seriously. We make the final determination on whether a report is valid, its severity, and how it is resolved.
        </p>
      </>
    ),
  },
  {
    id: "rules",
    number: "07",
    title: "Rules of Engagement",
    body: (
      <>
        <p>
          The safe-harbor conditions above are binding. These add practical guidance:
        </p>
        <ul className="list-disc pl-5 space-y-1.5">
          <li>Use test accounts you control wherever possible.</li>
          <li>Never access, collect, or retain another user's personal data. Our users include minors, whose data is categorically off limits. One redacted record is enough to prove a finding, and you should delete it once we confirm receipt.</li>
          <li>Do not run automated scans that degrade the service for others.</li>
          <li>Do not use one finding to pivot deeper into our systems.</li>
          <li>Where you can, send one clearly written report per issue.</li>
        </ul>
      </>
    ),
  },
  {
    id: "recognition",
    number: "08",
    title: "Recognition",
    body: (
      <>
        <p>
          We do not offer monetary rewards at this time, and submitting a report does not entitle you to payment. For valid, responsibly disclosed reports we offer public acknowledgment, a thank-you here or in our release notes, with your consent. If we introduce a paid program in the future, it will have its own terms.
        </p>
        <p>
          Questions about this policy: email{" "}
          <a href={`mailto:${SECURITY_EMAIL}`} className="text-electric hover:underline">
            {SECURITY_EMAIL}
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

export default function SecurityPage() {
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
              SECURITY
            </span>
          </h1>
          <div
            aria-hidden
            className="mx-auto mt-6 h-px w-24"
            style={{ background: "linear-gradient(90deg, transparent 0%, #F0B429 50%, transparent 100%)" }}
          />
          <p className="mt-6 text-cream/65 text-base leading-relaxed max-w-xl mx-auto">
            How to report a vulnerability in Lionade, what is in scope, and our safe-harbor commitment to good-faith researchers.
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
