"use client";

import BackButton from "@/components/BackButton";

export default function TermsPage() {
  return (
    <div className="min-h-screen pt-20 pb-16">
      <div className="max-w-2xl mx-auto px-4 py-12">
        <BackButton />
        <div className="text-center mb-10 animate-slide-up">
          <h1 className="font-bebas text-5xl text-cream tracking-wider mb-2">Terms of Service</h1>
          <p className="text-cream/40 text-sm">Last updated: February 2026</p>
        </div>
        <div
          className="rounded-2xl border border-electric/20 p-6 sm:p-8 animate-slide-up"
          style={{ background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)", animationDelay: "0.1s" }}
        >
          <p className="text-cream/70 text-sm leading-relaxed">
            Our full terms of service will be published before public launch. By using Lionade you agree to fair play
            and respectful use of the platform. For questions, contact{" "}
            <a href="mailto:support@getlionade.com" className="text-electric hover:underline">
              support@getlionade.com
            </a>.
          </p>
        </div>
      </div>
    </div>
  );
}
