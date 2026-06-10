"use client";

// Past Lobbies tab inside /social. Three sections:
//   Active now — rooms you're still in (tap to re-enter)
//   Saved — placeholder, deferred until party_saved_rooms ships
//   Recent — rooms you've left or that ended, last 14 days
//
// Pulls /api/party/history once on mount + revalidates whenever the tab gets
// re-focused. No realtime here; this is a "where did I just leave?" surface.

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { useRouter } from "next/navigation";
import useSWR from "swr";
import { apiGet } from "@/lib/api-client";
import { GameController, PaintBrush, ChatCircleText, Eye, ArrowRight, Clock, ArrowsClockwise } from "@phosphor-icons/react";
import { toastError } from "@/lib/toast";

interface HistoryRow {
  room_id: string;
  room_code: string;
  display_name: string | null;
  game_type: string | null;
  status: "lobby" | "playing" | "ended";
  members_count: number;
  last_activity_at: string;
  joined_at: string;
  left_at: string | null;
  is_dismissed: boolean;
}

interface HistoryResponse {
  active: HistoryRow[];
  recent: HistoryRow[];
  saved: HistoryRow[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GAME_ICON: Record<string, any> = {
  sketch: PaintBrush,
  bluff: ChatCircleText,
  pokerface: Eye,
};

const GAME_ACCENT: Record<string, string> = {
  sketch: "#A855F7",
  bluff: "#FFD700",
  pokerface: "#00BFFF",
};

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function statusLabel(row: HistoryRow): { text: string; color: string } {
  if (row.is_dismissed) return { text: "Closed", color: "rgba(255,255,255,0.35)" };
  if (row.status === "ended") return { text: "Ended", color: "rgba(255,255,255,0.35)" };
  if (row.status === "playing") return { text: "Live", color: "#34D399" };
  return { text: "Lobby", color: "#7DD3FC" };
}

interface Props {
  router: ReturnType<typeof useRouter>;
}

export default function PastLobbiesPanel({ router }: Props) {
  const [hydrated, setHydrated] = useState(false);

  const { data, error, isLoading, mutate } = useSWR<HistoryResponse>(
    "/api/party/history",
    async (url: string) => {
      const res = await apiGet<HistoryResponse>(url);
      if (!res.ok || !res.data) throw new Error(res.error ?? "history fetch failed");
      return res.data;
    },
    { revalidateOnFocus: true, dedupingInterval: 10_000 },
  );

  useEffect(() => {
    if (data || error) setHydrated(true);
  }, [data, error]);

  function handleRowTap(row: HistoryRow) {
    if (row.is_dismissed || row.status === "ended") {
      toastError("That room is closed.");
      return;
    }
    router.push(`/games/party/${row.room_code}`);
  }

  if (!hydrated && isLoading) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="rounded-xl px-4 py-3 animate-pulse"
            style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)", height: 56 }}
          />
        ))}
      </div>
    );
  }

  // Fetch error with no cached data: an error state, never the cheery empty
  // state. A user with a live room must not be told it doesn't exist.
  if (error && !data) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="rounded-2xl border border-red-400/30 bg-red-400/5 p-6 text-center">
          <p className="font-syne text-sm text-red-300 mb-3">
            Couldn't load your lobbies. Your rooms are still there, this list isn't.
          </p>
          <button
            type="button"
            onClick={() => mutate()}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-white/15 bg-white/5 text-cream/80 hover:bg-white/10 hover:text-cream font-syne text-xs font-bold transition-colors"
          >
            <ArrowsClockwise size={12} weight="bold" aria-hidden="true" />
            Try again
          </button>
        </div>
      </div>
    );
  }

  const active = data?.active ?? [];
  const saved = data?.saved ?? [];
  const recent = data?.recent ?? [];
  const empty = active.length === 0 && saved.length === 0 && recent.length === 0;

  return (
    <div className="flex-1 overflow-y-auto">
      {empty ? (
        <div className="px-4 py-12 text-center flex flex-col items-center gap-3">
          <div
            className="w-12 h-12 rounded-full grid place-items-center"
            style={{
              background: "linear-gradient(135deg, rgba(168,85,247,0.16) 0%, rgba(99,102,241,0.06) 100%)",
              border: "1px solid rgba(168,85,247,0.28)",
            }}
          >
            <GameController size={22} weight="fill" className="text-purple-300/80" aria-hidden="true" />
          </div>
          <p className="text-cream/70 text-sm font-semibold">No party lobbies yet</p>
          <p className="text-cream/40 text-xs max-w-[200px]">
            Create or join a Party room and it lands here so you can hop back in.
          </p>
          <button
            type="button"
            onClick={() => router.push("/games/party")}
            className="mt-2 px-3 py-1.5 rounded-lg text-[11px] font-bold uppercase tracking-wider"
            style={{ background: "rgba(168,85,247,0.18)", color: "#E9D5FF", border: "1px solid rgba(168,85,247,0.4)" }}
          >
            Open Party
          </button>
        </div>
      ) : (
        <>
          <Section title={`Active now${active.length > 0 ? ` · ${active.length}` : ""}`}>
            {active.length === 0 ? (
              <EmptyMicro text="No rooms open right now." />
            ) : (
              active.map((row) => <RoomRow key={row.room_id} row={row} onTap={handleRowTap} />)
            )}
          </Section>

          <Section title="Saved">
            {saved.length === 0 ? (
              <EmptyMicro text="Save a room to pin it here. Coming soon." />
            ) : (
              saved.map((row) => <RoomRow key={row.room_id} row={row} onTap={handleRowTap} />)
            )}
          </Section>

          <Section title="Recent">
            {recent.length === 0 ? (
              <EmptyMicro text="Played rooms from the last 14 days show here." />
            ) : (
              recent.map((row) => <RoomRow key={row.room_id} row={row} onTap={handleRowTap} />)
            )}
          </Section>
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-white/[0.05]">
      <p className="text-cream/55 text-[10px] font-bold uppercase tracking-widest px-4 pt-4 pb-2">
        {title}
      </p>
      <div className="px-2 pb-3 space-y-1.5">{children}</div>
    </div>
  );
}

function EmptyMicro({ text }: { text: string }) {
  return <p className="text-cream/30 text-xs px-3 py-2 italic">{text}</p>;
}

function RoomRow({ row, onTap }: { row: HistoryRow; onTap: (row: HistoryRow) => void }) {
  const Icon = ((row.game_type && GAME_ICON[row.game_type]) ?? GameController) as React.ComponentType<{
    size?: number;
    weight?: "fill" | "regular" | "bold";
    className?: string;
    "aria-hidden"?: boolean | "true" | "false";
  }>;
  const accent = (row.game_type && GAME_ACCENT[row.game_type]) ?? "rgba(255,255,255,0.45)";
  const status = statusLabel(row);
  const disabled = row.is_dismissed || row.status === "ended";
  const title = row.display_name?.trim() || `Room ${row.room_code}`;

  return (
    <motion.button
      whileHover={disabled ? undefined : { x: 2 }}
      onClick={() => onTap(row)}
      className="w-full text-left flex items-center gap-3 px-3 py-2.5 rounded-xl transition-colors hover:bg-white/[0.04]"
      style={{
        background: "rgba(255,255,255,0.02)",
        border: "1px solid rgba(255,255,255,0.05)",
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <span
        className="flex-shrink-0 w-9 h-9 rounded-lg grid place-items-center"
        style={{
          background: `linear-gradient(135deg, ${accent}22 0%, ${accent}08 100%)`,
          border: `1px solid ${accent}40`,
        }}
      >
        <Icon size={16} weight="fill" aria-hidden={true} />
      </span>
      <div className="flex-1 min-w-0">
        <p className="text-cream text-sm font-semibold truncate">{title}</p>
        <p className="text-cream/40 text-[10px] flex items-center gap-1.5">
          <span style={{ color: status.color }}>{status.text}</span>
          <span className="text-cream/20">·</span>
          <Clock size={10} weight="regular" aria-hidden="true" />
          {timeAgo(row.last_activity_at || row.joined_at)}
          {row.members_count > 0 && (
            <>
              <span className="text-cream/20">·</span>
              <span>{row.members_count} {row.members_count === 1 ? "player" : "players"}</span>
            </>
          )}
        </p>
      </div>
      {!disabled && <ArrowRight size={14} weight="bold" className="text-cream/30 flex-shrink-0" aria-hidden="true" />}
    </motion.button>
  );
}
