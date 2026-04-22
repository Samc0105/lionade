import StatCard from "./StatCard";
import { cdnUrl } from "@/lib/cdn";
import { Fire, Lightning, ChartBar } from "@phosphor-icons/react";

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
        icon={<img src={cdnUrl("/F.png")} alt="Fangs" className="w-6 h-6 object-contain" />}
        value={coins}
        label="Coins"
        insight={coinInsight}
        accentColor="#FFD700"
      />
      <StatCard
        icon={<Fire size={24} weight="regular" color="currentColor" aria-hidden="true" />}
        value={String(streak)}
        label="Streak"
        insight={streakInsight}
        accentColor="#F97316"
      />
      <StatCard
        icon={<Lightning size={24} weight="regular" color="currentColor" aria-hidden="true" />}
        value={`LVL ${level}`}
        label="Level"
        insight={levelInsight}
        accentColor="#4A90D9"
      />
      <StatCard
        icon={<ChartBar size={24} weight="regular" color="currentColor" aria-hidden="true" />}
        value={String(subjects)}
        label="Subjects"
        insight={subjectInsight}
        accentColor="#EEF4FF"
      />
    </div>
  );
}
