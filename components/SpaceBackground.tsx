"use client";

import { useMemo } from "react";

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

export default function SpaceBackground() {
  const stars = useMemo(() => {
    const rand = seededRandom(42);
    const sizes = [1, 1.5, 2];
    const colors = ["#fff", "#fff", "#fff", "#b4d2ff"];
    return Array.from({ length: 100 }, (_, i) => ({
      id: i,
      x: rand() * 100,
      y: rand() * 100,
      size: sizes[Math.floor(rand() * sizes.length)],
      opacity: 0.3 + rand() * 0.5,
      color: colors[Math.floor(rand() * colors.length)],
    }));
  }, []);

  const twinkleStars = useMemo(() => {
    const rand = seededRandom(99);
    return Array.from({ length: 4 }, (_, i) => ({
      id: i,
      x: 15 + rand() * 70,
      y: 10 + rand() * 80,
      size: 3 + rand(),
      opacity: 0.7 + rand() * 0.2,
      delay: i * 0.8,
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
      {/* Nebula blobs */}
      <div
        className="absolute"
        style={{
          width: 600, height: 600, top: "5%", left: "75%",
          background: "radial-gradient(circle, rgba(88,28,135,0.22) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute"
        style={{
          width: 500, height: 500, top: "65%", left: "0%",
          background: "radial-gradient(circle, rgba(30,58,138,0.20) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute"
        style={{
          width: 400, height: 400, top: "35%", left: "40%",
          background: "radial-gradient(circle, rgba(13,78,87,0.12) 0%, transparent 70%)",
        }}
      />
      <div
        className="absolute"
        style={{
          width: 450, height: 450, top: "15%", left: "10%",
          background: "radial-gradient(circle, rgba(160,30,80,0.15) 0%, transparent 70%)",
        }}
      />

      {/* Star dots */}
      {stars.map((s) => (
        <div
          key={s.id}
          className="absolute rounded-full"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            backgroundColor: s.color,
            opacity: s.opacity,
          }}
        />
      ))}

      {/* Bright twinkle stars */}
      {twinkleStars.map((s) => (
        <div
          key={`tw-${s.id}`}
          className="absolute rounded-full space-twinkle"
          style={{
            left: `${s.x}%`,
            top: `${s.y}%`,
            width: s.size,
            height: s.size,
            backgroundColor: "#fff",
            opacity: s.opacity,
            boxShadow: "0 0 4px rgba(255,255,255,0.6)",
            animationDelay: `${s.delay}s`,
          }}
        />
      ))}

      {/* Shooting stars */}
      <div className="shooting-star" />
      <div className="shooting-star-2" />

      {/* Distant sun glow */}
      <div
        className="absolute"
        style={{
          width: 800, height: 400, bottom: "-200px", left: "50%",
          transform: "translateX(-50%)",
          background: "radial-gradient(ellipse at center, rgba(255,180,50,0.06) 0%, transparent 70%)",
        }}
      />
    </div>
  );
}
