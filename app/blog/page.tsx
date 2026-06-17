import Link from "next/link";
import { getAllPosts } from "./posts";

/**
 * Blog index. Pure server component, no interactivity, no client JS.
 * Lists every post in `posts.ts` reverse-chronologically as a stack of
 * glass cards. Matches the visual language used on /about and /pricing:
 * Bebas headers, mono eyebrows, electric border on glass cards, gold
 * accents on the CTA-shaped link at the end.
 */

function formatDate(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

export default function BlogIndexPage() {
  const posts = getAllPosts();

  return (
    <div className="min-h-screen pt-20 pb-16">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        {/* Hero */}
        <div className="text-center mb-14 animate-slide-up">
          <p className="font-mono text-[11px] tracking-[0.3em] uppercase text-cream/55 mb-3">
            STUDY SMARTER, EARN MORE
          </p>
          <h1 className="font-bebas text-6xl sm:text-7xl tracking-wider leading-none">
            <span className="bg-gradient-to-r from-electric via-[#6AABF0] to-gold bg-clip-text text-transparent">
              THE LIONADE BLOG
            </span>
          </h1>
          <p className="text-cream/50 text-sm sm:text-base mt-5 max-w-xl mx-auto leading-relaxed">
            Study plans, certification breakdowns, and the retention science
            behind every Fang earned.
          </p>
        </div>

        {/* Post list */}
        {posts.length === 0 ? (
          <div
            className="rounded-2xl border border-electric/20 p-8 text-center"
            style={{
              background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
            }}
          >
            <p className="text-cream/50 text-sm">No posts yet. Check back soon.</p>
          </div>
        ) : (
          <div className="space-y-5">
            {posts.map((post, i) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="block group"
              >
                <article
                  className="rounded-2xl border border-electric/20 p-6 sm:p-8 transition-all duration-300 group-hover:border-electric/50 group-hover:-translate-y-0.5 animate-slide-up"
                  style={{
                    animationDelay: `${0.1 + i * 0.08}s`,
                    background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
                  }}
                >
                  <div className="flex items-center gap-3 mb-3 text-[10px] sm:text-[11px] font-mono tracking-[0.25em] uppercase text-cream/55">
                    <span className="text-electric/80">{post.category}</span>
                    <span aria-hidden>·</span>
                    <span>{formatDate(post.publishedAt)}</span>
                    <span aria-hidden>·</span>
                    <span>{post.readingMinutes} MIN READ</span>
                  </div>

                  <h2 className="font-bebas text-3xl sm:text-4xl tracking-wider leading-tight mb-3 text-cream group-hover:text-gold transition-colors">
                    {post.title}
                  </h2>

                  <p className="text-cream/60 text-sm sm:text-base leading-relaxed mb-4">
                    {post.description}
                  </p>

                  <span className="inline-flex items-center gap-2 text-electric text-sm font-semibold group-hover:text-gold transition-colors">
                    Read post
                    <span
                      aria-hidden
                      className="transition-transform duration-200 group-hover:translate-x-1"
                    >
                      →
                    </span>
                  </span>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
