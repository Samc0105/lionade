export type FaqCategory =
  | "Getting Started"
  | "Fangs"
  | "Games"
  | "Mastery"
  | "Account"
  | "Pricing"
  | "Privacy"
  | "Contact";

export type Faq = {
  id: string;
  category: FaqCategory;
  question: string;
  answer: string;
};

export const CATEGORIES: FaqCategory[] = [
  "Getting Started",
  "Fangs",
  "Games",
  "Mastery",
  "Account",
  "Pricing",
  "Privacy",
  "Contact",
];

export const FAQS: Faq[] = [
  // Getting Started
  {
    id: "what-is-lionade",
    category: "Getting Started",
    question: "What is Lionade?",
    answer:
      "Lionade is a study-rewards app that pays you to learn. Every focused minute earns Fangs, our in-app currency. Stack enough Fangs and you can cash out, unlock power-ups, or burn them on streak rescues. Around the studying we run games, head-to-head competitions, and a Mastery Mode that teaches and quizzes you on any topic you name.",
  },
  {
    id: "how-to-sign-up",
    category: "Getting Started",
    question: "How do I sign up?",
    answer:
      "Head to getlionade.com and tap Sign Up. You can register with email and password or use Google. We do not require a credit card. The first Fangs hit your wallet as soon as you start your first focus session, so you can try the whole loop in under five minutes.",
  },
  {
    id: "is-lionade-free",
    category: "Getting Started",
    question: "Is Lionade free?",
    answer:
      "Yes. The core loop is free forever. You can earn Fangs, play most games, run limited Mastery sessions, and join the leaderboard without paying. Pro is optional and unlocks unlimited Mastery, faster Fang multipliers, and a few cosmetic flexes. Free users still cash out real money.",
  },
  {
    id: "why-lionade-not-lemonade",
    category: "Getting Started",
    question: "Why Lionade and not Lemonade?",
    answer:
      "Our mascot is a lion. Lemonade was already taken by an insurance company. Autocorrect fights us daily and we have made peace with it. The shorter version: studying is a grind that should refresh you, not drain you. Lemonade with a lion in it. Lionade.",
  },
  {
    id: "do-i-need-an-account",
    category: "Getting Started",
    question: "Do I need an account to try it?",
    answer:
      "You can browse the demo at getlionade.com/demo without an account. To earn Fangs, climb the leaderboard, or play multiplayer games, you need a free account. We do not sell your data and we do not spam your inbox.",
  },

  // Fangs
  {
    id: "what-are-fangs",
    category: "Fangs",
    question: "What are Fangs?",
    answer:
      "Fangs are the Lionade currency. You earn them by studying, finishing quizzes, winning games, hitting daily targets, and keeping streaks alive. You spend them on power-ups, streak rescues, cosmetic upgrades, and eventually cash payouts. Think of them as a paycheck for focused effort.",
  },
  {
    id: "how-to-earn-fangs",
    category: "Fangs",
    question: "How do I earn Fangs?",
    answer:
      "Focused study sessions, daily claim rewards, streak milestones, quiz wins, game victories, Mastery Mode runs, leaderboard placements, and weekly challenges. Pro users earn at an accelerated multiplier. There is no way to buy Fangs with cash. You earn what you stack.",
  },
  {
    id: "fangs-real-money",
    category: "Fangs",
    question: "Can Fangs be redeemed for real money?",
    answer:
      "Cash payouts are live for early cohorts now and the full V2 cashout system rolls out broadly in December 2026. The minimum payout will be $5 worth of Fangs and we pay through standard payment rails. Gift card redemptions and in-app power-ups are available today.",
  },
  {
    id: "fangs-expire",
    category: "Fangs",
    question: "Do Fangs expire?",
    answer:
      "No. Fangs do not expire. You can stack them for as long as you want. The only caveat is that if your account is deleted, the balance is forfeited, so cash out before you go if you have a balance worth keeping.",
  },
  {
    id: "why-fangs",
    category: "Fangs",
    question: "Why call them Fangs?",
    answer:
      "Coins felt like a video game. Points felt like a loyalty program. Tokens felt like a crypto scam. Fangs fit the lion. They bite, they bank, they belong to you. Once you have stacked a few thousand you will agree.",
  },

  // Games
  {
    id: "what-games-can-i-play",
    category: "Games",
    question: "What games can I play?",
    answer:
      "Sketchy Subjects (academic Pictionary), Bluff Trivia (fool your friends with fake answers), PokerFace (read your opponent), Pardy (Jeopardy style boards), Roardle (daily word game), Flashcards arena, Timeline (order historical events), and Compete Arena (head-to-head quiz duels). New modes ship most weeks.",
  },
  {
    id: "play-with-friends",
    category: "Games",
    question: "Can I play with friends?",
    answer:
      "Yes. Open a game from the Games hub, create a Party room, and share the invite link or short code. Friends join from any browser. No app install required for web play. Most modes support up to eight players per room.",
  },
  {
    id: "create-party-room",
    category: "Games",
    question: "How do I create a Party room?",
    answer:
      "From the Games page, pick Sketchy Subjects or Bluff Trivia, hit Create Room, and you will get a six character code and a share link. Send either to friends and they land directly in your lobby. You can lock the room when everyone has joined.",
  },
  {
    id: "solo-vs-multiplayer",
    category: "Games",
    question: "What is the difference between solo and multiplayer?",
    answer:
      "Solo modes are timed quizzes, drills, and Mastery sessions you run on your own. They are ideal for grinding Fangs and building streaks. Multiplayer modes pit you against friends or random opponents in real time and pay larger Fang prizes per win. Both count toward leaderboards.",
  },
  {
    id: "rejoin-game",
    category: "Games",
    question: "What happens if I disconnect during a game?",
    answer:
      "We hold your seat for sixty seconds and try to auto reconnect. If you make it back, you keep your score and the round continues. If you drop out for good, the game finishes with whatever points you had banked. Compete duels are forgiving on first disconnect and stricter on repeats.",
  },

  // Mastery
  {
    id: "what-is-mastery",
    category: "Mastery",
    question: "What is Mastery Mode?",
    answer:
      "Mastery Mode is a chat first study experience. You name a topic, Ninny our study coach teaches the concept in plain language, then quizzes you with adaptive questions. A slow fill progress bar climbs toward 100 percent as you demonstrate understanding. It is the fastest way we have found to learn something new and prove you actually know it.",
  },
  {
    id: "mastery-which-exams",
    category: "Mastery",
    question: "Which exams does Mastery support?",
    answer:
      "AWS Security Specialty is our launch pilot with a curated curriculum. You can also point Mastery at any custom topic you describe, from AP Biology cell respiration to the rules of competitive Scrabble. More exam-specific tracks (SAT, MCAT, CFA, AP suite) are rolling out through 2026.",
  },
  {
    id: "mastery-progress-bar",
    category: "Mastery",
    question: "How is the Mastery progress bar calculated?",
    answer:
      "Each correct answer on a non trivial question advances the bar. Easy questions give small bumps, harder ones give larger bumps, and wrong answers pause progress while we re-teach the underlying concept. The bar reaches 100 percent when you have demonstrated reliable accuracy across the full topic surface, not just the easy slice.",
  },
  {
    id: "mastery-free",
    category: "Mastery",
    question: "Is Mastery Mode free?",
    answer:
      "Free accounts get a limited number of Mastery sessions per week, which is plenty to try the experience and finish smaller topics. Pro unlocks unlimited sessions, longer custom curriculums, and saved progress across topics. Every session pays Fangs either way.",
  },

  // Account
  {
    id: "change-username",
    category: "Account",
    question: "How do I change my username?",
    answer:
      "Open Settings from your avatar menu and edit the Username field. Usernames must be three to twenty characters, letters numbers and underscores only. Changes are instant and reflected on the leaderboard within a minute. You can change it as often as you want.",
  },
  {
    id: "delete-account",
    category: "Account",
    question: "How do I delete my account?",
    answer:
      "Settings, Account, Delete Account. We delete your profile, stats, and personal data within thirty days. Cash out any Fangs you care about first because the balance is forfeited on deletion. If you change your mind in the first seven days, contact support and we can usually restore it.",
  },
  {
    id: "change-email",
    category: "Account",
    question: "Can I change my email?",
    answer:
      "Yes. Settings, Account, Email. We send a confirmation link to the new address and a notice to the old one for security. Until you confirm, the old email stays active. Google sign in users can also add a password and switch to email login if they prefer.",
  },
  {
    id: "share-data",
    category: "Account",
    question: "Does Lionade share my data?",
    answer:
      "No. We do not sell or rent user data to advertisers or brokers. We share the minimum necessary with payment processors and infrastructure providers (Stripe, Supabase, Vercel) so the product can function. Full details live in our Privacy policy linked in the footer.",
  },

  // Pricing
  {
    id: "how-much-pro",
    category: "Pricing",
    question: "How much is Pro?",
    answer:
      "Pro is $6.99 per month or $69.99 per year. Annual saves you about two months. Both plans unlock unlimited Mastery, accelerated Fang multipliers, premium cosmetics, and priority support. We run student discounts and seasonal promos a few times a year.",
  },
  {
    id: "free-vs-pro",
    category: "Pricing",
    question: "What is the difference between Free and Pro?",
    answer:
      "Free includes the full study tracker, Fang earning loop, leaderboards, daily games, and limited Mastery sessions. Pro adds unlimited Mastery, a Fang earning multiplier, cosmetic flexes (avatars, banners, badges), and priority email support. Cash payouts work on both tiers.",
  },
  {
    id: "cancel-anytime",
    category: "Pricing",
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancel from Settings, Billing, Manage Subscription. We open the Stripe customer portal where you can cancel with one click. You keep Pro features through the end of the current billing period and then drop back to Free. No retention friction, no phone calls.",
  },
  {
    id: "refund-policy",
    category: "Pricing",
    question: "What is the refund policy?",
    answer:
      "We offer a no questions asked refund within seven days of a new Pro subscription if you have not used premium features heavily. Annual plans get a prorated refund if you cancel in the first thirty days. Email support@getlionade.com and we will sort it out within two business days.",
  },

  // Privacy
  {
    id: "study-data-private",
    category: "Privacy",
    question: "Is my study data private?",
    answer:
      "Yes. Your sessions, topics, and chat history with Ninny are private to your account. We use aggregate, anonymized stats to improve the product, but individual study content is never shared with other users or sold. The leaderboard only shows public profile fields you opt into.",
  },
  {
    id: "export-data",
    category: "Privacy",
    question: "Can I export my data?",
    answer:
      "Yes. Email support@getlionade.com from the address on your account and we will generate a JSON export of your study sessions, Fang ledger, and profile within fourteen days. Self serve export from Settings is on the roadmap for late 2026.",
  },
  {
    id: "gdpr-ferpa",
    category: "Privacy",
    question: "Are you GDPR and FERPA compliant?",
    answer:
      "We follow GDPR principles for all users (right to access, correct, delete) regardless of region. For school deployments we operate under FERPA compatible terms and sign DPAs on request. COPPA applies to users under thirteen, which is why we require sixteen plus for individual signups. Schools can enroll younger students under their own compliance umbrella.",
  },

  // Contact
  {
    id: "report-a-bug",
    category: "Contact",
    question: "How do I report a bug?",
    answer:
      "Use the Contact page or email support@getlionade.com with a short description, what you expected, and any screenshots. Mention your browser and whether it happens every time or once in a while. We triage bugs within one business day and ship fixes weekly.",
  },
  {
    id: "partnership-inquiries",
    category: "Contact",
    question: "Partnership inquiries?",
    answer:
      "We love working with schools, creator partners, and study brands. Email partnerships@getlionade.com with a one paragraph pitch and we will route you to the right person on the business team. We respond to qualified inbound within five business days.",
  },
  {
    id: "support-response-time",
    category: "Contact",
    question: "What is your support response time?",
    answer:
      "Email support typically responds within one business day. Pro members get priority and we aim for the same day. We are a small team that cares about every ticket. If you have not heard back in three business days, reply to your original email and it gets escalated.",
  },
  {
    id: "press-inquiries",
    category: "Contact",
    question: "Press or media inquiries?",
    answer:
      "Email press@getlionade.com with your outlet, deadline, and angle. We will get back within two business days. Founders are open to interviews about student finance, gamified learning, and the broken economics of studying for free.",
  },
];
