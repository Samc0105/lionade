import Link from "next/link";

const STATS = [
  { value: "50K+", label: "Active Learners" },
  { value: "2.4M", label: "Coins Earned" },
  { value: "98%", label: "Would Recommend" },
  { value: "4.9★", label: "Rating" },
];

const STEPS = [
  {
    icon: "🕐",
    title: "Clock In Daily",
    desc: "Log in every day and start your session. Consistency builds your streak and multiplies your earnings.",
  },
  {
    icon: "⚡",
    title: "Answer & Compete",
    desc: "Take daily quizzes, challenge users to 1v1 duels, and jump into The Blitz for rapid fire trivia. Every correct answer earns you coins.",
  },
  {
    icon: "🏆",
    title: "Earn Rewards",
    desc: "Stack coins, climb the leaderboard, hit loyalty milestones, and unlock real rewards. The harder you grind, the more you earn.",
  },
];

const FEATURES = [
  {
    icon: "🧠",
    title: "Daily Quizzes",
    desc: "AI-generated questions across every subject. New content every single day so you never repeat the same quiz.",
  },
  {
    icon: "⚡",
    title: "The Blitz",
    desc: "20 questions, 8 seconds each. Pure skill, no AI, no Googling. The fastest mind wins the daily prize pool.",
  },
  {
    icon: "⚔️",
    title: "1v1 Duels",
    desc: "Challenge any user to a head to head quiz battle. Wager coins, winner takes all. Talk is cheap, your score isn't.",
  },
  {
    icon: "🏆",
    title: "Leaderboard",
    desc: "Global rankings updated in real time. Top earners every week get featured and rewarded. Your name belongs at the top.",
  },
  {
    icon: "🔥",
    title: "Streak Culture",
    desc: "Miss a day and lose your streak. Keep grinding and watch your multiplier grow. 100 days straight earns you real cash.",
  },
  {
    icon: "📚",
    title: "The Library",
    desc: "Upload your old exams and notes. Get paid micro-payments for accepted content. Your study materials finally work for you.",
  },
];

const SUBJECTS = [
  { icon: "📐", name: "Mathematics" },
  { icon: "🔬", name: "Science" },
  { icon: "🌍", name: "Languages" },
  { icon: "📝", name: "SAT / ACT / GRE" },
  { icon: "💻", name: "Coding & CS" },
  { icon: "💰", name: "Finance" },
  { icon: "🏆", name: "Certifications" },
  { icon: "📖", name: "History & Social Studies" },
];

const ABOUT_STATS = [
  { icon: "🦁", label: "Founded 2026" },
  { icon: "🎓", label: "Built by students" },
  { icon: "💰", label: "Real rewards" },
  { icon: "🌍", label: "For everyone" },
];

const TESTIMONIALS = [
  {
    username: "zayded_out",
    level: "Level 12",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=zayed&backgroundColor=4A90D9",
    text: "I've been using Lionade every day for 3 weeks and I already feel the difference in my grades. The streak system keeps me accountable like nothing else has.",
  },
  {
    username: "nova_grind",
    level: "Level 9",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=nova&backgroundColor=6AABF0",
    text: "The Blitz is insanely addictive. I've been in the top 3 twice this week. It actually makes me want to study more just so I can compete.",
  },
  {
    username: "mathking99",
    level: "Level 7",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=mathking&backgroundColor=FFD700",
    text: "I uploaded my old calculus exams and got paid for them. That was the moment I realized this app is actually different from everything else out there.",
  },
  {
    username: "streakqueen",
    level: "Level 11",
    avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=streakqueen&backgroundColor=E74C3C",
    text: "My streak is at 47 days. I've never stuck with anything this long. The coins and leaderboard make it feel like a game not a chore.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-navy overflow-x-hidden">

      {/* ── HERO ───────────────────────────────────────────── */}
      <section
        className="relative min-h-screen flex flex-col items-center justify-center px-4 pt-24 pb-20 text-center"
        style={{ background: "radial-gradient(ellipse at center top, #0a1428 0%, #04080F 65%)" }}
      >
        {/* Grid overlay */}
        <div className="absolute inset-0 opacity-25 pointer-events-none" style={{
          backgroundImage: "linear-gradient(rgba(74,144,217,0.1) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
        {/* Glow orbs */}
        <div className="absolute top-1/4 left-1/4 w-72 h-72 rounded-full blur-3xl opacity-20 pointer-events-none"
          style={{ background: "radial-gradient(circle, #4A90D9 0%, transparent 70%)" }} />
        <div className="absolute bottom-1/3 right-1/4 w-96 h-96 rounded-full blur-3xl opacity-15 pointer-events-none"
          style={{ background: "radial-gradient(circle, #F0B429 0%, transparent 70%)" }} />

        <div className="relative z-10 flex flex-col items-center">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 bg-electric/10 border border-electric/40 rounded-full px-5 py-2 mb-8 text-sm font-semibold text-electric animate-slide-up">
            <span className="w-2 h-2 rounded-full bg-electric animate-pulse" />
            The Gen Z Study Platform
          </div>

          {/* Headline */}
          <h1 className="font-bebas text-[clamp(3.5rem,11vw,9.5rem)] leading-[0.9] tracking-wider text-cream mb-6 animate-slide-up"
            style={{ animationDelay: "0.1s" }}>
            STUDY LIKE<br />
            <span className="shimmer-text">IT&apos;S YOUR JOB</span>
          </h1>

          {/* Subheading */}
          <p className="max-w-2xl text-cream/60 text-lg sm:text-xl font-medium leading-relaxed mb-10 animate-slide-up"
            style={{ animationDelay: "0.2s" }}>
            Earn coins for every correct answer. Duel your friends. Climb the leaderboard.{" "}
            Make studying the most competitive thing you do today.
          </p>

          {/* CTAs */}
          <div className="flex flex-col sm:flex-row items-center gap-4 mb-16 animate-slide-up"
            style={{ animationDelay: "0.3s" }}>
            <Link href="/login">
              <button className="btn-gold text-lg px-10 py-4 rounded-xl font-bold">
                🚀 Start Earning Now
              </button>
            </Link>
            <a href="#how-it-works">
              <button className="btn-outline text-base px-8 py-4 rounded-xl">
                See How It Works
              </button>
            </a>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 max-w-2xl w-full animate-slide-up"
            style={{ animationDelay: "0.4s" }}>
            {STATS.map((s) => (
              <div key={s.label} className="card text-center py-4 px-2">
                <p className="font-bebas text-3xl text-electric leading-none">{s.value}</p>
                <p className="text-cream/50 text-xs font-semibold mt-1">{s.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ───────────────────────────────────── */}
      <section
        id="how-it-works"
        className="py-24 px-4 border-t border-electric/10 relative"
        style={{ background: "linear-gradient(180deg, #04080F 0%, #060d1a 50%, #04080F 100%)" }}
      >
        <div className="max-w-5xl mx-auto text-center">
          <p className="text-electric text-sm font-bold uppercase tracking-widest mb-3">Simple Process</p>
          <h2 className="font-bebas text-5xl sm:text-7xl text-cream tracking-wider mb-4">
            How It Works
          </h2>
          <p className="text-cream/50 text-lg mb-16 max-w-xl mx-auto">
            Three steps between you and your first coin
          </p>

          <div className="grid sm:grid-cols-3 gap-8 lg:gap-12">
            {STEPS.map((step, i) => (
              <div key={step.title} className="flex flex-col items-center group">
                <div className="font-bebas text-8xl leading-none mb-4"
                  style={{ color: `rgba(74,144,217,${0.1 + i * 0.05})` }}>
                  0{i + 1}
                </div>
                <div className="w-20 h-20 rounded-2xl flex items-center justify-center text-4xl mb-5 border border-electric/20 group-hover:border-electric/50 transition-colors duration-300"
                  style={{ background: "rgba(74,144,217,0.08)" }}>
                  {step.icon}
                </div>
                <h3 className="font-bebas text-2xl text-cream tracking-wider mb-3">{step.title}</h3>
                <p className="text-cream/50 text-sm leading-relaxed max-w-xs">{step.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FEATURES ───────────────────────────────────────── */}
      <section id="features" className="py-24 px-4 border-t border-electric/10">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-gold text-sm font-bold uppercase tracking-widest mb-3">What We Offer</p>
            <h2 className="font-bebas text-5xl sm:text-7xl text-cream tracking-wider mb-4">
              Everything You Need to Grind
            </h2>
            <p className="text-cream/50 text-lg max-w-xl mx-auto">
              Built for students who take their growth seriously
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="group p-6 rounded-2xl border border-electric/10 hover:border-electric/30 transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                style={{
                  background: "linear-gradient(135deg, rgba(74,144,217,0.05) 0%, #060c18 100%)",
                  animationDelay: `${i * 80}ms`,
                }}
              >
                <div className="text-4xl mb-4 group-hover:scale-110 transition-transform duration-300 inline-block">
                  {f.icon}
                </div>
                <h3 className="font-bebas text-2xl text-cream tracking-wider mb-2">{f.title}</h3>
                <p className="text-cream/50 text-sm leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SUBJECTS ───────────────────────────────────────── */}
      <section
        className="py-24 px-4 border-t border-electric/10"
        style={{ background: "linear-gradient(180deg, #04080F 0%, #070e1f 50%, #04080F 100%)" }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-electric text-sm font-bold uppercase tracking-widest mb-3">Coverage</p>
            <h2 className="font-bebas text-5xl sm:text-7xl text-cream tracking-wider mb-4">
              Every Subject. One Platform.
            </h2>
            <p className="text-cream/50 text-lg max-w-2xl mx-auto">
              Whether you&apos;re prepping for an exam or leveling up your career, we have you covered
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {SUBJECTS.map((s, i) => (
              <Link href="/login" key={s.name}>
                <div
                  className="flex flex-col items-center gap-3 p-6 rounded-2xl border border-electric/15 hover:border-gold/40 hover:bg-gold/5 transition-all duration-300 hover:-translate-y-1 cursor-pointer text-center group"
                  style={{ animationDelay: `${i * 60}ms` }}
                >
                  <span className="text-4xl group-hover:scale-110 transition-transform duration-300">{s.icon}</span>
                  <span className="font-bold text-sm text-cream/80 group-hover:text-cream transition-colors leading-tight">{s.name}</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* ── ABOUT ──────────────────────────────────────────── */}
      <section id="about" className="py-24 px-4 border-t border-electric/10">
        <div className="max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="text-gold text-sm font-bold uppercase tracking-widest mb-3">Our Story</p>
              <h2 className="font-bebas text-5xl sm:text-6xl text-cream tracking-wider mb-6">
                Why We Built This
              </h2>
              <div className="space-y-4 text-cream/60 text-base leading-relaxed">
                <p>
                  Every day, millions of students put in hours of real work — studying, grinding, pushing themselves — and get nothing back except a grade. We thought that was wrong.
                </p>
                <p>
                  Lionade was born from a simple idea: your study time has value, and you deserve to be rewarded for it. We built the platform we wished existed when we were staying up until 3am before exams.
                </p>
                <p>
                  No corporate edtech. No boring flashcards. Just a real platform that treats studying like the grind it actually is — and pays you accordingly.
                </p>
                <p className="text-cream/90 font-semibold">
                  Study like it&apos;s your job. Because now it is.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {ABOUT_STATS.map((s) => (
                <div key={s.label}
                  className="p-6 rounded-2xl border border-electric/15 text-center"
                  style={{ background: "rgba(74,144,217,0.05)" }}>
                  <div className="text-4xl mb-3">{s.icon}</div>
                  <p className="font-bold text-cream text-sm">{s.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── SOCIAL PROOF ───────────────────────────────────── */}
      <section
        className="py-24 px-4 border-t border-electric/10"
        style={{ background: "linear-gradient(180deg, #04080F 0%, #060d1a 50%, #04080F 100%)" }}
      >
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-16">
            <p className="text-electric text-sm font-bold uppercase tracking-widest mb-3">Testimonials</p>
            <h2 className="font-bebas text-5xl sm:text-7xl text-cream tracking-wider mb-4">
              The Grind is Real
            </h2>
            <p className="text-cream/50 text-lg max-w-xl mx-auto">
              Join thousands already earning while they learn
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {TESTIMONIALS.map((t) => (
              <div key={t.username}
                className="p-6 rounded-2xl border border-electric/10 hover:border-electric/25 transition-all duration-300 flex flex-col gap-4"
                style={{ background: "linear-gradient(135deg, rgba(74,144,217,0.04) 0%, #060c18 100%)" }}>
                <p className="text-cream/70 text-sm leading-relaxed flex-1">
                  &ldquo;{t.text}&rdquo;
                </p>
                <div className="flex items-center gap-3 pt-3 border-t border-electric/10">
                  <div className="w-9 h-9 rounded-full overflow-hidden border-2 border-electric/30 flex-shrink-0">
                    <img src={t.avatar} alt={t.username} className="w-full h-full object-cover bg-navy-50" />
                  </div>
                  <div>
                    <p className="font-bold text-electric text-xs">@{t.username}</p>
                    <p className="text-cream/40 text-xs">{t.level}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FINAL CTA ──────────────────────────────────────── */}
      <section
        className="py-32 px-4 text-center border-t border-electric/10 relative overflow-hidden"
        style={{ background: "radial-gradient(ellipse at center, #0a1428 0%, #04080F 70%)" }}
      >
        <div className="absolute inset-0 opacity-20 pointer-events-none" style={{
          backgroundImage: "linear-gradient(rgba(74,144,217,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.12) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }} />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[300px] rounded-full blur-3xl opacity-10 pointer-events-none"
          style={{ background: "radial-gradient(ellipse, #F0B429 0%, transparent 70%)" }} />

        <div className="relative z-10">
          <h2 className="font-bebas text-6xl sm:text-8xl text-cream tracking-wider mb-6">
            Ready to Get Paid<br />
            <span className="shimmer-text">to Study?</span>
          </h2>
          <p className="text-cream/50 text-lg mb-10 max-w-xl mx-auto">
            Join thousands of students already earning coins, climbing leaderboards, and actually enjoying their study sessions.
          </p>
          <Link href="/login">
            <button className="btn-gold text-xl px-12 py-5 rounded-2xl font-bold shadow-2xl shadow-gold/25 hover:shadow-gold/40 transition-shadow duration-300">
              Create Your Free Account
            </button>
          </Link>
          <p className="text-cream/25 text-sm mt-5">
            Free forever. No credit card required. Start earning in 60 seconds.
          </p>
        </div>
      </section>

      {/* ── FOOTER ─────────────────────────────────────────── */}
      <footer className="border-t border-electric/10 py-12 px-4">
        <div className="max-w-6xl mx-auto">
          {/* Top row */}
          <div className="flex flex-col md:flex-row items-center justify-between gap-8 mb-8">
            {/* Brand */}
            <div className="flex flex-col items-center md:items-start gap-1">
              <div className="flex items-center gap-2">
                <span className="text-2xl">🦁</span>
                <span className="font-bebas text-2xl tracking-wider text-cream">LIONADE</span>
              </div>
              <p className="text-cream/40 text-xs">Study Like It&apos;s Your Job</p>
            </div>

            {/* Nav links */}
            <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
              {[
                { href: "#how-it-works", label: "How It Works" },
                { href: "#features", label: "Features" },
                { href: "#about", label: "About" },
                { href: "/login", label: "Log In" },
                { href: "/login", label: "Sign Up" },
              ].map((link) => (
                <a key={link.label} href={link.href}
                  className="text-cream/40 text-sm hover:text-cream/80 transition-colors">
                  {link.label}
                </a>
              ))}
            </div>

            {/* Social icons */}
            <div className="flex items-center gap-4">
              <a href="https://instagram.com/getlionade" target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-xl border border-electric/20 flex items-center justify-center text-cream/50 hover:text-cream hover:border-electric/50 transition-all duration-200 text-lg">
                📸
              </a>
              <a href="https://tiktok.com/@getlionade" target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-xl border border-electric/20 flex items-center justify-center text-cream/50 hover:text-cream hover:border-electric/50 transition-all duration-200 text-lg">
                🎵
              </a>
              <a href="https://x.com/getlionade" target="_blank" rel="noopener noreferrer"
                className="w-9 h-9 rounded-xl border border-electric/20 flex items-center justify-center text-cream/50 hover:text-cream hover:border-electric/50 transition-all duration-200 font-bold text-sm">
                𝕏
              </a>
            </div>
          </div>

          {/* Bottom row */}
          <div className="border-t border-electric/10 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2">
            <p className="text-cream/25 text-xs">© 2026 Lionade. All rights reserved.</p>
            <p className="text-electric/40 text-xs font-semibold tracking-widest uppercase">Built for the grind.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
