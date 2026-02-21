interface StatCardProps {
  icon: string;
  value: string;
  label: string;
  insight: string;
  accentColor: string;
}

export default function StatCard({ icon, value, label, insight, accentColor }: StatCardProps) {
  return (
    <div
      className="rounded-xl border p-5 flex flex-col items-center text-center
        transition-all duration-200 hover:brightness-110 hover:scale-[1.02]"
      style={{
        background: "linear-gradient(135deg, #0a1020 0%, #060c18 100%)",
        borderColor: `${accentColor}25`,
      }}
    >
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center mb-2"
        style={{ background: `${accentColor}15`, border: `1px solid ${accentColor}30` }}
      >
        <span className="text-xl">{icon}</span>
      </div>
      <p className="font-bebas text-3xl leading-none" style={{ color: accentColor }}>
        {value}
      </p>
      <p className="text-cream/50 text-[10px] font-semibold uppercase tracking-widest mt-1">
        {label}
      </p>
      <p className="text-cream/30 text-[10px] mt-1.5">{insight}</p>
    </div>
  );
}
