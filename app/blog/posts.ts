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

  {
    slug: "comptia-security-plus-30-day-study-plan",
    title: "How to Pass CompTIA Security+ (SY0-701) in 30 Days",
    description:
      "A 30-day study plan for CompTIA Security+ (SY0-701). What the exam tests, the week-by-week schedule, the resources worth using, and how to retain it all under exam pressure.",
    category: "Certifications",
    publishedAt: "2026-06-08",
    readingMinutes: 10,
    keywords: [
      "CompTIA Security+",
      "SY0-701",
      "Security+ 30 day study plan",
      "Sec+ pass rate",
      "CompTIA Security+ study guide",
      "Security+ exam tips",
      "entry level cybersecurity certification",
    ],
    body: [
      {
        type: "p",
        text: "Security+ is the most common first cybersecurity certification, and the SY0-701 version is harder than people give it credit for. The blueprint covers five domains, the questions chain concepts together, and the performance-based questions at the start eat your clock if you let them.",
      },
      {
        type: "p",
        text: "30 days is enough if you stay on schedule. This is the plan. No 90-hour video course, no 1,500-question dump, no panic the night before. Just a clean week-by-week ladder with the resources that actually pull weight.",
      },

      { type: "h2", id: "what-the-exam-tests", text: "What SY0-701 actually tests" },
      {
        type: "p",
        text: "The exam is up to 90 questions in 90 minutes. The passing score is 750 out of 900. You will see standard multiple choice, multiple response, and 3 to 5 performance-based questions (PBQs) at the very start. PBQs are simulations: drag-and-drop firewall rules, fill in a SIEM dashboard, classify log entries.",
      },
      {
        type: "p",
        text: "CompTIA publishes five domains. Here is what each one is really asking of you:",
      },
      {
        type: "ul",
        items: [
          "General Security Concepts (12%). CIA triad, zero trust, change management, cryptography basics. The cheap-points domain. Master it cold.",
          "Threats, Vulnerabilities, and Mitigations (22%). The fattest domain. Attack types, social engineering, threat actors, indicators of compromise, and the specific mitigations for each.",
          "Security Architecture (18%). Cloud models, network architecture, secure design principles, data classification, resiliency, and high availability.",
          "Security Operations (28%). The other fat domain. SIEM, vulnerability management, incident response phases, digital forensics, automation, and identity and access management.",
          "Security Program Management and Oversight (20%). Governance, risk management, compliance frameworks (PCI DSS, GDPR, HIPAA), vendor assessment, and security awareness.",
        ],
      },
      {
        type: "callout",
        tone: "electric",
        title: "PBQ rule of thumb",
        text: "Skip the PBQs on first pass. Mark them, do all 80 to 85 multiple choice first, then come back. PBQs are worth more points each but they also burn 5 to 10 minutes apiece. Locking in the easy points first is the right move.",
      },

      { type: "h2", id: "the-4-week-study-plan", text: "The 30-day study plan" },
      {
        type: "p",
        text: "Roughly 60 to 90 minutes per day. If you are working full time, batch 3 weekday sessions plus a longer weekend session. The plan front-loads the two heaviest domains (Threats and Operations) because they are 50% of your score combined.",
      },

      { type: "h3", text: "Week 1: Threats, Vulnerabilities, and Mitigations" },
      {
        type: "ol",
        items: [
          "Day 1: Threat actor types, motivations, and attributes. Nation-state vs hacktivist vs insider. Know who does what.",
          "Day 2: Social engineering vectors. Phishing, vishing, smishing, pretexting, BEC. Learn the indicators for each.",
          "Day 3: Malware families. Ransomware, RAT, keylogger, rootkit, fileless. Know the distinguishing behavior, not just the name.",
          "Day 4: Network attacks. ARP poisoning, DNS spoofing, on-path, replay, downgrade, amplification, DDoS.",
          "Day 5: Application attacks. Injection (SQLi, command, LDAP), XSS, CSRF, directory traversal, race conditions.",
          "Day 6: Vulnerability types. Memory injection, buffer overflow, race condition, hardware (firmware, end-of-life), cloud-specific, supply chain.",
          "Day 7: Mitigation matrix. For every attack on days 1 to 6, write down the two most common mitigations. Quiz yourself blind.",
        ],
      },

      { type: "h3", text: "Week 2: Security Operations" },
      {
        type: "ol",
        items: [
          "Day 8: SIEM and log sources. What gets ingested, what gets correlated, what triggers an alert.",
          "Day 9: Vulnerability management lifecycle. Discovery, prioritization (CVSS, exploit availability), remediation, validation.",
          "Day 10: Incident response phases. Preparation, identification, containment, eradication, recovery, lessons learned. Know the order.",
          "Day 11: Digital forensics. Order of volatility, chain of custody, evidence acquisition (live vs dead).",
          "Day 12: Identity and access management. MFA factors, federation (SAML, OAuth, OIDC), privilege escalation paths.",
          "Day 13: Automation and orchestration. SOAR, playbooks, scripting use cases. Recognize where automation helps and where it does not.",
          "Day 14: Hands-on. Use a free tier of Splunk or Elastic. Ingest a sample log set. Build one correlation rule. The PBQs feel obvious after this.",
        ],
      },

      { type: "h3", text: "Week 3: Architecture, concepts, and oversight" },
      {
        type: "ol",
        items: [
          "Day 15: Cloud models (IaaS, PaaS, SaaS). Shared responsibility matrix. Know what the customer owns at each tier.",
          "Day 16: Network architecture. Segmentation, VLANs, DMZ, screened subnets, microsegmentation, SD-WAN.",
          "Day 17: Cryptography. Symmetric vs asymmetric, hashing vs encryption, PKI, certificates, key escrow.",
          "Day 18: Secure design principles. Least privilege, defense in depth, zero trust, secure by default.",
          "Day 19: Resiliency. Backups (3-2-1), RTO/RPO, hot/warm/cold sites, geographic dispersion.",
          "Day 20: Governance and compliance. GDPR, HIPAA, PCI DSS, SOX. Know what each regulation actually protects.",
          "Day 21: Risk management. Risk register, qualitative vs quantitative analysis, risk treatment (accept, transfer, mitigate, avoid).",
        ],
      },

      { type: "h3", text: "Week 4: Practice exams, PBQ drills, taper" },
      {
        type: "ol",
        items: [
          "Day 22: First full timed practice exam from Jason Dion. Score it. Note every domain under 75%.",
          "Day 23: PBQ drills. Watch Professor Messer's PBQ walkthrough videos and replicate the click paths.",
          "Day 24 to 26: One weak domain per day. Re-read CompTIA's official exam objectives PDF for that domain. Redo every missed question.",
          "Day 27: Second full timed practice exam. Target 85%+ in the comfort zone.",
          "Day 28: Review the official acronym list. SY0-701 loves acronyms.",
          "Day 29: Light review only. No new material. Sleep early.",
          "Day 30: Exam day. Eat. Hydrate. Show up 30 minutes early.",
        ],
      },

      { type: "h2", id: "resources", text: "Resources worth your time" },
      {
        type: "p",
        text: "Three resources will get you through. The rest are noise.",
      },
      {
        type: "ul",
        items: [
          "Professor Messer's SY0-701 video course on YouTube. Free, complete, and structured exactly to the exam objectives. Watch at 1.25x. His PBQ walkthrough video alone is worth the whole prep.",
          "Jason Dion's SY0-701 practice exams on Udemy. The closest match to real exam difficulty. If you can pass these at 85%+, the real exam is straightforward.",
          "CompTIA's official Exam Objectives PDF. Free from the CompTIA website. Print it. Highlight every term you cannot define out loud. Your study is done when nothing is highlighted.",
        ],
      },
      {
        type: "p",
        text: "Skip the 25-hour Udemy mega-courses unless you have zero IT background. They pad with content that does not appear on the exam.",
      },

      { type: "h2", id: "lionade", text: "Where Lionade fits in" },
      {
        type: "p",
        text: "Watching Messer is exposure. Doing Dion exams is calibration. Neither solves the retention problem on its own. You will know a topic cold on Day 8 and blank on it on Day 28 unless you actively re-test.",
      },
      {
        type: "p",
        text: "Lionade's Mastery Mode is built for this exact loop. Paste in \"CompTIA Security+\" and the AI breaks it into the five exam domains and quizzes you adaptively. Every wrong answer goes back into the queue with shorter spacing. Every correct one stretches out further. By Day 30 the questions you missed on Day 8 are surfaced one more time, automatically.",
      },
      {
        type: "p",
        text: "Every correct answer pays Fangs. Fangs cash out or buy real items in the shop. You are getting paid to drill flashcards, which beats discipline every time. Try Mastery Mode free at /learn/mastery and see plan details at /pricing.",
      },
      {
        type: "callout",
        tone: "gold",
        title: "Pair it with another cert",
        text: "If you already finished or are working on the AWS Security Specialty, Sec+ is a natural pair. The cryptography, IAM, and incident response overlap is huge. Our AWS Security Specialty guide at /blog/aws-security-specialty-study-guide covers that exam in depth.",
      },

      { type: "h2", id: "test-day-tactics", text: "Test-day tactics" },
      {
        type: "p",
        text: "90 minutes for up to 90 questions. That is roughly 1 minute per question with no slack, so time discipline matters more than on most exams.",
      },
      {
        type: "ul",
        items: [
          "Skip every PBQ on first pass. Mark them, do all multiple choice first, then return. You will have 20 to 30 minutes left for PBQs after the multiple choice if you stay on pace.",
          "Read the last sentence of every multiple choice first. The question stem tells you what is being asked (\"BEST mitigation\", \"FIRST step\", \"MOST cost-effective\"). Anchor on that before reading the scenario.",
          "Eliminate two answers fast. CompTIA almost always has two clearly wrong distractors (deprecated tech, the wrong layer, or violating a basic principle). Pick between the two plausible ones.",
          "Never leave a question blank. No negative marking. A blind guess is a free 25% expected value.",
          "If you do not know the answer in 60 seconds, mark, guess, and move. You can come back. Sitting on one question kills your pace and your confidence.",
        ],
      },

      { type: "h2", id: "faq", text: "FAQ" },

      { type: "h3", text: "What is the passing score?" },
      {
        type: "p",
        text: "750 out of 900. CompTIA does not show per-domain scores on the report, so you will not know which domain saved you. Aim for 85%+ on practice exams to give yourself a comfortable cushion.",
      },

      { type: "h3", text: "Is Security+ worth it if I already have AWS or Azure certs?" },
      {
        type: "p",
        text: "Yes, especially for job applications and DoD 8570 compliance roles. Cloud certs prove vendor-specific depth. Sec+ proves vendor-neutral security fundamentals. Together they read very strong on a resume.",
      },

      { type: "h3", text: "How often do I have to recertify?" },
      {
        type: "p",
        text: "Sec+ is valid for 3 years. You can renew by earning Continuing Education Units (CEUs), passing a higher CompTIA cert, or retaking the latest version of the exam. Plan ahead so you are not cramming the recert during a job change.",
      },

      { type: "h3", text: "SY0-701 vs SY0-601: how different?" },
      {
        type: "p",
        text: "SY0-701 leaned harder into cloud, zero trust, and automation. The Operations domain is heavier. If you used 601 materials, supplement with Messer's 701-specific videos and any 701 practice exams. Do not study from 601-only sources alone.",
      },

      { type: "h2", id: "closing", text: "Closing" },
      {
        type: "p",
        text: "Sec+ rewards consistent reps more than raw IQ. 30 days of focused study with the right resources beats 3 months of passive video watching every time. Build the model in your head, drill against scenario questions, and trust the prep on exam day.",
      },
      {
        type: "p",
        text: "If you want the retention loop done for you, set up Mastery Mode with \"CompTIA Security+ SY0-701\" as your target. Earn Fangs while you study. Show up on Day 30 ready.",
      },
    ],
  },

  {
    slug: "ap-us-history-last-month-cram",
    title: "AP US History: The 5-Step Last-Month Cram (How to Score a 5)",
    description:
      "Four weeks left until the APUSH exam. Here is the 5-step plan that will move you from a 3 to a 5: period priorities, FRQ tactics, MCQ pacing, the resources that work, and how to retain it under pressure.",
    category: "AP Exams",
    publishedAt: "2026-06-10",
    readingMinutes: 10,
    keywords: [
      "AP US History",
      "APUSH",
      "APUSH last minute study",
      "APUSH exam tips",
      "score 5 APUSH",
      "AP US History cram",
      "APUSH study plan",
    ],
    body: [
      {
        type: "p",
        text: "There are 30-ish days left until the APUSH exam and you are panicking. Stop. Most people who score a 5 do not spend the year memorizing every president's middle name. They learn the period themes, master the document-based question, and pace the multiple choice properly. That is what you are doing for the next month.",
      },
      {
        type: "p",
        text: "This is the 5-step cram. Each step is one priority. Hit them in order, and you walk into May with the highest possible score per hour of effort.",
      },

      { type: "h2", id: "the-exam", text: "What APUSH actually tests" },
      {
        type: "p",
        text: "The exam is 3 hours 15 minutes. Two sections. Each is worth 50% of your score.",
      },
      {
        type: "ul",
        items: [
          "Section 1A: 55 multiple choice questions in 55 minutes. Stimulus-based, almost always built around a document, image, map, or chart.",
          "Section 1B: 3 short-answer questions (SAQs) in 40 minutes. One required, then choose from the remaining two.",
          "Section 2A: 1 document-based question (DBQ) in 60 minutes (includes 15 minutes of reading). The big one. Worth 25% of your total exam.",
          "Section 2B: 1 long essay question (LEQ) in 40 minutes. Choose 1 of 3 prompts spanning different time periods.",
        ],
      },
      {
        type: "p",
        text: "College Board organizes content into 9 periods, from 1491 to the present. Periods 3 to 8 (1754 through 1980) carry about 80% of the exam weight. Period 1 (1491 to 1607) and Period 9 (1980 to present) are the lightest. Spend your time accordingly.",
      },
      {
        type: "callout",
        tone: "electric",
        title: "The 5 rule",
        text: "If you can argue why a period mattered in two sentences, you are scoring a 4. If you can connect it to the period before and the period after, you are scoring a 5. Themes beat trivia.",
      },

      { type: "h2", id: "step-1", text: "Step 1: Lock down the 7 themes (Days 1 to 5)" },
      {
        type: "p",
        text: "Every APUSH question lives inside one of the official College Board themes. Memorize them in order, with one sentence each:",
      },
      {
        type: "ol",
        items: [
          "American and National Identity (NAT). Who counts as American? How has that definition shifted?",
          "Work, Exchange, and Technology (WXT). What were people making, trading, and inventing, and who profited?",
          "Geography and the Environment (GEO). How did land, climate, and migration shape the country?",
          "Migration and Settlement (MIG). Who moved, why, and what happened when they arrived?",
          "Politics and Power (PCE). How was political authority gained, used, and contested?",
          "America in the World (WOR). How did the US interact with foreign powers and ideologies?",
          "American and Regional Culture (ARC). What did people believe, write, perform, and protest?",
        ],
      },
      {
        type: "p",
        text: "Tag every event you study with the 1 or 2 themes it speaks to. The DBQ rubric explicitly rewards thematic argumentation. The MCQ explicitly tests it.",
      },

      { type: "h2", id: "step-2", text: "Step 2: Heimler's review videos for periods 3 to 8 (Days 6 to 12)" },
      {
        type: "p",
        text: "Heimler's History on YouTube has a free Period-by-Period review series. They are 10 to 25 minutes each, structured exactly to the College Board CED, and ridiculously efficient.",
      },
      {
        type: "ul",
        items: [
          "Day 6: Period 3 (1754 to 1800). Revolution, Constitution, early republic.",
          "Day 7: Period 4 (1800 to 1848). Market Revolution, Jacksonian democracy, reform movements.",
          "Day 8: Period 5 (1844 to 1877). Civil War, Reconstruction.",
          "Day 9: Period 6 (1865 to 1898). Gilded Age, industrialization, populism.",
          "Day 10: Period 7 (1890 to 1945). Progressive Era, World Wars, New Deal.",
          "Day 11: Period 8 (1945 to 1980). Cold War, Civil Rights, Vietnam.",
          "Day 12: Period 9 (1980 to present). Reagan, neoliberalism, post-Cold War.",
        ],
      },
      {
        type: "p",
        text: "Watch one a day. Take notes only on the periodization causes and effects. Not the names. Names are MCQ fuel and you cram those later.",
      },

      { type: "h2", id: "step-3", text: "Step 3: AMSCO chapter drills (Days 13 to 18)" },
      {
        type: "p",
        text: "AMSCO is the standard APUSH workbook for a reason. Each chapter ends with stimulus-based MCQs that read almost identical to the real exam.",
      },
      {
        type: "ol",
        items: [
          "Day 13: AMSCO chapters covering Period 3. Do every end-of-chapter MCQ. Mark every miss.",
          "Day 14: Period 4 chapters. Same drill.",
          "Day 15: Period 5 chapters. Same drill.",
          "Day 16: Period 6 chapters. Same drill.",
          "Day 17: Period 7 chapters. Same drill.",
          "Day 18: Period 8 chapters. Same drill.",
        ],
      },
      {
        type: "p",
        text: "Do not read the textbook chapters cover to cover. Read the section summaries, then go straight to the questions. You learn faster from being wrong than from reading.",
      },

      { type: "h2", id: "step-4", text: "Step 4: DBQ and LEQ rubric drills (Days 19 to 24)" },
      {
        type: "p",
        text: "This is the highest-leverage week. The DBQ is 25% of the exam. The LEQ is another 15%. Together they are 40% of your score, and the rubric is mechanical.",
      },
      {
        type: "p",
        text: "The DBQ rubric awards 7 points. Memorize them:",
      },
      {
        type: "ul",
        items: [
          "Thesis (1 point). Specific, evaluative, takes a defensible position.",
          "Contextualization (1 point). 1 to 3 sentences placing the prompt in broader historical context, before or after.",
          "Document use (up to 3 points). Use 6 of 7 documents to support your argument (2 points). Plus describe POV, purpose, situation, or audience of 3 documents (1 point).",
          "Outside evidence (1 point). One specific historical fact beyond the documents.",
          "Complexity (1 point). Show nuance: continuity AND change, multiple causes, qualifying your own thesis, etc.",
        ],
      },
      {
        type: "ol",
        items: [
          "Day 19: Read 3 official sample DBQs and the official scoring rubric. Mark exactly where each point was earned.",
          "Day 20: Write a full DBQ under timed conditions (60 minutes). Use a released prompt from the College Board.",
          "Day 21: Self-score it against the rubric. Find the missing points.",
          "Day 22: Read 3 official sample LEQs. Same process.",
          "Day 23: Write a full LEQ under timed conditions (40 minutes).",
          "Day 24: Self-score, find the missing points, rewrite the thesis until it would have earned the complexity point.",
        ],
      },
      {
        type: "callout",
        tone: "electric",
        title: "Thesis cheat code",
        text: "A 5-scoring thesis is always: \"Although X, the more significant factor was Y, because Z.\" Three clauses. Acknowledges complexity (Although X), takes a position (Y), gives the analytical reason (because Z). Practice this sentence structure until you can write it in 90 seconds.",
      },

      { type: "h2", id: "step-5", text: "Step 5: Practice exams and taper (Days 25 to 30)" },
      {
        type: "ol",
        items: [
          "Day 25: First full timed practice exam. Use a recent released exam from the College Board. Score MCQ. Self-score FRQ. Be honest.",
          "Day 26: Review every MCQ miss. Categorize: was it a content gap, a misread, or a guessing pattern?",
          "Day 27: Princeton Review's cheat sheets. They have a 25-page condensed review at the back. Read it cover to cover.",
          "Day 28: Second timed practice exam. Aim for 80%+ on MCQ and a clean DBQ.",
          "Day 29: Light review. Re-read your thematic notes from Step 1. Sleep.",
          "Day 30: Exam day. Eat protein, not sugar. Show up early.",
        ],
      },

      { type: "h2", id: "resources", text: "Resources worth your time" },
      {
        type: "ul",
        items: [
          "Heimler's History on YouTube. Free. The period review series is the single best free APUSH resource on the internet.",
          "AMSCO AP US History workbook. The standard for a reason. Do the end-of-chapter MCQs, skip the long reading.",
          "Princeton Review's Cracking the AP US History Exam. Skip the bulk content. The condensed review section in the back is gold.",
          "College Board's released exams (in the AP Classroom progress checks and the public archive). The most accurate practice you can get.",
        ],
      },

      { type: "h2", id: "lionade", text: "Where Lionade fits in" },
      {
        type: "p",
        text: "Lionade's Mastery Mode works for high-school exams too. Paste in \"AP US History\" and the AI breaks it into the 9 College Board periods and the 7 themes. It quizzes you adaptively on causes and effects, key events, and SAQ-style stimulus questions.",
      },
      {
        type: "p",
        text: "Every right answer pays Fangs. Fangs cash out, buy real items in the shop, or unlock streak boosters. You are getting paid to drill historical periodization, which is a much better deal than 11pm panic. Start at /learn/mastery and see plans at /pricing.",
      },
      {
        type: "callout",
        tone: "gold",
        title: "Studying for more than just APUSH?",
        text: "If you are stacking AP exams, AP Calc BC is the other big lift. Our AP Calc BC strategy guide at /blog/ap-calc-bc-easy-points-strategy covers the easy points most students leave on the table.",
      },

      { type: "h2", id: "test-day-tactics", text: "Test-day tactics" },
      {
        type: "ul",
        items: [
          "MCQ pace: 55 questions in 55 minutes. Set a soft timer. At question 28 you should be at 27 minutes. If you are behind, flag and move.",
          "Read the stimulus first when it is short (a quote, a political cartoon). Read the question first when the stimulus is long (a passage of 4+ sentences). Saves clock.",
          "On the DBQ, use the 15-minute reading period to (a) annotate every document for theme, POV, and purpose, and (b) write a 1-sentence thesis. Do not start writing the essay until the reading window ends.",
          "On the LEQ, pick the prompt where you can immediately name 3 specific pieces of evidence. Do not pick the period you find most interesting. Pick the one where you have ammunition.",
          "Save the last 5 minutes of each FRQ to add specifics. Names, dates, laws, court cases. Specificity is the difference between a 5 and a 6 on the rubric.",
        ],
      },

      { type: "h2", id: "faq", text: "FAQ" },

      { type: "h3", text: "What raw score do I need for a 5?" },
      {
        type: "p",
        text: "Historically, around 60% of raw points earns a 5. That is a lower bar than most AP exams because the curve is generous. You do not need to ace it. You need to be solid on MCQ and rubric-clean on the DBQ.",
      },

      { type: "h3", text: "Should I memorize every president and amendment?" },
      {
        type: "p",
        text: "No. Memorize the presidents who triggered policy shifts (Jackson, Lincoln, Wilson, FDR, LBJ, Nixon, Reagan) and the constitutional amendments that get tested directly (13th, 14th, 15th, 17th, 19th, 24th). The rest is bonus.",
      },

      { type: "h3", text: "What about the SAQs?" },
      {
        type: "p",
        text: "SAQs are pure point grabs. Each one has 3 sub-prompts (A, B, C). Answer each in 1 to 3 sentences. Be specific. The rubric does not care about style, only that you addressed the prompt accurately.",
      },

      { type: "h3", text: "Is one month enough?" },
      {
        type: "p",
        text: "If you have been in the class all year, absolutely. If you went into senioritis hibernation in February and tuned out, this plan still works but you will need to add an extra 30 minutes per day to the schedule.",
      },

      { type: "h2", id: "closing", text: "Closing" },
      {
        type: "p",
        text: "APUSH rewards pattern recognition more than memorization. The themes repeat. The rubric is mechanical. The MCQ stimulus types are predictable. If you walk in knowing the themes cold and having drilled 3 DBQs and 3 LEQs to rubric, the score takes care of itself.",
      },
      {
        type: "p",
        text: "Set up Mastery Mode with \"AP US History\" as your target. Drill 20 minutes a day for the next 30. Earn Fangs while you study. Show up ready.",
      },
    ],
  },

  {
    slug: "ap-calc-bc-easy-points-strategy",
    title: "AP Calculus BC: How to Pick Up Easy Points You're Probably Missing",
    description:
      "AP Calc BC is full of free points most students walk past. MCQ shortcuts, FRQ partial credit rules, calculator-active tricks, and time management that buys you 15 extra minutes.",
    category: "AP Exams",
    publishedAt: "2026-06-12",
    readingMinutes: 9,
    keywords: [
      "AP Calculus BC",
      "AP Calc BC tips",
      "AP Calc BC score 5",
      "AP exam strategy",
      "Calc BC FRQ tips",
      "AP Calc BC easy points",
      "AP Calculus BC study guide",
    ],
    body: [
      {
        type: "p",
        text: "Most students who score a 4 on AP Calc BC were three questions away from a 5. Not because they did not know the math. Because they left easy points on the table: wrong rounding, missed units, blank parts of FRQs, calculator-active questions done by hand. This post is about every one of those free points and how to actually collect them.",
      },
      {
        type: "p",
        text: "If you are in the panic-month before the exam, read this twice. The score lift from these tactics is bigger than any extra content review.",
      },

      { type: "h2", id: "the-exam", text: "What Calc BC actually scores" },
      {
        type: "p",
        text: "The exam is 3 hours 15 minutes split into two sections, each worth 50%.",
      },
      {
        type: "ul",
        items: [
          "Section 1A: 30 multiple choice, no calculator, 60 minutes.",
          "Section 1B: 15 multiple choice, calculator allowed, 45 minutes.",
          "Section 2A: 2 free-response, calculator allowed, 30 minutes.",
          "Section 2B: 4 free-response, no calculator, 60 minutes.",
        ],
      },
      {
        type: "p",
        text: "BC includes everything in AB (limits, derivatives, integrals, applications) plus parametric, polar, vectors, series, and improper integrals. Roughly 60% of BC is just AB. If your AB is shaky, fix that before anything else. If your AB is solid, the points sit in the BC-only topics and the FRQ partial credit you are leaving uncollected.",
      },
      {
        type: "callout",
        tone: "electric",
        title: "Curve reality",
        text: "Historically a raw score around 65 to 70% has been enough for a 5 on BC. You do not need perfection. You need clean execution and zero blank FRQ parts.",
      },

      { type: "h2", id: "easy-point-1", text: "Easy point 1: Never leave an FRQ part blank" },
      {
        type: "p",
        text: "The biggest score leak. Every FRQ has 3 to 4 parts. Most students get parts (a) and (b) cleanly, run out of time, and skip (c) and (d). The College Board rubric awards 1 point for setup even with no final answer.",
      },
      {
        type: "ol",
        items: [
          "If you cannot finish a part, write the integral or derivative you would have evaluated. That is 1 free point.",
          "If part (c) depends on part (b) and you got (b) wrong, write the (c) setup using your (b) answer anyway. Rubric awards \"consistent error\" credit. Do not blank it.",
          "If a part asks for justification, write one English sentence with the relevant theorem name. \"Because f is continuous on [a, b] and differentiable on (a, b), by the Mean Value Theorem...\" is worth a point even if your computation is wrong.",
        ],
      },

      { type: "h2", id: "easy-point-2", text: "Easy point 2: Units and labels" },
      {
        type: "p",
        text: "Calculator-active FRQs almost always involve a real-world quantity (water in a tank, velocity of a particle, population growth). The rubric quietly docks a point for missing units or mislabeled answers.",
      },
      {
        type: "ul",
        items: [
          "If the problem says \"gallons per minute\", your final answer needs \"gallons\" or \"gallons per minute\" written next to it. No exceptions.",
          "If the question asks for the time when velocity equals zero, write \"t = ... seconds\", not just the number.",
          "If the question asks for both a value and an interpretation, write the interpretation as a sentence. Half the partial credit is on the sentence.",
        ],
      },
      {
        type: "p",
        text: "Make a habit of underlining the units in the problem stem before you compute. The rubric pays attention to them. So should you.",
      },

      { type: "h2", id: "easy-point-3", text: "Easy point 3: Use the calculator on calculator-active questions" },
      {
        type: "p",
        text: "Sounds obvious. Most students still try to do calculator-active FRQs by hand because they are faster on paper for routine derivatives. The College Board explicitly allows four calculator operations:",
      },
      {
        type: "ol",
        items: [
          "Graph a function in a viewing window.",
          "Find the zero(s) of a function (the solver).",
          "Compute the numerical derivative at a point.",
          "Compute the numerical value of a definite integral.",
        ],
      },
      {
        type: "p",
        text: "If a problem asks for the area between two curves on [a, b], hit the numerical integral. Do not anti-differentiate by hand. Saves 4 to 6 minutes per FRQ. Use the saved time on the FRQ parts you actually had to think about.",
      },
      {
        type: "callout",
        tone: "electric",
        title: "Rounding rule",
        text: "On calculator-active FRQs, the College Board wants decimals truncated or rounded to 3 places. Two-decimal answers can lose a point. Three-decimal answers are always safe. Set your calculator to display 4 decimals so you can round confidently.",
      },

      { type: "h2", id: "easy-point-4", text: "Easy point 4: BC-only topics are worth disproportionate points" },
      {
        type: "p",
        text: "Series, parametric, polar, and vector questions show up on 1 to 2 FRQs and roughly 15% of MCQ. Most students underprep them and overprep what they already know. Flip that.",
      },
      {
        type: "ul",
        items: [
          "Series: master the convergence test menu cold. Geometric, p-series, integral test, ratio, root, alternating series, telescoping, direct comparison, limit comparison. Know which test fits which series at a glance.",
          "Taylor and Maclaurin: memorize the 4 standard series (e^x, sin x, cos x, 1/(1-x)). Most series FRQs are derivatives, integrals, or substitutions of those four.",
          "Parametric and polar: practice dy/dx formulas (parametric) and area formulas (polar) until you can write them blindfolded. They show up almost every year.",
          "Vector motion: the BC vector FRQ is the most rubric-mechanical question on the exam. Position, velocity, speed (the magnitude of velocity), and total distance (the integral of speed). Memorize the four formulas.",
        ],
      },

      { type: "h2", id: "easy-point-5", text: "Easy point 5: MCQ pacing wins games" },
      {
        type: "p",
        text: "Section 1A (no calc) is 30 questions in 60 minutes. Section 1B (calc) is 15 questions in 45 minutes. Most students burn time on a hard early question and panic at the end.",
      },
      {
        type: "ol",
        items: [
          "Do a fast first pass. Skip anything that takes more than 90 seconds on a first read. Bubble best guesses on bubble sheet to keep alignment, mark to return.",
          "Second pass for flagged questions. By this point your mind has often surfaced the technique.",
          "Last 5 minutes: bubble every blank. No negative marking. Random guess is +20% expected value vs blank.",
        ],
      },
      {
        type: "p",
        text: "Time control is the difference between leaving 5 questions blank and finishing strong. Practice with a timer before exam day, not on exam day.",
      },

      { type: "h2", id: "resources", text: "Resources worth your time" },
      {
        type: "ul",
        items: [
          "Khan Academy's AP Calc BC course. Free, structured to the College Board CED, and the practice problems are well-calibrated.",
          "Princeton Review's Cracking the AP Calculus BC Exam. Skip the long content sections. The practice tests at the back are the value.",
          "AP Classroom's progress checks. Built by the College Board and as close to the real exam as you can get. If your teacher assigned them, redo every miss.",
          "Released FRQs from the College Board archive. Free on the AP Central site. Do at least 10 of them before exam day, timed, with rubric scoring after.",
        ],
      },

      { type: "h2", id: "lionade", text: "Where Lionade fits in" },
      {
        type: "p",
        text: "Khan Academy is great for first exposure. Princeton Review is great for second exposure. Neither solves the retention problem when you learn Taylor series in February and need them in May.",
      },
      {
        type: "p",
        text: "Lionade's Mastery Mode handles the long-term recall. Paste in \"AP Calculus BC\" and the AI breaks it into the College Board units: limits, derivatives, integrals, applications, parametric/polar/vector, and infinite series. It quizzes you adaptively, prioritizing whatever topic you keep missing. The series convergence tests you struggled with in March keep coming back until they stop being a struggle.",
      },
      {
        type: "p",
        text: "Every right answer pays Fangs. Fangs cash out or buy items in the shop. Worth a try at /learn/mastery. Pricing is at /pricing.",
      },
      {
        type: "callout",
        tone: "gold",
        title: "Studying for multiple APs?",
        text: "If you are juggling APUSH and Calc BC, our AP US History last-month cram at /blog/ap-us-history-last-month-cram covers the time-allocation tradeoffs and FRQ strategy that translates between subjects.",
      },

      { type: "h2", id: "test-day-tactics", text: "Test-day tactics" },
      {
        type: "ul",
        items: [
          "Bring a backup calculator and fresh batteries. Calculator failure on Section 1B is a 15-question loss.",
          "Clear your calculator memory before the exam, even if your school has not asked you to. Some proctors check. Better safe.",
          "On no-calc Section 1A, simplify radicals and fractions. Examiners look for clean form on MCQ distractors. Half-simplified answers are usually wrong.",
          "On FRQ, always write the formula before you plug in numbers. Setup is half the points.",
          "Last 60 seconds of any FRQ: scan back, fill in any units you forgot, write the interpretation sentence if missing. This single habit saves 1 to 2 points per FRQ.",
        ],
      },

      { type: "h2", id: "faq", text: "FAQ" },

      { type: "h3", text: "Does BC really get an AB sub-score?" },
      {
        type: "p",
        text: "Yes. Your BC score report includes a separate AB sub-score derived from the AB-overlap questions. Useful if you needed AB credit and ended up scoring a 3 on BC but a 5 on the AB sub-score. Some colleges award AB credit on the sub-score alone.",
      },

      { type: "h3", text: "What raw percent do I need for a 5?" },
      {
        type: "p",
        text: "Around 65 to 70% historically. The exact cutoff shifts year to year because the curve is set after the exam. Aim for 75%+ on timed practice to give yourself margin.",
      },

      { type: "h3", text: "Calculator: TI-84 or TI-Nspire?" },
      {
        type: "p",
        text: "Both work. TI-Nspire CAS is banned. TI-84 has shorter button paths for the four College Board operations and is the more common choice. Use whichever you are faster on. Switching calculators in April is a bad idea.",
      },

      { type: "h3", text: "How important are series, really?" },
      {
        type: "p",
        text: "Very. Series alone is roughly 17 to 18% of the exam, including one full FRQ almost every year. If your series unit is weak, fix it before anything else. The points there are easier to acquire than re-mastering integration techniques.",
      },

      { type: "h2", id: "closing", text: "Closing" },
      {
        type: "p",
        text: "AP Calc BC is a points-collection game. The students who score a 5 are not the ones who solved every problem fastest. They are the ones who never blanked an FRQ part, never forgot units, used their calculator on calculator-active questions, and spent extra prep on the BC-only topics. Those habits are learnable in 4 weeks.",
      },
      {
        type: "p",
        text: "Set up Mastery Mode with \"AP Calculus BC\" as your target. Drill 25 minutes a day. Show up with the easy points already locked in.",
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
