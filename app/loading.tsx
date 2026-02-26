export default function Loading() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="relative w-12 h-12">
          <div
            className="absolute inset-0 rounded-full border-2 border-electric/20"
          />
          <div
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-electric animate-spin"
          />
        </div>
        <p className="font-bebas text-xl text-cream/40 tracking-wider">
          LOADING
        </p>
      </div>
    </div>
  );
}
