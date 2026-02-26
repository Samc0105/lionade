import type { Metadata } from "next";
import { Bebas_Neue, Syne, DM_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AuthProviderWrapper from "@/components/AuthProviderWrapper";

const bebasNeue = Bebas_Neue({
  variable: "--font-bebas",
  weight: "400",
  subsets: ["latin"],
  display: "swap",
});

const syne = Syne({
  variable: "--font-syne",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});

const dmMono = DM_Mono({
  variable: "--font-dm-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Lionade — Study Like It's Your Job",
  description:
    "The Gen Z study rewards platform. Earn coins for studying, battle friends in duels, climb the leaderboard.",
  keywords: ["study", "rewards", "quiz", "education", "gamification", "coins"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${bebasNeue.variable} ${syne.variable} ${dmMono.variable}`}>
      <body className="text-cream font-syne antialiased">
        <AuthProviderWrapper>
          <Navbar />
          <main>{children}</main>
          <Footer />
        </AuthProviderWrapper>
      </body>
    </html>
  );
}
