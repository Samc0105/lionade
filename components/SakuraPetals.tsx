"use client";

import { useMemo } from "react";

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

const PETAL_CHARS = ["❀", "✿", "❁", "🌸"];

export default function SakuraPetals() {
  const petals = useMemo(() => {
    const rand = seededRandom(77);
    return Array.from({ length: 14 }, (_, i) => ({
      id: i,
      char: PETAL_CHARS[Math.floor(rand() * PETAL_CHARS.length)],
      x: rand() * 100,
      size: 12 + rand() * 10,
      opacity: 0.3 + rand() * 0.3,
      duration: 16 + rand() * 12,
      delay: rand() * 20,
      drift: -30 + rand() * 60,
      rotate: rand() * 360,
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden sakura-container">
      {/* Warm ambient blobs */}
      <div
        className="absolute"
        style={{
          width: 500, height: 500, top: "10%", left: "70%",
          background: "radial-gradient(circle, rgba(251,191,36,0.06) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute"
        style={{
          width: 400, height: 400, top: "60%", left: "5%",
          background: "radial-gradient(circle, rgba(244,114,182,0.06) 0%, transparent 70%)",
        }}
      />

      {/* Falling petals */}
      {petals.map((p) => (
        <div
          key={p.id}
          className="absolute sakura-petal"
          style={{
            left: `${p.x}%`,
            top: "-5%",
            fontSize: p.size,
            opacity: p.opacity,
            animationDuration: `${p.duration}s`,
            animationDelay: `${p.delay}s`,
            ["--drift" as string]: `${p.drift}px`,
            ["--rotate" as string]: `${p.rotate}deg`,
          }}
        >
          {p.char}
        </div>
      ))}
    </div>
  );
}
