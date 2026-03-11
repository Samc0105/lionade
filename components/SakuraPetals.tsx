"use client";

import { useMemo } from "react";

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return s / 2147483647;
  };
}

/* ── Acacia Tree — flat-top silhouette with green canopy ── */

function AcaciaTree({ flip, variant = 1 }: { flip?: boolean; variant?: number }) {
  const style = { transform: flip ? "scaleX(-1)" : undefined };

  if (variant === 2) {
    return (
      <svg width="280" height="340" viewBox="0 0 280 340" style={style}>
        <defs>
          <linearGradient id="trunk2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5c3a1e" />
            <stop offset="100%" stopColor="#3a2010" />
          </linearGradient>
          <linearGradient id="canopy2" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d5016" />
            <stop offset="100%" stopColor="#1a3a0a" />
          </linearGradient>
        </defs>
        <path d="M125 340 Q120 330 118 318 L128 318 Q126 330 125 340" fill="url(#trunk2)" />
        <path d="M120 325 C118 290 117 260 119 230 C120 210 122 195 123 180" stroke="url(#trunk2)" strokeWidth="9" fill="none" strokeLinecap="round" />
        <path d="M122 232 C142 215 168 205 198 200" stroke="#5c3a1e" strokeWidth="4.5" fill="none" strokeLinecap="round" />
        <path d="M121 242 C100 225 76 218 54 216" stroke="#5c3a1e" strokeWidth="3.5" fill="none" strokeLinecap="round" />
        <path d={`M28 178 C34 162 58 148 85 140 C105 134 125 132 145 134
          C170 138 195 148 215 162 C228 172 225 184 212 190
          C195 198 172 202 148 203 C120 204 90 200 65 192
          C42 184 30 180 28 178 Z`} fill="url(#canopy2)" opacity="0.88" />
        <path d={`M50 172 C60 160 82 150 110 144 C135 140 158 142 178 150
          C195 158 200 168 190 175 C175 182 152 185 128 184
          C100 182 72 178 50 172 Z`} fill="#3a6b1a" opacity="0.35" />
        <path d="M180 196 C190 188 208 186 218 190 C225 194 220 202 208 206 C195 208 182 204 180 196 Z" fill="url(#canopy2)" opacity="0.7" />
      </svg>
    );
  }

  if (variant === 3) {
    return (
      <svg width="220" height="300" viewBox="0 0 220 300" style={style}>
        <defs>
          <linearGradient id="trunk3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#5c3a1e" />
            <stop offset="100%" stopColor="#3a2010" />
          </linearGradient>
          <linearGradient id="canopy3" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2d5016" />
            <stop offset="100%" stopColor="#1a3a0a" />
          </linearGradient>
        </defs>
        <path d="M103 300 Q100 290 99 278 L107 278 Q106 290 103 300" fill="url(#trunk3)" />
        <path d="M100 285 C99 255 101 228 103 200 C105 178 107 162 108 148" stroke="url(#trunk3)" strokeWidth="7" fill="none" strokeLinecap="round" />
        <path d="M106 212 C122 200 142 195 160 194" stroke="#5c3a1e" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d={`M25 142 C32 126 58 114 88 108 C108 104 128 106 148 112
          C168 120 182 132 185 144 C186 152 178 158 164 162
          C142 168 118 170 95 168 C68 164 42 156 30 148 C25 144 25 142 25 142 Z`} fill="url(#canopy3)" opacity="0.84" />
        <path d={`M48 138 C56 128 78 120 104 116 C126 114 146 118 160 128
          C168 136 162 144 148 148 C130 154 108 154 88 150 C65 146 48 140 48 138 Z`} fill="#3a6b1a" opacity="0.3" />
      </svg>
    );
  }

  return (
    <svg width="360" height="420" viewBox="0 0 360 420" style={style}>
      <defs>
        <linearGradient id="trunk1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6b4422" />
          <stop offset="100%" stopColor="#3a2010" />
        </linearGradient>
        <linearGradient id="canopy1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2d5016" />
          <stop offset="100%" stopColor="#1a3a0a" />
        </linearGradient>
      </defs>
      <path d="M165 420 Q158 408 155 395 L175 395 Q172 408 165 420" fill="url(#trunk1)" />
      <path d="M152 410 C144 402 138 398 130 396" stroke="#5c3a1e" strokeWidth="3" fill="none" opacity="0.5" strokeLinecap="round" />
      <path d="M178 410 C184 402 190 398 196 396" stroke="#5c3a1e" strokeWidth="2.5" fill="none" opacity="0.4" strokeLinecap="round" />
      <path d="M158 400 C154 358 150 318 150 280 C150 250 152 225 154 200 C156 178 158 162 160 148" stroke="url(#trunk1)" strokeWidth="13" fill="none" strokeLinecap="round" />
      <path d="M165 395 C163 360 162 325 162 290 C162 260 162 235 163 215" stroke="#4a2c12" strokeWidth="2" fill="none" opacity="0.2" strokeLinecap="round" />
      <path d="M155 272 C182 250 215 236 255 226 C280 220 302 218 320 216" stroke="#5c3a1e" strokeWidth="6.5" fill="none" strokeLinecap="round" />
      <path d="M153 282 C128 260 98 248 68 244 C48 240 30 240 16 242" stroke="#5c3a1e" strokeWidth="5.5" fill="none" strokeLinecap="round" />
      <path d="M157 222 C175 208 198 198 218 194" stroke="#5c3a1e" strokeWidth="4" fill="none" strokeLinecap="round" />
      <path d="M155 238 C138 222 118 215 98 212" stroke="#5c3a1e" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      <path d="M255 228 C265 220 275 216 288 214" stroke="#5c3a1e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d={`M12 156 C18 134 45 114 80 100 C108 90 138 86 165 84
        C198 82 230 88 258 98 C290 110 315 126 332 144
        C342 154 338 166 326 174 C310 184 288 192 262 196
        C232 202 200 204 170 204 C135 204 100 198 72 188
        C44 178 22 166 14 158 C12 156 12 156 12 156 Z`} fill="url(#canopy1)" opacity="0.9" />
      <path d={`M42 148 C54 132 82 118 118 110 C148 104 178 104 205 110
        C235 118 258 130 270 144 C278 154 270 162 252 168
        C228 176 198 180 168 178 C132 176 98 168 72 158 C50 150 42 148 42 148 Z`} fill="#3a6b1a" opacity="0.35" />
      <path d="M285 208 C296 198 318 194 330 200 C338 206 332 216 318 220 C302 224 288 218 285 208 Z" fill="url(#canopy1)" opacity="0.72" />
      <path d="M22 238 C14 230 10 222 18 216 C28 212 46 214 52 222 C56 228 48 236 35 238 Z" fill="url(#canopy1)" opacity="0.6" />
    </svg>
  );
}

/* ── Tumbleweed ── */

function Tumbleweed({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" opacity="0.55">
      <circle cx="20" cy="20" r="15" fill="none" stroke="#8B6914" strokeWidth="1" />
      <circle cx="20" cy="20" r="10" fill="none" stroke="#8B6914" strokeWidth="0.7" />
      <circle cx="20" cy="20" r="5" fill="none" stroke="#8B6914" strokeWidth="0.5" />
      <line x1="5" y1="14" x2="35" y2="26" stroke="#8B6914" strokeWidth="0.7" />
      <line x1="7" y1="28" x2="33" y2="12" stroke="#8B6914" strokeWidth="0.7" />
      <line x1="12" y1="5" x2="28" y2="35" stroke="#8B6914" strokeWidth="0.6" />
      <line x1="14" y1="35" x2="26" y2="5" stroke="#8B6914" strokeWidth="0.6" />
      <line x1="4" y1="20" x2="36" y2="20" stroke="#8B6914" strokeWidth="0.5" />
      <line x1="20" y1="4" x2="20" y2="36" stroke="#8B6914" strokeWidth="0.5" />
      <path d="M8 10 Q15 16 22 10 Q29 16 36 12" fill="none" stroke="#8B6914" strokeWidth="0.5" />
      <path d="M4 24 Q12 30 20 24 Q28 30 36 26" fill="none" stroke="#8B6914" strokeWidth="0.5" />
      <path d="M10 6 Q16 14 10 20 Q16 26 12 34" fill="none" stroke="#8B6914" strokeWidth="0.4" />
      <path d="M30 6 Q24 14 30 20 Q24 26 28 34" fill="none" stroke="#8B6914" strokeWidth="0.4" />
    </svg>
  );
}

/* ── Green grass — individual blades in 3 depth layers ── */

function GrassLayer({ layer }: { layer: 1 | 2 | 3 }) {
  const config = {
    1: { color: "#6b8f3a", tip: "#8aad4e", opacity: 0.35, height: 65, bottom: 8, bladeH: 38 },
    2: { color: "#4a7a22", tip: "#6b9e38", opacity: 0.5, height: 55, bottom: 3, bladeH: 32 },
    3: { color: "#3a6818", tip: "#5a8e2a", opacity: 0.7, height: 45, bottom: 0, bladeH: 26 },
  }[layer];

  const rand = seededRandom(layer * 137);
  const blades: Array<{ d: string; color: string }> = [];
  const count = 200;
  for (let i = 0; i < count; i++) {
    const x = (i / count) * 1440 + (rand() - 0.5) * 10;
    const h = config.bladeH * (0.4 + rand() * 0.8);
    const lean = (rand() - 0.5) * 14;
    const cp = lean * 0.7;
    const color = rand() > 0.6 ? config.tip : config.color;
    blades.push({ d: `M${x} 80 Q${x + cp} ${80 - h * 0.6} ${x + lean} ${80 - h}`, color });
  }

  return (
    <svg
      className={`savanna-grass savanna-grass-${layer}`}
      viewBox="0 0 1440 80"
      preserveAspectRatio="none"
      style={{
        position: "fixed",
        bottom: config.bottom,
        left: 0,
        width: "100%",
        height: config.height,
        zIndex: layer,
        pointerEvents: "none",
        opacity: config.opacity,
      }}
    >
      <rect x="0" y="70" width="1440" height="10" fill={config.color} opacity="0.5" />
      {blades.map((b, i) => (
        <path key={i} d={b.d} stroke={b.color} strokeWidth={layer === 3 ? 2 : layer === 2 ? 1.5 : 1.2} fill="none" strokeLinecap="round" />
      ))}
    </svg>
  );
}

/* ── Distant birds ── */

function DistantBirds() {
  return (
    <div className="savanna-birds" style={{ position: "fixed", top: "12%", left: "18%", zIndex: 0, pointerEvents: "none", opacity: 0.2 }}>
      <svg width="160" height="50" viewBox="0 0 160 50">
        <path d="M10 25 Q16 16 22 25 Q28 16 34 25" stroke="#4a2c14" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d="M50 18 Q55 11 60 18 Q65 11 70 18" stroke="#4a2c14" strokeWidth="1.2" fill="none" strokeLinecap="round" />
        <path d="M90 28 Q94 22 98 28 Q102 22 106 28" stroke="#4a2c14" strokeWidth="1" fill="none" strokeLinecap="round" />
        <path d="M120 14 Q123 9 126 14 Q129 9 132 14" stroke="#4a2c14" strokeWidth="0.8" fill="none" strokeLinecap="round" />
        <path d="M65 35 Q69 29 73 35 Q77 29 81 35" stroke="#4a2c14" strokeWidth="0.9" fill="none" strokeLinecap="round" />
        <path d="M140 22 Q143 18 146 22 Q149 18 152 22" stroke="#4a2c14" strokeWidth="0.7" fill="none" strokeLinecap="round" />
      </svg>
    </div>
  );
}

/* ── Main component ── */

export default function SakuraPetals() {
  const tumbleweeds = useMemo(() => {
    const rand = seededRandom(42);
    return Array.from({ length: 3 }, (_, i) => ({
      id: i,
      size: 20 + rand() * 14,
      duration: 26 + rand() * 18,
      delay: rand() * 18,
      y: 82 + rand() * 8,
      direction: i % 2 === 0 ? "ltr" : "rtl",
    }));
  }, []);

  const dustParticles = useMemo(() => {
    const rand = seededRandom(99);
    return Array.from({ length: 24 }, (_, i) => ({
      id: i,
      x: rand() * 100,
      size: 1.5 + rand() * 2.5,
      opacity: 0.06 + rand() * 0.16,
      duration: 14 + rand() * 18,
      delay: rand() * 22,
      color: rand() > 0.6 ? "#C49A3C" : rand() > 0.3 ? "#B08830" : "#A07828",
      drift: -30 + rand() * 60,
    }));
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden sakura-container">
      {/* Sun — bright golden disc */}
      <div className="savanna-sun" style={{
        position: "fixed", top: "12%", right: "12%", zIndex: 0,
        width: 90, height: 90, borderRadius: "50%",
        background: "radial-gradient(circle, #FFF176 0%, #FFD54F 30%, #FFB300 60%, rgba(255,143,0,0.6) 80%, transparent 100%)",
        boxShadow: "0 0 60px 30px rgba(255,183,0,0.4), 0 0 120px 60px rgba(255,143,0,0.2), 0 0 200px 100px rgba(255,111,0,0.1)",
      }} />

      {/* Floating wavy rays — disconnected from the sun, each wave independently */}
      {Array.from({ length: 14 }, (_, i) => {
        const angle = (i / 14) * 360;
        const rad = (angle * Math.PI) / 180;
        // Gap from sun center — rays start ~65px out, extend to ~140px
        const innerR = 65;
        const outerR = 120 + (i % 3) * 25;
        const x1 = Math.cos(rad) * innerR;
        const y1 = Math.sin(rad) * innerR;
        const x2 = Math.cos(rad) * outerR;
        const y2 = Math.sin(rad) * outerR;
        // Perpendicular offset for the wave curve control point
        const perpX = -Math.sin(rad) * (8 + (i % 4) * 3);
        const perpY = Math.cos(rad) * (8 + (i % 4) * 3);
        const midX = (x1 + x2) / 2 + perpX;
        const midY = (y1 + y2) / 2 + perpY;

        return (
          <div
            key={`ray-${i}`}
            className={`sun-ray sun-ray-${(i % 4) + 1}`}
            style={{
              position: "fixed",
              top: "calc(12% + 45px)",
              right: "calc(12% + 45px)",
              width: 0, height: 0, zIndex: 0,
            }}
          >
            <svg
              width="300" height="300" viewBox="-150 -150 300 300"
              style={{ position: "absolute", top: -150, left: -150, overflow: "visible" }}
            >
              <path
                d={`M${x1} ${y1} Q${midX} ${midY} ${x2} ${y2}`}
                stroke="#FFB300"
                strokeWidth={i % 2 === 0 ? "2.5" : "1.8"}
                fill="none"
                strokeLinecap="round"
                opacity={0.3 + (i % 3) * 0.1}
              />
            </svg>
          </div>
        );
      })}

      {/* Warm light wash from the sun */}
      <div style={{
        position: "fixed", top: 0, right: 0, width: "60%", height: "50%", zIndex: -1,
        background: "radial-gradient(ellipse at 80% 15%, rgba(255,183,0,0.12) 0%, transparent 60%)",
      }} />

      {/* Distant birds */}
      <DistantBirds />

      {/* Acacia trees */}
      <div className="acacia-tree acacia-tree-left">
        <AcaciaTree variant={1} />
      </div>
      <div className="acacia-tree acacia-tree-right">
        <AcaciaTree flip variant={2} />
      </div>
      <div className="acacia-tree acacia-tree-center">
        <AcaciaTree variant={3} />
      </div>

      {/* Green grass layers */}
      <GrassLayer layer={1} />
      <GrassLayer layer={2} />
      <GrassLayer layer={3} />

      {/* Tumbleweeds */}
      {tumbleweeds.map((t) => (
        <div
          key={t.id}
          className={`absolute tumbleweed tumbleweed-${t.direction}`}
          style={{
            top: `${t.y}%`,
            animationDuration: `${t.duration}s`,
            animationDelay: `${t.delay}s`,
          }}
        >
          <Tumbleweed size={t.size} />
        </div>
      ))}

      {/* Dust motes */}
      {dustParticles.map((d) => (
        <div
          key={d.id}
          className="absolute dust-particle"
          style={{
            left: `${d.x}%`,
            bottom: "10%",
            width: d.size,
            height: d.size,
            borderRadius: "50%",
            backgroundColor: d.color,
            opacity: d.opacity,
            animationDuration: `${d.duration}s`,
            animationDelay: `${d.delay}s`,
            ["--dust-drift" as string]: `${d.drift}px`,
          }}
        />
      ))}
    </div>
  );
}
