"use client";

/**
 * /admin/features — feature kill-switch v2 control panel. ADMIN ONLY.
 *
 * Renders the FEATURE_CATALOG as an indented hierarchy tree. Each node shows
 * its EFFECTIVE status (computed client-side via featureChain + the scheduling
 * window, never trusting a single raw row), a three-way Live / Warning /
 * Maintenance control, and an "Edit" action that opens a modal for the
 * user-facing message + ETA plus an optional schedule window (start / end).
 *
 * THREE STATES (model identical to lib/feature-flags.ts + the SQL doc):
 *   live         normal.
 *   warning      feature is USABLE; users see a dismissible "known issue"
 *                banner. The API is NOT blocked.
 *   maintenance  feature is replaced by the maintenance screen; the API 503s.
 *
 * SCHEDULING: a warning/maintenance row may carry startsAt / endsAt. The
 * EFFECTIVE status is window-aware and computed at render time here (the admin
 * tool reads RAW rows from GET so it can show + edit the schedule). A row whose
 * window has not opened yet shows "scheduled"; a row whose window has expired
 * resolves back to "live" (auto-clear, no cron). This mirrors what users see.
 *
 * Inheritance rule: a node whose ANCESTOR is in effective maintenance is "down
 * via <ancestor>" and its own control is disabled — flip the parent back to
 * live to restore it. This mirrors assertFeatureLive (server) and
 * useFeatureStatus (client). Effective maintenance beats effective warning in
 * the chain.
 *
 * SAFETY: this UI can only act on catalog keys, and the catalog excludes every
 * recovery surface (/admin/*, /login, /signup, /onboard/*, /settings/*, the
 * auth/account/quiz-core APIs, the Navbar, the flag system itself) by
 * construction. The POST endpoint independently re-checks the key and re-gates
 * to admins; this page is UX only.
 *
 * The layout already hard-gates /admin to staff; this page additionally
 * self-gates to admins (the API returns 403 to support staff) and shows an
 * access note instead of an empty tree.
 */

import { useMemo, useState } from "react";
import useSWR from "swr";
import { swrFetcher, apiPost } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { toastSuccess, toastError } from "@/lib/toast";
import {
  FEATURE_CATALOG,
  featureChain,
  getFeature,
  type FeatureNode,
} from "@/lib/features/catalog";
import { CARD_BG, AdminModalShell } from "@/components/admin/shared";
import {
  Flag,
  Wrench,
  CheckCircle,
  Warning,
  PencilSimple,
  Clock,
} from "@phosphor-icons/react";

// ── Status model ─────────────────────────────────────────────────────────────
type RawStatus = "live" | "warning" | "maintenance";
type EffectiveStatus = "live" | "warning" | "maintenance";

// ── Server shapes (RAW rows from GET) ────────────────────────────────────────
interface StoredFlag {
  status: RawStatus;
  message: string | null;
  eta: string | null;
  startsAt: string | null;
  endsAt: string | null;
  updatedAt?: string | null;
}
interface FeaturesResponse {
  catalog: FeatureNode[];
  flags: Record<string, StoredFlag>;
}

// ── Window-aware resolution (MUST match lib/feature-flags.ts effectiveStatus) ─
// Given a raw row and `now` (ms), resolve the EFFECTIVE status of just that row:
//   - 'live'                  -> 'live'.
//   - 'warning'|'maintenance' -> that status ONLY IF the window is open:
//       (startsAt null OR now >= startsAt) AND (endsAt null OR now <= endsAt);
//       otherwise 'live' (not yet active, or expired => auto-clear).
// Unparseable bounds fail-open (treated as "no bound") so a malformed timestamp
// never strengthens a gate.
function effectiveOf(flag: StoredFlag | undefined, now: number): EffectiveStatus {
  if (!flag || flag.status === "live") return "live";
  if (flag.startsAt) {
    const start = Date.parse(flag.startsAt);
    if (!Number.isNaN(start) && now < start) return "live";
  }
  if (flag.endsAt) {
    const end = Date.parse(flag.endsAt);
    if (!Number.isNaN(end) && now > end) return "live";
  }
  return flag.status;
}

// True when this row is a warning/maintenance override whose window has not yet
// opened (so it currently resolves to 'live' but is "scheduled" to activate).
function isScheduledPending(flag: StoredFlag | undefined, now: number): boolean {
  if (!flag || flag.status === "live") return false;
  if (effectiveOf(flag, now) !== "live") return false; // already active
  if (!flag.startsAt) return false; // no start bound => not "pending", it's expired/cleared
  const start = Date.parse(flag.startsAt);
  if (Number.isNaN(start)) return false;
  // pending only if the future start hasn't arrived AND the end (if any) hasn't passed
  if (now >= start) return false;
  if (flag.endsAt) {
    const end = Date.parse(flag.endsAt);
    if (!Number.isNaN(end) && now > end) return false; // window already in the past
  }
  return true;
}

// Effective chain resolution: walk self + ancestors. Effective maintenance
// anywhere wins; else effective warning anywhere; else live. Tracks the nearest
// source key + whether it came from an ancestor (for the "down via" pill and to
// disable a child's own control).
interface Effective {
  status: EffectiveStatus;
  /** which key in the chain is the source of the effective status (or null) */
  sourceKey: string | null;
  /** true when the source is an ancestor, not the node itself */
  viaAncestor: boolean;
}

function resolveEffective(
  key: string,
  flags: Record<string, StoredFlag>,
  now: number,
): Effective {
  let warnSource: { key: string; viaAncestor: boolean } | null = null;
  for (const link of featureChain(key)) {
    const eff = effectiveOf(flags[link], now);
    if (eff === "maintenance") {
      return { status: "maintenance", sourceKey: link, viaAncestor: link !== key };
    }
    if (eff === "warning" && !warnSource) {
      warnSource = { key: link, viaAncestor: link !== key };
    }
  }
  if (warnSource) {
    return { status: "warning", sourceKey: warnSource.key, viaAncestor: warnSource.viaAncestor };
  }
  return { status: "live", sourceKey: null, viaAncestor: false };
}

// Depth from the dot-path, for indentation. "games.party.sketch" -> 2.
function depthOf(key: string): number {
  return (key.match(/\./g) ?? []).length;
}

function labelFor(key: string): string {
  return getFeature(key)?.label ?? key;
}

// ── datetime-local <-> ISO helpers ───────────────────────────────────────────
// <input type="datetime-local"> works in the browser's LOCAL time and has no
// timezone. We convert to/from ISO (UTC) at the boundary so the stored window
// is unambiguous.

// ISO (UTC) -> "YYYY-MM-DDTHH:mm" in local time for the input value.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

// "YYYY-MM-DDTHH:mm" (local) -> ISO (UTC), or null when empty/invalid.
function localInputToIso(value: string): string | null {
  if (!value.trim()) return null;
  const ms = Date.parse(value); // browsers parse the no-tz string as local
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

// ── Edit modal: status + message + ETA + schedule ────────────────────────────
function EditFlagModal({
  node,
  initial,
  onClose,
  onSaved,
}: {
  node: FeatureNode;
  initial: StoredFlag | undefined;
  onClose: () => void;
  onSaved: () => void;
}) {
  // Default the modal's status to whatever the row already is, but never 'live'
  // here — this modal is for configuring an override. If the row is live we
  // open on 'warning' (the lighter override) so saving the message turns it on.
  const initialStatus: Exclude<RawStatus, "live"> =
    initial?.status === "maintenance" ? "maintenance" : "warning";
  const [status, setStatus] = useState<Exclude<RawStatus, "live">>(initialStatus);
  const [message, setMessage] = useState(initial?.message ?? "");
  const [eta, setEta] = useState(initial?.eta ?? "");
  const [startsAtLocal, setStartsAtLocal] = useState(isoToLocalInput(initial?.startsAt));
  const [endsAtLocal, setEndsAtLocal] = useState(isoToLocalInput(initial?.endsAt));
  const [busy, setBusy] = useState(false);

  const startsAtIso = localInputToIso(startsAtLocal);
  const endsAtIso = localInputToIso(endsAtLocal);
  // Client-side mirror of the server validation: if both set, end must be after
  // start. Block save with a clear inline note rather than a round-trip error.
  const windowInvalid =
    startsAtIso !== null && endsAtIso !== null && Date.parse(endsAtIso) <= Date.parse(startsAtIso);

  const isMaintenance = status === "maintenance";

  const save = async () => {
    if (windowInvalid) return;
    setBusy(true);
    const res = await apiPost("/api/admin/features", {
      key: node.key,
      status,
      message: message.trim() || undefined,
      eta: eta.trim() || undefined,
      startsAt: startsAtIso,
      endsAt: endsAtIso,
    });
    setBusy(false);
    if (res.ok) {
      toastSuccess(
        isMaintenance
          ? `Saved the ${node.label} maintenance notice`
          : `Saved the ${node.label} known-issue notice`,
      );
      onSaved();
      onClose();
    } else {
      toastError(res.error ?? "Could not update that flag");
    }
  };

  const accent = isMaintenance ? "#F87171" : "#F0B429"; // red vs amber

  return (
    <AdminModalShell
      open
      onClose={onClose}
      busy={busy}
      labelId="edit-flag-title"
      borderClass={isMaintenance ? "border-red-400/25" : "border-amber-400/25"}
    >
      <h2 id="edit-flag-title" className="font-bebas text-2xl tracking-wider text-cream mb-1">
        {isMaintenance ? "Maintenance notice" : "Known-issue notice"}
      </h2>
      <p className="text-sm text-cream/55 mb-4">
        Shown to users for <span className="font-semibold text-cream/80">{node.label}</span>.
        {isMaintenance
          ? " Maintenance replaces the surface and 503s its API."
          : " A warning keeps the surface usable with a dismissible banner."}
      </p>

      {/* status picker (warning / maintenance) inside the modal */}
      <label className="block text-[11px] uppercase tracking-wider text-cream/45 font-bold mb-1.5">
        Severity
      </label>
      <div className="grid grid-cols-2 gap-2 mb-4">
        <button
          type="button"
          onClick={() => setStatus("warning")}
          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
            status === "warning"
              ? "bg-amber-400/20 text-amber-200 border-amber-400/45"
              : "bg-white/[0.03] text-cream/45 border-white/10 hover:bg-white/[0.06]"
          }`}
        >
          <Warning size={13} weight="fill" className="inline mr-1 -mt-0.5" aria-hidden="true" />
          Warning
        </button>
        <button
          type="button"
          onClick={() => setStatus("maintenance")}
          className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all ${
            status === "maintenance"
              ? "bg-red-400/20 text-red-200 border-red-400/45"
              : "bg-white/[0.03] text-cream/45 border-white/10 hover:bg-white/[0.06]"
          }`}
        >
          <Wrench size={13} weight="fill" className="inline mr-1 -mt-0.5" aria-hidden="true" />
          Maintenance
        </button>
      </div>

      <label className="block text-[11px] uppercase tracking-wider text-cream/45 font-bold mb-1.5">
        Message
      </label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={280}
        placeholder={
          isMaintenance ? "We're tuning this up. Back shortly." : "We're aware of an issue and on it. You can keep using it."
        }
        className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-cream placeholder:text-cream/30 focus:outline-none focus:border-amber-400/40 resize-none"
      />
      <div className="text-[11px] text-cream/30 text-right mt-1">{message.length}/280</div>

      <label className="block text-[11px] uppercase tracking-wider text-cream/45 font-bold mb-1.5 mt-3">
        ETA (optional)
      </label>
      <input
        value={eta}
        onChange={(e) => setEta(e.target.value)}
        maxLength={120}
        placeholder="Back by 5pm ET"
        className="w-full rounded-xl bg-white/[0.04] border border-white/10 px-3 py-2.5 text-sm text-cream placeholder:text-cream/30 focus:outline-none focus:border-amber-400/40"
      />

      {/* schedule window (optional) */}
      <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-3">
        <div className="flex items-center gap-1.5 mb-2.5">
          <Clock size={13} weight="bold" className="text-cream/50" aria-hidden="true" />
          <span className="text-[11px] uppercase tracking-wider text-cream/55 font-bold">
            Schedule (optional)
          </span>
        </div>
        <p className="text-[11px] text-cream/35 mb-3 leading-relaxed">
          Leave blank for immediate + open-ended. The window is in your local
          time. Outside the window this resolves back to live automatically.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              Start
            </label>
            <input
              type="datetime-local"
              value={startsAtLocal}
              onChange={(e) => setStartsAtLocal(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-2 text-xs text-cream focus:outline-none focus:border-amber-400/40 [color-scheme:dark]"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wider text-cream/40 font-bold mb-1">
              End
            </label>
            <input
              type="datetime-local"
              value={endsAtLocal}
              onChange={(e) => setEndsAtLocal(e.target.value)}
              className="w-full rounded-lg bg-white/[0.04] border border-white/10 px-2.5 py-2 text-xs text-cream focus:outline-none focus:border-amber-400/40 [color-scheme:dark]"
            />
          </div>
        </div>
        {(startsAtLocal || endsAtLocal) && (
          <button
            type="button"
            onClick={() => {
              setStartsAtLocal("");
              setEndsAtLocal("");
            }}
            className="mt-2 text-[11px] font-bold text-cream/45 hover:text-cream/80 transition-colors"
          >
            Clear schedule
          </button>
        )}
        {windowInvalid && (
          <p className="mt-2 text-[11px] text-red-300 font-semibold">
            End must be after start.
          </p>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 mt-6">
        <button
          onClick={onClose}
          disabled={busy}
          className="px-4 py-2 rounded-xl text-sm font-bold text-cream/60 hover:text-cream/90 hover:bg-white/5 transition-all disabled:opacity-40"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={busy || windowInvalid}
          className="px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: `linear-gradient(135deg, ${accent} 0%, ${accent}cc 50%, ${accent} 100%)`, color: "#04080F" }}
        >
          {busy ? "Saving…" : "Save notice"}
        </button>
      </div>
    </AdminModalShell>
  );
}

// ── Three-way status segmented control ───────────────────────────────────────
function StatusControl({
  value,
  disabled,
  pending,
  onPick,
}: {
  value: RawStatus;
  disabled: boolean;
  pending: boolean;
  onPick: (next: RawStatus) => void;
}) {
  const opts: Array<{
    key: RawStatus;
    label: string;
    icon: typeof CheckCircle;
    on: string;
  }> = [
    { key: "live", label: "Live", icon: CheckCircle, on: "bg-green-400/20 text-green-200 border-green-400/45" },
    { key: "warning", label: "Warning", icon: Warning, on: "bg-amber-400/20 text-amber-200 border-amber-400/45" },
    { key: "maintenance", label: "Down", icon: Wrench, on: "bg-red-400/20 text-red-200 border-red-400/45" },
  ];

  return (
    <div
      className={`shrink-0 inline-flex rounded-xl border border-white/10 overflow-hidden ${
        disabled ? "opacity-35" : ""
      }`}
      role="group"
      aria-label="Set feature status"
    >
      {opts.map((o, i) => {
        const Icon = o.icon;
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            disabled={disabled || pending}
            onClick={() => !active && onPick(o.key)}
            aria-pressed={active}
            title={
              o.key === "live"
                ? "Set live"
                : o.key === "warning"
                  ? "Show a known-issue banner"
                  : "Take into maintenance"
            }
            className={`px-2.5 py-1.5 text-[11px] font-bold transition-all border-r last:border-r-0 border-white/10 disabled:cursor-not-allowed ${
              active ? o.on : "text-cream/40 hover:text-cream/80 hover:bg-white/[0.05]"
            } ${i === 0 ? "" : ""}`}
          >
            {pending && active ? (
              "…"
            ) : (
              <span className="inline-flex items-center gap-1">
                <Icon size={12} weight="fill" aria-hidden="true" />
                {o.label}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── A single row in the tree ─────────────────────────────────────────────────
function FeatureRow({
  node,
  flags,
  now,
  pendingKey,
  onSetStatus,
  onEdit,
}: {
  node: FeatureNode;
  flags: Record<string, StoredFlag>;
  now: number;
  pendingKey: string | null;
  onSetStatus: (node: FeatureNode, next: RawStatus) => void;
  onEdit: (node: FeatureNode) => void;
}) {
  const eff = resolveEffective(node.key, flags, now);
  const selfFlag = flags[node.key];
  const selfRaw: RawStatus = selfFlag?.status ?? "live";
  const depth = depthOf(node.key);
  const pending = pendingKey === node.key;

  const scheduled = isScheduledPending(selfFlag, now);
  // A node whose EFFECTIVE down/warn comes from an ANCESTOR cannot be controlled
  // here — flip the parent. (Only maintenance fully disables; an ancestor
  // warning still lets this node be controlled, but its own effective stays at
  // least warning. We disable only on ancestor maintenance, matching v1.)
  const ancestorDown = eff.status === "maintenance" && eff.viaAncestor;

  const dotColor =
    eff.status === "maintenance"
      ? "bg-red-400"
      : eff.status === "warning"
        ? "bg-amber-400"
        : scheduled
          ? "bg-cream/30"
          : "bg-green-400";

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors"
      style={{ paddingLeft: `${16 + depth * 22}px` }}
    >
      {/* tree connector glyph */}
      {depth > 0 && <span className="text-cream/20 font-mono text-xs -ml-3 select-none">└</span>}

      {/* status dot + label */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm font-semibold truncate ${
                eff.status === "maintenance" ? "text-cream/55" : "text-cream"
              }`}
            >
              {node.label}
            </span>
            {selfRaw !== "live" && (selfFlag?.message || selfFlag?.eta) && (
              <span className="text-[10px] text-cream/35 font-mono truncate">
                {selfFlag?.eta ? `eta: ${selfFlag.eta}` : "has notice"}
              </span>
            )}
          </div>
          <div className="text-[11px] text-cream/30 font-mono truncate">{node.key}</div>
        </div>
      </div>

      {/* effective-status pill */}
      <div className="shrink-0">
        {ancestorDown ? (
          <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-white/[0.06] text-cream/45 border-white/15">
            down via {labelFor(eff.sourceKey ?? "")}
          </span>
        ) : eff.status === "warning" && eff.viaAncestor ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-400/10 text-amber-300/80 border-amber-400/25">
            <Warning size={11} weight="fill" aria-hidden="true" /> warn via {labelFor(eff.sourceKey ?? "")}
          </span>
        ) : eff.status === "maintenance" ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-red-400/15 text-red-300 border-red-400/30">
            <Wrench size={11} weight="fill" aria-hidden="true" /> maintenance
          </span>
        ) : eff.status === "warning" ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-400/15 text-amber-300 border-amber-400/30">
            <Warning size={11} weight="fill" aria-hidden="true" /> warning
          </span>
        ) : scheduled ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-white/[0.06] text-cream/55 border-white/15">
            <Clock size={11} weight="fill" aria-hidden="true" /> scheduled
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-green-400/15 text-green-300 border-green-400/30">
            <CheckCircle size={11} weight="fill" aria-hidden="true" /> live
          </span>
        )}
      </div>

      {/* edit message + eta + schedule — meaningful when the node has an override */}
      <button
        onClick={() => onEdit(node)}
        disabled={pending}
        title={
          selfRaw !== "live"
            ? "Edit message, ETA + schedule"
            : "Set up a warning or maintenance notice with optional schedule"
        }
        className="shrink-0 p-2 rounded-lg text-cream/45 hover:text-cream/85 hover:bg-white/5 transition-all disabled:opacity-25 disabled:hover:bg-transparent"
        aria-label={`Edit notice and schedule for ${node.label}`}
      >
        <PencilSimple size={15} aria-hidden="true" />
      </button>

      {/* three-way status control */}
      <StatusControl
        value={selfRaw}
        disabled={ancestorDown}
        pending={pending}
        onPick={(next) => onSetStatus(node, next)}
      />
    </div>
  );
}

export default function AdminFeaturesPage() {
  const { isAdmin } = useAdminRole();

  const { data, error, isLoading, mutate } = useSWR<FeaturesResponse>(
    isAdmin ? "/api/admin/features" : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  const [editNode, setEditNode] = useState<FeatureNode | null>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const flags = data?.flags ?? {};
  // Tree order is the catalog order, which is already authored parent-before-child.
  const nodes = useMemo(() => data?.catalog ?? FEATURE_CATALOG, [data?.catalog]);

  // One consistent instant for resolving every row's window this render.
  const now = Date.now();

  const counts = useMemo(() => {
    let down = 0;
    let warn = 0;
    for (const n of nodes) {
      const s = resolveEffective(n.key, flags, now).status;
      if (s === "maintenance") down++;
      else if (s === "warning") warn++;
    }
    return { down, warn };
  }, [nodes, flags, now]);

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        Feature flags are admin only.
      </div>
    );
  }

  // Flip the three-way control. 'live' clears the override (and any schedule);
  // 'warning' / 'maintenance' preserve any existing message/eta/window so the
  // operator can quickly escalate severity without retyping the notice.
  const setStatus = async (node: FeatureNode, next: RawStatus) => {
    setPendingKey(node.key);
    const existing = flags[node.key];
    const res = await apiPost("/api/admin/features", {
      key: node.key,
      status: next,
      message: next === "live" ? undefined : existing?.message ?? undefined,
      eta: next === "live" ? undefined : existing?.eta ?? undefined,
      startsAt: next === "live" ? null : existing?.startsAt ?? null,
      endsAt: next === "live" ? null : existing?.endsAt ?? null,
    });
    setPendingKey(null);
    if (res.ok) {
      toastSuccess(
        next === "maintenance"
          ? `${node.label} is now in maintenance`
          : next === "warning"
            ? `${node.label} now shows a known-issue banner`
            : `${node.label} is live again`,
      );
      mutate();
    } else {
      toastError(res.error ?? "Could not update that flag");
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1 flex items-center gap-2">
            <Flag size={26} weight="fill" className="text-gold" aria-hidden="true" />
            Features
          </h1>
          <p className="text-sm text-cream/50 max-w-2xl">
            Set any surface to Warning (usable, shows a known-issue banner) or
            Maintenance (replaced by the maintenance screen, API 503s). A child
            inherits its parent: putting a hub down takes its whole subtree down.
            Add an optional schedule and it activates and clears itself.
            Recovery surfaces (login, settings, this console) can never be gated.
          </p>
        </div>
        <div className="shrink-0 flex items-start gap-5 text-right">
          <div>
            <div className="font-bebas text-3xl tracking-wider text-red-300 leading-none">
              {data ? counts.down : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-cream/40 mt-1">maintenance</div>
          </div>
          <div>
            <div className="font-bebas text-3xl tracking-wider text-amber-300 leading-none">
              {data ? counts.warn : "—"}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-cream/40 mt-1">warning</div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200 text-sm px-4 py-3 mb-5">
          Could not load feature flags. If migrations 20260616150000_feature_flags
          and 20260616160000_feature_flags_v2 have not been run yet, run them
          first. Until then everything stays live (fail-open).
        </div>
      )}

      {isLoading && !data ? (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-12 rounded-xl bg-white/[0.04] animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.08] overflow-hidden" style={{ background: CARD_BG }}>
          {nodes.map((node) => (
            <FeatureRow
              key={node.key}
              node={node}
              flags={flags}
              now={now}
              pendingKey={pendingKey}
              onSetStatus={setStatus}
              onEdit={setEditNode}
            />
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-cream/35">
        Changes apply within about a minute on every client. Each change is written
        to the audit log as{" "}
        <span className="font-mono text-cream/50">feature_flag_change</span>. A
        scheduled window activates and auto-clears on its own.
      </p>

      {editNode && (
        <EditFlagModal
          node={editNode}
          initial={flags[editNode.key]}
          onClose={() => setEditNode(null)}
          onSaved={() => mutate()}
        />
      )}
    </div>
  );
}
