"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cdnUrl } from "@/lib/cdn";

type FooterLink = { href: string; label: string; external?: boolean };

const PRODUCT: FooterLink[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/games", label: "Games" },
  { href: "/learn/mastery", label: "Mastery Mode" },
  { href: "/vocab", label: "Vocab" },
  { href: "/compete", label: "Compete" },
];

const COMPANY: FooterLink[] = [
  { href: "/about", label: "About" },
  { href: "/blog", label: "Blog" },
  { href: "/pricing", label: "Pricing" },
  { href: "/contact", label: "Contact" },
];

const LEGAL: FooterLink[] = [
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
];

const CONNECT: FooterLink[] = [
  { href: "https://x.com/lionade", label: "X / Twitter", external: true },
  { href: "mailto:support@getlionade.com", label: "Email Support", external: true },
];

function Column({ title, links }: { title: string; links: FooterLink[] }) {
  return (
    <div>
      <h3 className="font-mono text-[10px] uppercase tracking-[0.22em] text-gold/70 mb-4">
        {title}
      </h3>
      <ul className="space-y-2.5">
        {links.map((link) => (
          <li key={link.label}>
            {link.external ? (
              <a
                href={link.href}
                target={link.href.startsWith("http") ? "_blank" : undefined}
                rel={link.href.startsWith("http") ? "noopener noreferrer" : undefined}
                className="text-cream/55 text-sm hover:text-cream transition-colors duration-150"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-cream/55 text-sm hover:text-cream transition-colors duration-150"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function Footer() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/onboarding") return null;
  if (pathname?.match(/^\/learn\/mastery\/[^/]+$/)) return null;

  return (
    <footer className="w-full mt-20 relative">
      <div
        aria-hidden
        className="h-px w-full"
        style={{
          background:
            "linear-gradient(90deg, transparent 0%, rgba(240,180,41,0.0) 5%, rgba(240,180,41,0.35) 50%, rgba(240,180,41,0.0) 95%, transparent 100%)",
        }}
      />
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-10 md:gap-8">
          <div className="col-span-2 sm:col-span-3 md:col-span-1">
            <Link href="/dashboard" className="inline-flex items-center gap-2.5 group">
              <img
                src={cdnUrl("/logo-icon.png")}
                alt="Lionade"
                className="h-9 w-9 rounded-lg"
                style={{ boxShadow: "0 0 18px rgba(240,180,41,0.25)" }}
              />
              <span className="font-bebas text-2xl tracking-wider text-cream group-hover:text-gold transition-colors">
                LIONADE
              </span>
            </Link>
            <p className="mt-4 text-cream/45 text-sm leading-relaxed max-w-[14rem]">
              Study harder. Earn Fangs. Get paid for the grind.
            </p>
          </div>

          <Column title="Product" links={PRODUCT} />
          <Column title="Company" links={COMPANY} />
          <Column title="Legal" links={LEGAL} />
          <Column title="Connect" links={CONNECT} />
        </div>

        <div className="mt-12 pt-6 border-t border-cream/5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/35">
            Made with study energy in the United States
          </p>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/35">
            &copy; {new Date().getFullYear()} Lionade. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  );
}
