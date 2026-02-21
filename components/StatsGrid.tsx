import StatCard from "./StatCard";

interface StatsGridProps {
  coins: string;
  coinInsight: string;
  streak: number;
  streakInsight: string;
  level: number;
  levelInsight: string;
  subjects: number;
  subjectInsight: string;
}

export default function StatsGrid({
  coins, coinInsight,
  streak, streakInsight,
  level, levelInsight,
  subjects, subjectInsight,
}: StatsGridProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        icon="&#x1FA99;"
        value={coins}
        label="Coins"
        insight={coinInsight}
        accentColor="#FFD700"
      />
      <StatCard
        icon="&#x1F525;"
        value={String(streak)}
        label="Streak"
        insight={streakInsight}
        accentColor="#F97316"
      />
      <StatCard
        icon="&#x26A1;"
        value={`LVL ${level}`}
        label="Level"
        insight={levelInsight}
        accentColor="#4A90D9"
      />
      <StatCard
        icon="&#x1F4CA;"
        value={String(subjects)}
        label="Subjects"
        insight={subjectInsight}
        accentColor="#EEF4FF"
      />
    </div>
  );
}
