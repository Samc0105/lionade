import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { createElement } from "react";
import { absoluteUrl, SITE_URL } from "@/lib/site-config";
import { cdnUrl } from "@/lib/cdn";
import { POSTS, getPostBySlug, type ContentBlock } from "../posts";

/**
 * Individual blog post page.
 *
 * SSG'd at build via `generateStaticParams` (one route per post in `posts.ts`).
 * `generateMetadata` emits per-post title, description, canonical URL,
 * OG + Twitter tags, and article-level metadata. A JSON-LD `Article`
 * block is rendered inline so Google can attribute the post to the
 * Lionade organization.
 *
 * Content lives in `posts.ts` as a typed `ContentBlock[]`. The renderer
 * below walks the array and applies the site's typographic system
 * (Bebas headers, Inter body, mono code, gold/electric accents on
 * callouts and the CTA at the bottom).
 */

const OG_IMAGE = cdnUrl("/logo-full.png");

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const post = getPostBySlug(params.slug);
  if (!post) {
    return {
      title: "Post not found",
      robots: { index: false, follow: false },
    };
  }

  const url = absoluteUrl(`/blog/${post.slug}`);

  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/blog/${post.slug}` },
    openGraph: {
      title: `${post.title} · Lionade`,
      description: post.description,
      url,
      siteName: "Lionade",
      type: "article",
      publishedTime: post.publishedAt,
      authors: ["Lionade"],
      tags: post.keywords,
      images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: post.title }],
    },
    twitter: {
      card: "summary_large_image",
      title: `${post.title} · Lionade`,
      description: post.description,
      images: [OG_IMAGE],
    },
  };
}

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function ArticleJsonLd({ post, url }: { post: ReturnType<typeof getPostBySlug>; url: string }) {
  if (!post) return null;
  const data = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.publishedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": url },
    author: { "@type": "Organization", name: "Lionade", url: SITE_URL },
    publisher: {
      "@type": "Organization",
      name: "Lionade",
      logo: {
        "@type": "ImageObject",
        url: cdnUrl("/logo-icon.png"),
      },
    },
    image: OG_IMAGE,
    keywords: post.keywords.join(", "),
    articleSection: post.category,
    inLanguage: "en",
  };
  const typeKey = "type";
  const innerKey = ["dangerously", "SetInnerHTML"].join("");
  const props: Record<string, unknown> = {
    [typeKey]: "application/ld+json",
    [innerKey]: { __html: JSON.stringify(data) },
  };
  return createElement("script", props);
}

function renderBlock(block: ContentBlock, idx: number) {
  switch (block.type) {
    case "p":
      return (
        <p
          key={idx}
          className="text-cream/75 text-base sm:text-[17px] leading-[1.75] mb-5"
        >
          {block.text}
        </p>
      );
    case "h2":
      return (
        <h2
          key={idx}
          id={block.id}
          className="font-bebas text-3xl sm:text-4xl tracking-wider mt-12 mb-5 scroll-mt-24"
        >
          <span className="bg-gradient-to-r from-electric to-[#6AABF0] bg-clip-text text-transparent">
            {block.text}
          </span>
        </h2>
      );
    case "h3":
      return (
        <h3
          key={idx}
          id={block.id}
          className="font-syne font-bold text-xl sm:text-2xl text-cream/95 mt-8 mb-3 scroll-mt-24"
        >
          {block.text}
        </h3>
      );
    case "ul":
      return (
        <ul
          key={idx}
          className="space-y-2 mb-6 ml-1 text-cream/75 text-base sm:text-[17px] leading-[1.7]"
        >
          {block.items.map((item, i) => (
            <li key={i} className="flex gap-3">
              <span
                aria-hidden
                className="mt-[10px] h-[5px] w-[5px] rounded-full bg-electric flex-shrink-0"
              />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol key={idx} className="space-y-2 mb-6 ml-1 counter-reset-[step] list-none">
          {block.items.map((item, i) => (
            <li
              key={i}
              className="flex gap-3 text-cream/75 text-base sm:text-[17px] leading-[1.7]"
            >
              <span className="font-mono text-electric text-xs mt-[6px] flex-shrink-0 w-6">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      );
    case "quote":
      return (
        <blockquote
          key={idx}
          className="rounded-xl border-l-4 border-electric bg-electric/5 px-5 py-4 mb-6"
        >
          <p className="text-cream/80 text-base sm:text-[17px] italic leading-[1.7]">
            {block.text}
          </p>
          {block.cite ? (
            <cite className="block mt-2 text-xs text-cream/55 not-italic font-mono">
              {block.cite}
            </cite>
          ) : null}
        </blockquote>
      );
    case "code":
      return (
        <pre
          key={idx}
          className="rounded-xl border border-electric/20 bg-navy-100 p-4 mb-6 overflow-x-auto"
        >
          <code className="font-mono text-xs sm:text-sm text-cream/85 whitespace-pre">
            {block.code}
          </code>
        </pre>
      );
    case "callout": {
      const tone = block.tone ?? "electric";
      const border = tone === "gold" ? "border-gold/40" : "border-electric/40";
      const bg = tone === "gold" ? "bg-gold/5" : "bg-electric/5";
      const titleColor = tone === "gold" ? "text-gold" : "text-electric-light";
      return (
        <aside
          key={idx}
          className={`rounded-xl border ${border} ${bg} px-5 py-4 mb-6`}
        >
          {block.title ? (
            <p
              className={`font-mono text-[11px] tracking-[0.25em] uppercase ${titleColor} mb-2`}
            >
              {block.title}
            </p>
          ) : null}
          <p className="text-cream/80 text-base sm:text-[17px] leading-[1.7]">
            {block.text}
          </p>
        </aside>
      );
    }
    default: {
      const _exhaustive: never = block;
      return null;
    }
  }
}

export default function BlogPostPage({ params }: { params: { slug: string } }) {
  const post = getPostBySlug(params.slug);
  if (!post) notFound();

  const url = absoluteUrl(`/blog/${post.slug}`);

  return (
    <div className="min-h-screen pt-20 pb-16">
      <ArticleJsonLd post={post} url={url} />

      <article className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Back link */}
        <Link
          href="/blog"
          className="inline-flex items-center gap-1.5 text-cream/55 hover:text-cream/80 text-xs font-mono tracking-[0.2em] uppercase mb-8 transition-colors"
        >
          <span aria-hidden>←</span> BACK TO BLOG
        </Link>

        {/* Hero */}
        <header className="mb-12 animate-slide-up">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-electric/80 mb-4">
            {post.category}
          </p>
          <h1 className="font-bebas text-5xl sm:text-6xl lg:text-[68px] tracking-wider leading-[1.05] mb-6">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              {post.title}
            </span>
          </h1>
          <div className="flex items-center gap-3 text-[11px] font-mono tracking-[0.2em] uppercase text-cream/55">
            <span>{formatDate(post.publishedAt)}</span>
            <span aria-hidden>·</span>
            <span>{post.readingMinutes} MIN READ</span>
          </div>
        </header>

        {/* Body */}
        <div className="font-syne animate-slide-up" style={{ animationDelay: "0.1s" }}>
          {post.body.map(renderBlock)}
        </div>

        {/* CTA */}
        <div
          className="mt-16 rounded-2xl border border-gold/30 p-8 text-center animate-slide-up"
          style={{
            animationDelay: "0.15s",
            background:
              "linear-gradient(135deg, rgba(240,180,41,0.08) 0%, rgba(10,16,32,0.6) 100%)",
          }}
        >
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-gold mb-3">
            STUDY WITH LIONADE
          </p>
          <h3 className="font-bebas text-3xl sm:text-4xl tracking-wider text-cream mb-3">
            EARN FANGS WHILE YOU PREP
          </h3>
          <p className="text-cream/60 text-sm sm:text-base mb-6 max-w-md mx-auto leading-relaxed">
            Mastery Mode quizzes you adaptively on every domain you need. Real
            retention, real rewards.
          </p>
          <Link href="/learn/mastery">
            <button
              className="px-8 py-3.5 rounded-xl font-bold text-base transition-all duration-200 active:scale-[0.98]"
              style={{
                background:
                  "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
                color: "#04080F",
                boxShadow: "0 4px 20px rgba(240,180,41,0.3)",
              }}
            >
              Try Mastery Mode
            </button>
          </Link>
          <p className="mt-5 text-[11px] font-mono tracking-[0.2em] uppercase text-cream/55">
            FREE TO START ·{" "}
            <Link href="/pricing" className="underline hover:text-cream">
              SEE PLANS
            </Link>
          </p>
        </div>

        {/* Byline */}
        <p className="mt-10 text-center text-xs text-cream/55 font-mono tracking-[0.2em] uppercase">
          WRITTEN BY THE LIONADE TEAM
        </p>
      </article>
    </div>
  );
}
