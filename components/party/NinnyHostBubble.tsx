"use client";

// Ninny-as-game-host text bubble. Pops in between phases, fades out after a
// few seconds. Pure UI — the parent owns when to show it.

import { motion, AnimatePresence, useReducedMotion } from "framer-motion";
import { cdnUrl } from "@/lib/cdn";

interface Props {
  message: string | null;
  align?: "left" | "right";
}

export default function NinnyHostBubble({ message, align = "left" }: Props) {
  const reduced = useReducedMotion();
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          key={message}
          initial={reduced ? false : { opacity: 0, y: 8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
          transition={{ duration: 0.22, ease: "easeOut" }}
          className={`flex items-center gap-3 max-w-md ${align === "right" ? "flex-row-reverse self-end" : "self-start"}`}
        >
          <div
            className="relative w-10 h-10 rounded-full flex-shrink-0 overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #A855F7 0%, #6366F1 100%)",
              border: "1px solid rgba(168,85,247,0.6)",
              boxShadow: "0 0 18px rgba(168,85,247,0.3)",
            }}
          >
            <img
              src={cdnUrl("/ninny.png")}
              alt="Ninny"
              className="w-full h-full object-cover"
              onError={(e) => {
                // Fallback if the avatar isn't bundled.
                (e.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          </div>
          <div
            className="relative px-4 py-2.5 rounded-2xl text-sm font-syne text-cream/90"
            style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.18) 0%, rgba(99,102,241,0.1) 100%)",
              border: "1px solid rgba(168,85,247,0.35)",
              boxShadow: "0 4px 18px rgba(0,0,0,0.25)",
            }}
          >
            {message}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
