"use client";

import { useEffect, useState } from "react";

interface Coin {
  id: number;
  x: number;
  emoji: string;
}

interface CoinAnimationProps {
  trigger: boolean;
  amount?: number;
  onComplete?: () => void;
}

export default function CoinAnimation({ trigger, amount = 3, onComplete }: CoinAnimationProps) {
  const [coins, setCoins] = useState<Coin[]>([]);
  const [showAmount, setShowAmount] = useState(false);

  useEffect(() => {
    if (!trigger) return;

    const newCoins: Coin[] = Array.from({ length: Math.min(amount, 8) }, (_, i) => ({
      id: Date.now() + i,
      x: Math.random() * 120 - 60,
      emoji: "🪙",
    }));

    setCoins(newCoins);
    setShowAmount(true);

    const timer = setTimeout(() => {
      setCoins([]);
      setShowAmount(false);
      onComplete?.();
    }, 900);

    return () => clearTimeout(timer);
  }, [trigger, amount, onComplete]);

  if (coins.length === 0 && !showAmount) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
      {/* Coin particles */}
      {coins.map((coin, i) => (
        <div
          key={coin.id}
          className="coin-particle"
          style={{
            left: `calc(50% + ${coin.x}px)`,
            bottom: "30%",
            animationDelay: `${i * 0.05}s`,
            animationDuration: `${0.7 + Math.random() * 0.3}s`,
          }}
        >
          {coin.emoji}
        </div>
      ))}

      {/* Amount pop */}
      {showAmount && (
        <div
          className="absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2
            font-bebas text-4xl text-gold glow-gold animate-slide-up"
          style={{ textShadow: "0 0 20px #FFD700" }}
        >
          +{amount}
        </div>
      )}
    </div>
  );
}
