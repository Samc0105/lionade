/**
 * Source of truth for Lionade blog posts.
 *
 * The blog is intentionally code-first (no MDX, no CMS) so the first
 * post ships in a single PR with zero new deps. Each post is a typed
 * object whose `body` is an ordered array of content blocks. The post
 * page (`app/blog/[slug]/page.tsx`) walks the array and renders each
 * block with the site's design system (Bebas headers, Inter body,
 * glassy blockquotes, mono code).
 *
 * Adding a post:
 *   1. Append a new `Post` object to `POSTS` below.
 *   2. Add the slug to `app/sitemap.ts`.
 *   3. (Optional) Wire an OG image. Until then we reuse the root logo.
 *
 * If/when the blog grows past ~10 posts, migrate to MDX with frontmatter.
 * Until then this stays the cheapest possible blog backend.
 */

export type ContentBlock =
  | { type: "p"; text: string }
  | { type: "h2"; text: string; id?: string }
  | { type: "h3"; text: string; id?: string }
  | { type: "ul"; items: string[] }
  | { type: "ol"; items: string[] }
  | { type: "quote"; text: string; cite?: string }
  | { type: "code"; lang?: string; code: string }
  | { type: "callout"; tone?: "gold" | "electric"; title?: string; text: string };

export type Post = {
  slug: string;
  title: string;
  description: string;
  category: string;
  publishedAt: string; // ISO date
  readingMinutes: number;
  keywords: string[];
  body: ContentBlock[];
};

export const POSTS: Post[] = [
  {
    slug: "aws-security-specialty-study-guide",
    title: "How to Study for the AWS Security Specialty Exam (and Actually Pass)",
    description:
      "A no-fluff 4-week study plan for the AWS Certified Security Specialty (SCS-C02). What the exam tests, which resources matter, test-day tactics, and how to retain it all.",
    category: "Certifications",
    publishedAt: "2026-06-06",
    readingMinutes: 9,
    keywords: [
      "AWS Security Specialty",
      "SCS-C02",
      "AWS Security Specialty study guide",
      "AWS Security Specialty study plan",
      "AWS Security Specialty passing score",
      "AWS certification",
      "cloud security exam",
    ],
    body: [
      {
        type: "p",
        text: "The AWS Certified Security Specialty (SCS-C02) is one of the harder AWS certifications, and the failure rate reflects it. People walk in confident, get hammered by scenario questions that chain four services together, and walk out wondering what just happened. The exam does not reward memorizing service names. It rewards knowing exactly which service solves a specific incident, in what order, with which IAM policy attached.",
      },
      {
        type: "p",
        text: "This is the plan that actually works. Four weeks, concrete daily actions, real resources, and a test-day playbook. No filler.",
      },

      { type: "h2", id: "what-the-exam-tests", text: "What the exam actually tests" },
      {
        type: "p",
        text: "SCS-C02 has 65 questions and a 170-minute window. The passing score is 750 out of 1000. You will see standard multiple choice and multiple response. There is no penalty for guessing, so every blank is a wasted point.",
      },
      {
        type: "p",
        text: "AWS publishes six domains. Here is what each one is really asking:",
      },
      {
        type: "ul",
        items: [
          "Threat detection and incident response (14%). Can you wire GuardDuty findings to EventBridge to Lambda and contain a compromised EC2 instance without paging a human?",
          "Security logging and monitoring (18%). Do you know when to use CloudTrail vs Config vs Security Lake, and how to centralize logs across an Organization?",
          "Infrastructure security (20%). VPC design, Security Groups vs NACLs, AWS Network Firewall, WAF rule groups, and Shield Advanced. The big one.",
          "Identity and access management (16%). IAM policy evaluation logic, permission boundaries, SCPs, IAM Identity Center, and the order Allow / Deny / implicit Deny gets evaluated.",
          "Data protection (18%). KMS key policies, grants, envelope encryption, S3 bucket policies vs ACLs vs Object Ownership, and Secrets Manager rotation.",
          "Management and security governance (14%). AWS Organizations, Control Tower, Config conformance packs, and how to enforce a guardrail at scale.",
        ],
      },
      {
        type: "callout",
        tone: "electric",
        title: "The biggest trap",
        text: "Most questions give you four answers that all technically work. The right answer is the one that is least operationally heavy, costs the least, and uses an AWS-managed service over a custom one. If you see a Lambda function in three answers and a managed service in the fourth, the managed service is usually right.",
      },

      { type: "h2", id: "the-4-week-study-plan", text: "The 4-week study plan" },
      {
        type: "p",
        text: "Four weeks at roughly 90 minutes per day is enough if you already work with AWS. If you do not, double the timeline. The plan front-loads IAM and KMS because those two domains thread through every other question.",
      },

      { type: "h3", text: "Week 1: IAM, KMS, and the policy evaluation engine" },
      {
        type: "ol",
        items: [
          "Day 1 to 2: IAM policy structure. Read every line of the AWS IAM User Guide section on policy evaluation logic. Draw the evaluation flowchart from memory.",
          "Day 3: Permission boundaries vs SCPs vs session policies. Build a mental model of what wins when they conflict.",
          "Day 4 to 5: KMS. Symmetric vs asymmetric, customer managed vs AWS managed vs AWS owned. Key policies vs grants vs IAM policies.",
          "Day 6: Cross-account access patterns. Assume-role, resource-based policies, and the confused deputy problem.",
          "Day 7: Hands-on lab. Create a KMS key with a key policy that only one IAM role in another account can use. Verify with the CLI.",
        ],
      },

      { type: "h3", text: "Week 2: Logging, monitoring, detection" },
      {
        type: "ol",
        items: [
          "Day 8 to 9: CloudTrail (management events, data events, Insights). What gets logged by default and what does not.",
          "Day 10: Config. Conformance packs, custom rules, and aggregation across an Organization.",
          "Day 11: GuardDuty. Finding types, automated response patterns, and the three protection plans (S3, EKS, Malware).",
          "Day 12: Security Hub, Detective, and Macie. Know which one answers which kind of question.",
          "Day 13: Centralized logging architectures. CloudWatch Logs vs Kinesis Firehose vs Security Lake.",
          "Day 14: Hands-on lab. Trigger a GuardDuty finding (use the sample findings feature), route it through EventBridge, and isolate the instance with a Lambda.",
        ],
      },

      { type: "h3", text: "Week 3: Networking and infrastructure security" },
      {
        type: "ol",
        items: [
          "Day 15: VPC fundamentals. Subnets, route tables, NAT vs IGW, and VPC endpoints (gateway vs interface).",
          "Day 16: Security Groups vs NACLs. Stateful vs stateless, and the order they evaluate.",
          "Day 17: AWS WAF. Rule groups, rate-based rules, and managed rule sets. Know what WAF cannot block.",
          "Day 18: AWS Shield (Standard and Advanced) and AWS Network Firewall vs third-party appliances.",
          "Day 19: Edge security. CloudFront with WAF, Origin Access Control, and signed URLs vs signed cookies.",
          "Day 20: PrivateLink, Transit Gateway, and inspection VPC patterns.",
          "Day 21: Hands-on lab. Build a VPC with a public ALB, private app subnet, and S3 access via gateway endpoint only.",
        ],
      },

      { type: "h3", text: "Week 4: Practice exams and weak-spot fixes" },
      {
        type: "ol",
        items: [
          "Day 22: First full practice exam, timed. Score it honestly. Note every domain you scored under 70%.",
          "Day 23 to 25: One weak domain per day. Read the AWS docs for the relevant services end to end. Redo the questions you missed.",
          "Day 26: Second full practice exam. Target 80%+ to feel safe for the real thing.",
          "Day 27: Whitepaper day. AWS Security Best Practices and the Well-Architected Security Pillar. These show up almost verbatim in scenario questions.",
          "Day 28: Light review only. Sleep. Eat. Show up early.",
        ],
      },

      { type: "h2", id: "resources", text: "Resources worth your time" },
      {
        type: "p",
        text: "Most courses are bloated. These three are the short list.",
      },
      {
        type: "ul",
        items: [
          "Stephane Maarek's AWS Security Specialty course on Udemy. Dense, accurate, and structured around the actual exam blueprint. Watch at 1.5x.",
          "Tutorials Dojo practice exams (Jon Bonso). The closest you will get to real exam difficulty. If you can pass these at 80%+, the real exam feels routine.",
          "Two AWS whitepapers, free and short. AWS Security Best Practices and the Security Pillar of the Well-Architected Framework. Read both twice.",
        ],
      },
      {
        type: "p",
        text: "Skip every YouTube cram video that promises a 24-hour pass. They are scraping the blueprint and reciting it. The exam tests judgment, not recall.",
      },

      { type: "h2", id: "lionade", text: "Where Lionade fits in" },
      {
        type: "p",
        text: "Reading whitepapers is one thing. Remembering them three weeks later under exam pressure is another. The bottleneck for most people is retention, not exposure.",
      },
      {
        type: "p",
        text: "Lionade's Mastery Mode is built for exactly this kind of certification grind. You paste in a target (\"AWS Security Specialty\"), and the AI breaks it down into the same six domains the exam tests. It quizzes you adaptively, surfaces the questions you keep missing, and uses spaced repetition so the IAM evaluation flow you learned on Day 1 is still sharp on Day 28.",
      },
      {
        type: "p",
        text: "Every correct answer pays out Fangs. Fangs buy real things in the shop or cash out. You are getting paid to study, which is a much better incentive structure than guilt.",
      },
      {
        type: "callout",
        tone: "gold",
        title: "Try it for free",
        text: "Mastery Mode is free on the free plan, with one active exam slot. Pro lifts that to three concurrent exams and a 1.5x Fang multiplier on every correct answer.",
      },

      { type: "h2", id: "test-day-tactics", text: "Test-day tactics" },
      {
        type: "p",
        text: "You have 170 minutes for 65 questions. That is 2 minutes and 36 seconds per question on average. Most people burn the first 20 questions in 90 seconds each and then run out of clock on the long scenarios.",
      },
      {
        type: "ul",
        items: [
          "Set a soft timer. At question 22 you should have 115 minutes left. At question 44 you should have 60 minutes left. If you are behind, start flagging and moving.",
          "Read the last sentence of the question first. It tells you what is actually being asked (\"most cost-effective\", \"least operational overhead\", \"highest security\"). Then read the scenario knowing what to look for.",
          "Eliminate two answers fast. There are almost always two answers that are clearly wrong (deprecated services, missing required steps, or violating least privilege). Pick between the remaining two.",
          "Flag and return. Anything that takes more than 3 minutes, flag it, pick your best guess, and move. You will have 20 to 30 minutes at the end for flagged questions, and your subconscious works on them while you do other questions.",
          "Never leave a blank. There is no negative marking. A blind guess is +25% expected value over a blank.",
        ],
      },

      { type: "h2", id: "faq", text: "FAQ" },

      { type: "h3", text: "What's the passing score?" },
      {
        type: "p",
        text: "750 out of 1000. AWS does not publish the per-domain weighting on the score report, so you cannot tell which domain saved you. Aim for 80%+ on practice exams to have a comfortable margin.",
      },

      { type: "h3", text: "Are there prerequisites?" },
      {
        type: "p",
        text: "Officially, none. Realistically, you want two or more years of hands-on AWS experience or another AWS associate-level cert under your belt. Going in cold from zero AWS is possible but the timeline doubles.",
      },

      { type: "h3", text: "How often do I need to recertify?" },
      {
        type: "p",
        text: "Every three years. You can either retake the exam or get one higher-level cert that resets the clock on everything below it. Plan ahead so you are not cramming during the same week as a work deadline.",
      },

      { type: "h3", text: "Is the SCS-C02 harder than the old SCS-C01?" },
      {
        type: "p",
        text: "Marginally. SCS-C02 added more around Security Lake, IAM Identity Center, and zero-trust patterns. If you used a C01 prep course, supplement it with the AWS Security blog posts from the last 18 months.",
      },

      { type: "h2", id: "closing", text: "Closing" },
      {
        type: "p",
        text: "The Security Specialty rewards people who treat it like a profession, not a memorization contest. Four weeks of focused practice with real labs beats three months of passive video watching every time. Build the model in your head, test it against scenarios, and trust your prep on exam day.",
      },
      {
        type: "p",
        text: "If you are studying for it right now, Mastery Mode will drill you on every weak spot until the exam is muscle memory. Set up your target, paste in \"AWS Security Specialty\", and start earning Fangs while you study.",
      },
    ],
  },
];

/** Lookup helper used by `app/blog/[slug]/page.tsx` and `generateStaticParams`. */
export function getPostBySlug(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

/** Reverse-chronological list for the blog index. */
export function getAllPosts(): Post[] {
  return [...POSTS].sort((a, b) =>
    b.publishedAt.localeCompare(a.publishedAt),
  );
}
