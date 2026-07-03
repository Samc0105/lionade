"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Fire, HandFist, X as XIcon, CaretDown, CaretUp } from "@phosphor-icons/react";
import { apiPost, apiDelete, swrFetcher } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { avatarFor } from "@/lib/avatar";
import Avatar from "@/components/Avatar";
import { toastError, toastSuccess } from "@/lib/toast";

/**
 * Streak Pacts section for /social — invite friends into duo accountability
 * streaks, answer pending invites, and manage active pacts.
 *
 * Upside-only mechanic: a pact only ever ADDS a shared count on days you both
 * study. Ending one loses nothing except that shared count.
 *
 * Fails soft: while the HELD streak_pacts migration is unapplied the API
 * reports available:false and this renders nothing.
 */

const PACT_ACCENT = "#FF9F45";

interface FriendLite {
  id: string;
  username: string;
  avatar_url: string | null;
}

interface PactPartner {
  id: string;
  username: string;
  avatar_url: string | null;
}

interface PactsResponse {
  available: boolean;
  maxActive: number;
  activeCount?: number;
  pacts: {
    id: string;
    partner: PactPartner;
    currentStreak: number;
    bestStreak: number;
  }[];
  incoming: { id: string; partner: PactPartner }[];
  outgoing: { id: string; partner: PactPartner }[];
}

export default function PactsSection({ friends }: { friends: FriendLite[] }) {
  const { user } = useAuth();
  const { data, mutate } = useSWR<PactsResponse>(
    user?.id ? "/api/pacts" : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState<string | null>(null);

  // Friends not already tied to me by any live pact row.
  const eligibleFriends = useMemo(() => {
    if (!data?.available) return [];
    const taken = new Set<string>([
      ...data.pacts.map((p) => p.partner.id),
      ...data.incoming.map((p) => p.partner.id),
      ...data.outgoing.map((p) => p.partner.id),
    ]);
    return friends.filter((f) => !taken.has(f.id));
  }, [data, friends]);

  if (!user?.id || !data || !data.available) return null;

  const atCap = (data.activeCount ?? data.pacts.length) >= data.maxActive;

  const run = async (key: string, fn: () => Promise<{ ok: boolean; msg: string }>) => {
    if (busy) return;
    setBusy(key);
    try {
      const r = await fn();
      if (r.ok) toastSuccess(r.msg);
      else toastError(r.msg);
      void mutate();
    } catch (e) {
      console.error("[pacts] action threw", e);
      toastError("Something went wrong. Try again.");
    } finally {
      setBusy(null);
    }
  };

  const invite = (friend: FriendLite) =>
    run(`invite-${friend.id}`, async () => {
      const r = await apiPost<{ success?: boolean; error?: string }>("/api/pacts", { friendId: friend.id });
      return r.ok && r.data?.success
        ? { ok: true, msg: `Pact invite sent to ${friend.username}` }
        : { ok: false, msg: r.data?.error || "Couldn't send the invite." };
    });

  const accept = (id: string, name: string) =>
    run(`accept-${id}`, async () => {
      const r = await apiPost<{ success?: boolean; error?: string }>(`/api/pacts/${id}/accept`, {});
      return r.ok && r.data?.success
        ? { ok: true, msg: `Pact with ${name} is live. Your shared streak starts today.` }
        : { ok: false, msg: r.data?.error || "Couldn't accept the invite." };
    });

  const decline = (id: string) =>
    run(`decline-${id}`, async () => {
      const r = await apiPost<{ success?: boolean; error?: string }>(`/api/pacts/${id}/decline`, {});
      return r.ok && r.data?.success
        ? { ok: true, msg: "Invite declined." }
        : { ok: false, msg: r.data?.error || "Couldn't decline the invite." };
    });

  const endPact = (id: string) =>
    run(`end-${id}`, async () => {
      const r = await apiDelete<{ success?: boolean; error?: string }>(`/api/pacts/${id}`);
      setConfirmEnd(null);
      return r.ok && r.data?.success
        ? { ok: true, msg: "Pact ended. Nothing lost but the shared count." }
        : { ok: false, msg: r.data?.error || "Couldn't end the pact." };
    });

  const hasAnything =
    data.pacts.length > 0 || data.incoming.length > 0 || data.outgoing.length > 0;

  return (
    <div className="px-4 py-3 border-b border-white/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <p className="text-cream/60 text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1.5">
          <HandFist size={12} weight="duotone" color={PACT_ACCENT} aria-hidden="true" />
          Streak Pacts ({data.pacts.length}/{data.maxActive})
        </p>
        <button
          type="button"
          onClick={() => setShowPicker((v) => !v)}
          disabled={atCap && !showPicker}
          aria-expanded={showPicker}
          className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ color: PACT_ACCENT, background: "rgba(255,159,69,0.10)" }}
        >
          {showPicker ? "Close" : atCap ? "Pact limit reached" : "New pact"}
          {showPicker
            ? <CaretUp size={10} weight="bold" aria-hidden="true" />
            : <CaretDown size={10} weight="bold" aria-hidden="true" />}
        </button>
      </div>

      {!hasAnything && !showPicker && (
        <p className="text-cream/45 text-[11px] leading-snug">
          Team up with a friend. Days you both study grow a shared flame, and
          milestones pay Fangs to both of you. Breaking a pact loses nothing but
          the shared count.
        </p>
      )}

      {/* Invite picker */}
      {showPicker && (
        <div className="mb-2 rounded-lg p-2" style={{ background: "rgba(255,255,255,0.03)" }}>
          {atCap ? (
            <p className="text-cream/50 text-[11px] px-1 py-1">
              You already run {data.maxActive} pacts. End one to start another.
            </p>
          ) : eligibleFriends.length === 0 ? (
            <p className="text-cream/50 text-[11px] px-1 py-1">
              {friends.length === 0
                ? "Add a friend first, then start a pact together."
                : "Every friend already has a pact or an invite with you."}
            </p>
          ) : (
            <div className="max-h-44 overflow-y-auto space-y-1">
              {eligibleFriends.map((f) => (
                <div key={f.id} className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-white/[0.04]">
                  <Avatar url={avatarFor(f.username, f.avatar_url)} alt={f.username} size="sm" />
                  <span className="flex-1 min-w-0 text-cream text-xs font-semibold truncate">{f.username}</span>
                  <button
                    type="button"
                    onClick={() => invite(f)}
                    disabled={busy !== null}
                    aria-label={`Invite ${f.username} to a streak pact`}
                    className="text-[10px] font-bold px-2 py-1 rounded transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 disabled:opacity-60"
                    style={{ color: "#04080F", background: PACT_ACCENT }}
                  >
                    {busy === `invite-${f.id}` ? "Sending" : "Invite"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Incoming invites */}
      {data.incoming.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center gap-3 p-2 rounded-lg mb-1"
          aria-label={`Pact invite from ${inv.partner.username}`}
          style={{ background: "rgba(255,159,69,0.06)", border: "1px solid rgba(255,159,69,0.18)" }}
        >
          <Avatar url={avatarFor(inv.partner.username, inv.partner.avatar_url)} alt={inv.partner.username} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-cream text-xs font-semibold truncate">{inv.partner.username}</p>
            <p className="text-cream/50 text-[10px]">wants a streak pact with you</p>
          </div>
          <button
            type="button"
            onClick={() => accept(inv.id, inv.partner.username)}
            disabled={busy !== null}
            aria-label={`Accept pact invite from ${inv.partner.username}`}
            className="text-green-400 text-[10px] font-bold px-2 py-1 rounded bg-green-400/10 hover:bg-green-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-400/60 transition disabled:opacity-60"
          >
            {busy === `accept-${inv.id}` ? "Starting" : "Accept"}
          </button>
          <button
            type="button"
            onClick={() => decline(inv.id)}
            disabled={busy !== null}
            aria-label={`Decline pact invite from ${inv.partner.username}`}
            className="text-cream/55 w-7 h-7 grid place-items-center rounded hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition disabled:opacity-60"
          >
            <XIcon size={12} weight="bold" aria-hidden="true" />
          </button>
        </div>
      ))}

      {/* Outgoing invites */}
      {data.outgoing.map((inv) => (
        <div
          key={inv.id}
          className="flex items-center gap-3 p-2 rounded-lg mb-1"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <Avatar url={avatarFor(inv.partner.username, inv.partner.avatar_url)} alt={inv.partner.username} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-cream text-xs font-semibold truncate">{inv.partner.username}</p>
            <p className="text-cream/50 text-[10px]">pact invite sent, waiting on them</p>
          </div>
          <button
            type="button"
            onClick={() => endPact(inv.id)}
            disabled={busy !== null}
            aria-label={`Cancel pact invite to ${inv.partner.username}`}
            className="text-cream/55 text-[10px] font-bold px-2 py-1 rounded hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      ))}

      {/* Active pacts */}
      {data.pacts.map((pact) => (
        <div
          key={pact.id}
          className="flex items-center gap-3 p-2 rounded-lg mb-1"
          style={{ background: "rgba(255,255,255,0.03)" }}
        >
          <Avatar url={avatarFor(pact.partner.username, pact.partner.avatar_url)} alt={pact.partner.username} size="sm" />
          <div className="flex-1 min-w-0">
            <p className="text-cream text-xs font-semibold truncate">{pact.partner.username}</p>
            <p className="text-cream/50 text-[10px]">best run together: {pact.bestStreak} days</p>
          </div>
          <span className="inline-flex items-center gap-1 flex-shrink-0">
            <Fire size={16} weight="duotone" color={PACT_ACCENT} aria-hidden="true" />
            <span className="font-bebas text-lg leading-none" style={{ color: PACT_ACCENT }}>
              {pact.currentStreak}
            </span>
          </span>
          {confirmEnd === pact.id ? (
            <span className="flex items-center gap-1 flex-shrink-0">
              <button
                type="button"
                onClick={() => endPact(pact.id)}
                disabled={busy !== null}
                className="text-red-300 text-[10px] font-bold px-2 py-1 rounded bg-red-400/10 hover:bg-red-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60 transition disabled:opacity-60"
              >
                {busy === `end-${pact.id}` ? "Ending" : "End it"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmEnd(null)}
                className="text-cream/55 text-[10px] font-bold px-2 py-1 rounded hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition"
              >
                Keep
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmEnd(pact.id)}
              aria-label={`End pact with ${pact.partner.username}`}
              className="text-cream/45 text-[10px] font-bold px-2 py-1 rounded hover:text-cream hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 transition flex-shrink-0"
            >
              End
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
