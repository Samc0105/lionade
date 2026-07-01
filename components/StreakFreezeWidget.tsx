"use client";

import { useState } from "react";
import useSWR from "swr";
import { Snowflake } from "@phosphor-icons/react";
import { apiPost, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { mutateUserStats } from "@/lib/hooks";
import { cdnUrl } from "@/lib/cdn";
import { toastSuccess, toastError, toastInfo } from "@/lib/toast";

/**
 * Streak Freeze widget — buy streak insurance with Fangs.
 *
 * A banked freeze auto-protects the daily streak when the user misses a day
 * (consumed server-side in /api/streak/expire). This widget shows how many
 * freezes are banked out of the cap and lets the user buy more with Fangs.
 *
 * Fails soft: if the feature is dormant (migration not applied), the status
 * route returns available:false and this renders nothing.
 */

interface FreezeStatus {
  available: boolean;
  count: number;
  cap: number;
  price: number;
  coins: number;
}

export default function StreakFreezeWidget() {
  const { user } = useAuth();
  const { data, mutate } = useSWR<FreezeStatus>(
    user?.id ? "/api/streak/freeze" : null,
    swrFetcher,
    { revalidateOnFocus: true, dedupingInterval: 10_000 },
  );
  const [buying, setBuying] = useState(false);

  if (!user?.id) return null;
  if (!data) return null;
  if (!data.available) return null;

  const { count, cap, price, coins } = data;
  const atCap = count >= cap;
  const canAfford = coins >= price;

  const buy = async () => {
    if (buying) return;
    if (atCap) {
      toastInfo(`You already have the max of ${cap} freezes.`);
      return;
    }
    if (!canAfford) {
      toastInfo(`Need ${price.toLocaleString()} Fangs (you have ${coins.toLocaleString()}).`);
      return;
    }
    setBuying(true);
    try {
      type R = { ok: boolean; count?: number; coins?: number; message?: string };
      const r = await apiPost<R>("/api/streak/freeze", {});
      if (!r.ok || !r.data?.ok) {
        toastError(r.data?.message || "Couldn't buy a freeze. Try again.");
        return;
      }
      toastSuccess(
        `Streak Freeze banked. You have ${r.data.count ?? count + 1} of ${cap}.`,
        { duration: 3500 },
      );
      void mutate();
      mutateUserStats(user.id);
    } catch (e) {
      console.error("[streak:freeze] buy threw", e);
      toastError("Couldn't buy a freeze. Try again.");
    } finally {
      setBuying(false);
    }
  };

  return (
    <div
      className="mb-8 animate-slide-up rounded-2xl border border-white/[0.08] p-4 sm:p-5"
      style={{
        background:
          "linear-gradient(135deg, rgba(56,189,248,0.10), rgba(129,140,248,0.06))",
      }}
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 44,
              height: 44,
              background: "rgba(56,189,248,0.12)",
              border: "1px solid rgba(56,189,248,0.25)",
            }}
          >
            <Snowflake size={24} weight="fill" color="#38BDF8" aria-hidden="true" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-syne font-semibold text-cream text-[15px]">
                Streak Freeze
              </span>
              <span
                className="font-mono text-[11px] px-2 py-0.5 rounded-full tabular-nums"
                style={{
                  background: "rgba(56,189,248,0.12)",
                  border: "1px solid rgba(56,189,248,0.22)",
                  color: "#7DD3FC",
                }}
              >
                {count} / {cap}
              </span>
            </div>
            <p className="text-cream/55 text-[12px] mt-0.5 leading-snug max-w-sm">
              Miss a day and a freeze keeps your streak alive automatically. No panic, no revive.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={buy}
          disabled={buying || atCap || !canAfford}
          className={`
            group flex items-center justify-center gap-2 rounded-[10px]
            px-4 py-2.5 font-syne font-semibold text-[13px] whitespace-nowrap
            transition-all duration-200 active:scale-[0.98]
            ${
              atCap
                ? "bg-white/[0.05] border border-white/[0.1] text-cream/50 cursor-not-allowed"
                : canAfford
                  ? "bg-[#38BDF8] text-navy hover:bg-[#38BDF8]/90 shadow-md shadow-sky-400/20"
                  : "bg-white/[0.04] border border-white/[0.1] text-cream/60 cursor-not-allowed"
            }
            disabled:cursor-not-allowed disabled:opacity-60
          `}
        >
          {atCap ? (
            <span>Maxed out</span>
          ) : (
            <>
              <img
                src={cdnUrl("/F.png")}
                alt=""
                aria-hidden="true"
                className="w-4 h-4 object-contain"
              />
              <span>
                {buying ? "Buying…" : `Buy · ${price.toLocaleString()}`}
              </span>
            </>
          )}
        </button>
      </div>

      {!atCap && !canAfford && (
        <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-cream/50 mt-3">
          Short on Fangs · earn more by studying
        </p>
      )}
    </div>
  );
}
