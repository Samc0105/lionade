import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: "#04080F",
          50: "#0a1020",
          100: "#060c18",
          200: "#04080F",
        },
        electric: {
          DEFAULT: "#4A90D9",
          light: "#6AABF0",
          dark: "#2D6BB5",
          glow: "#4A90D980",
        },
        cream: "#EEF4FF",
        gold: "#FFD700",
        "gold-dark": "#B8960C",
      },
      fontFamily: {
        bebas: ["var(--font-bebas)", "sans-serif"],
        syne: ["var(--font-syne)", "sans-serif"],
      },
      keyframes: {
        "coin-fly": {
          "0%": { transform: "translateY(0) scale(1)", opacity: "1" },
          "50%": { transform: "translateY(-60px) scale(1.3)", opacity: "1" },
          "100%": { transform: "translateY(-120px) scale(0.5)", opacity: "0" },
        },
        "pulse-glow": {
          "0%, 100%": { boxShadow: "0 0 10px #4A90D9, 0 0 20px #4A90D940" },
          "50%": { boxShadow: "0 0 25px #4A90D9, 0 0 50px #4A90D960" },
        },
        "streak-fire": {
          "0%, 100%": { transform: "scale(1) rotate(-3deg)" },
          "50%": { transform: "scale(1.15) rotate(3deg)" },
        },
        "slide-up": {
          "0%": { transform: "translateY(30px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        "slide-in-right": {
          "0%": { transform: "translateX(40px)", opacity: "0" },
          "100%": { transform: "translateX(0)", opacity: "1" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
        "xp-fill": {
          "0%": { width: "0%" },
          "100%": { width: "var(--xp-width)" },
        },
        "score-pop": {
          "0%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.4)" },
          "100%": { transform: "scale(1)" },
        },
        "countdown-tick": {
          "0%": { transform: "scale(1.1)", color: "#FFD700" },
          "100%": { transform: "scale(1)", color: "#EEF4FF" },
        },
      },
      animation: {
        "coin-fly": "coin-fly 0.8s ease-out forwards",
        "pulse-glow": "pulse-glow 2s ease-in-out infinite",
        "streak-fire": "streak-fire 1s ease-in-out infinite",
        "slide-up": "slide-up 0.5s ease-out forwards",
        "slide-in-right": "slide-in-right 0.5s ease-out forwards",
        shimmer: "shimmer 3s linear infinite",
        float: "float 3s ease-in-out infinite",
        "xp-fill": "xp-fill 1s ease-out forwards",
        "score-pop": "score-pop 0.3s ease-in-out",
        "countdown-tick": "countdown-tick 1s ease-out",
      },
      backgroundImage: {
        "grid-pattern":
          "linear-gradient(rgba(74,144,217,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(74,144,217,0.07) 1px, transparent 1px)",
        "hero-gradient":
          "radial-gradient(ellipse at center top, #0a1428 0%, #04080F 70%)",
        "card-gradient":
          "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
        "gold-gradient":
          "linear-gradient(135deg, #FFD700 0%, #B8960C 50%, #FFD700 100%)",
        "electric-gradient":
          "linear-gradient(135deg, #4A90D9 0%, #6AABF0 50%, #4A90D9 100%)",
      },
      backgroundSize: {
        "grid-size": "40px 40px",
      },
    },
  },
  plugins: [],
};

export default config;
