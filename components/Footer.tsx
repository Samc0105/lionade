"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/about", label: "About" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/contact", label: "Contact" },
];

export default function Footer() {
  const pathname = usePathname();

  // Hide on coming soon and onboarding
  if (pathname === "/" || pathname === "/onboarding") return null;

  return (
    <footer className="w-full py-6 text-center">
      <div className="flex items-center justify-center gap-4 flex-wrap">
        {LINKS.map((link) => (
          <Link
            key={link.label}
            href={link.href}
            className="text-cream/25 text-xs hover:text-cream/50 transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </div>
      <p className="text-cream/15 text-[10px] mt-2">&copy; {new Date().getFullYear()} Lionade</p>
    </footer>
  );
}
