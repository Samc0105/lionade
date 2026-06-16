"use client";

/**
 * /admin/features — feature kill-switch control panel. ADMIN ONLY.
 *
 * Renders the FEATURE_CATALOG as an indented hierarchy tree. Each node shows
 * its EFFECTIVE status (down if the node itself or any ancestor is in
 * maintenance — computed client-side via featureChain, never trusting a single
 * row), a Live/Maintenance toggle, and an "Edit message + ETA" action that
 * POSTs to /api/admin/features.
 *
 * Inheritance rule: a node whose ANCESTOR is in maintenance is "down via
 * <ancestor>" and its own toggle is disabled — you flip the parent back to
 * live to restore it. This mirrors assertFeatureLive (server) and
 * useFeatureStatus (client), so the admin sees exactly what users see.
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
import { Flag, Wrench, CheckCircle, PencilSimple } from "@phosphor-icons/react";

// ── Server shapes ──────────────────────────────────────────────────────────
interface StoredFlag {
  status: string;
  message: string | null;
  eta: string | null;
  updatedAt?: string | null;
}
interface FeaturesResponse {
  catalog: FeatureNode[];
  flags: Record<string, StoredFlag>;
}

// Effective status of a node, resolving the maintenance chain (self first,
// then dot-path ancestors). The first link in maintenance wins and is the
// reason the node is down. Mirrors useFeatureStatus on the public side.
interface Effective {
  down: boolean;
  /** which key in the chain is the actual maintenance source (self or ancestor) */
  downKey: string | null;
  /** true when the source is an ancestor, not the node itself */
  viaAncestor: boolean;
}

function resolveEffective(key: string, flags: Record<string, StoredFlag>): Effective {
  for (const link of featureChain(key)) {
    if (flags[link]?.status === "maintenance") {
      return { down: true, downKey: link, viaAncestor: link !== key };
    }
  }
  return { down: false, downKey: null, viaAncestor: false };
}

// Depth from the dot-path, for indentation. "games.party.sketch" -> 2.
function depthOf(key: string): number {
  return (key.match(/\./g) ?? []).length;
}

function labelFor(key: string): string {
  return getFeature(key)?.label ?? key;
}

// ── Edit message + ETA modal ─────────────────────────────────────────────────
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
  // Editing copy only flips the node into maintenance with the new wording.
  // (Status itself is driven by the row toggle; this modal always writes
  // status:'maintenance' because it's only reachable from a maintenance node.)
  const [message, setMessage] = useState(initial?.message ?? "");
  const [eta, setEta] = useState(initial?.eta ?? "");
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    const res = await apiPost("/api/admin/features", {
      key: node.key,
      status: "maintenance",
      message: message.trim() || undefined,
      eta: eta.trim() || undefined,
    });
    setBusy(false);
    if (res.ok) {
      toastSuccess(`Updated the ${node.label} maintenance notice`);
      onSaved();
      onClose();
    } else {
      toastError(res.error ?? "Could not update that flag");
    }
  };

  return (
    <AdminModalShell open onClose={onClose} busy={busy} labelId="edit-flag-title" borderClass="border-amber-400/25">
      <h2 id="edit-flag-title" className="font-bebas text-2xl tracking-wider text-cream mb-1">
        Maintenance notice
      </h2>
      <p className="text-sm text-cream/55 mb-4">
        Shown to users while <span className="font-semibold text-cream/80">{node.label}</span> is down.
        Keep it short and reassuring.
      </p>

      <label className="block text-[11px] uppercase tracking-wider text-cream/45 font-bold mb-1.5">
        Message
      </label>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        rows={3}
        maxLength={280}
        placeholder="We're tuning this up. Back shortly."
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
          disabled={busy}
          className="px-4 py-2 rounded-xl text-sm font-bold transition-all hover:brightness-110 disabled:opacity-50"
          style={{ background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)", color: "#04080F" }}
        >
          {busy ? "Saving…" : "Save notice"}
        </button>
      </div>
    </AdminModalShell>
  );
}

// ── A single row in the tree ─────────────────────────────────────────────────
function FeatureRow({
  node,
  flags,
  pendingKey,
  onToggle,
  onEdit,
}: {
  node: FeatureNode;
  flags: Record<string, StoredFlag>;
  pendingKey: string | null;
  onToggle: (node: FeatureNode, next: "live" | "maintenance") => void;
  onEdit: (node: FeatureNode) => void;
}) {
  const eff = resolveEffective(node.key, flags);
  const selfFlag = flags[node.key];
  const selfMaintenance = selfFlag?.status === "maintenance";
  const depth = depthOf(node.key);
  const pending = pendingKey === node.key;

  // A node down BECAUSE OF AN ANCESTOR can't be toggled here — flip the parent.
  const ancestorDown = eff.down && eff.viaAncestor;

  return (
    <div
      className="flex items-center gap-3 px-4 py-3 border-b border-white/[0.04] last:border-0 hover:bg-white/[0.025] transition-colors"
      style={{ paddingLeft: `${16 + depth * 22}px` }}
    >
      {/* tree connector glyph */}
      {depth > 0 && <span className="text-cream/20 font-mono text-xs -ml-3 select-none">└</span>}

      {/* status dot + label */}
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span
          aria-hidden="true"
          className={`w-2 h-2 rounded-full shrink-0 ${
            eff.down ? "bg-amber-400" : "bg-green-400"
          }`}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-semibold truncate ${eff.down ? "text-cream/55" : "text-cream"}`}>
              {node.label}
            </span>
            {selfMaintenance && (selfFlag?.message || selfFlag?.eta) && (
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
            down via {labelFor(eff.downKey ?? "")}
          </span>
        ) : eff.down ? (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-amber-400/15 text-amber-300 border-amber-400/30">
            <Wrench size={11} weight="fill" aria-hidden="true" /> maintenance
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full border bg-green-400/15 text-green-300 border-green-400/30">
            <CheckCircle size={11} weight="fill" aria-hidden="true" /> live
          </span>
        )}
      </div>

      {/* edit message + eta — only meaningful when the node itself is down */}
      <button
        onClick={() => onEdit(node)}
        disabled={!selfMaintenance || pending}
        title={selfMaintenance ? "Edit message + ETA" : "Set to maintenance to add a notice"}
        className="shrink-0 p-2 rounded-lg text-cream/45 hover:text-cream/85 hover:bg-white/5 transition-all disabled:opacity-25 disabled:hover:bg-transparent"
        aria-label={`Edit message and ETA for ${node.label}`}
      >
        <PencilSimple size={15} aria-hidden="true" />
      </button>

      {/* live/maintenance toggle */}
      <button
        onClick={() => onToggle(node, selfMaintenance ? "live" : "maintenance")}
        disabled={ancestorDown || pending}
        title={
          ancestorDown
            ? `Controlled by ${labelFor(eff.downKey ?? "")}. Flip that to restore.`
            : selfMaintenance
              ? "Bring back live"
              : "Put into maintenance"
        }
        className={`shrink-0 w-[120px] px-3 py-1.5 rounded-xl text-xs font-bold transition-all disabled:opacity-35 disabled:cursor-not-allowed ${
          selfMaintenance
            ? "bg-green-400/15 text-green-300 border border-green-400/30 hover:bg-green-400/25"
            : "bg-amber-400/15 text-amber-300 border border-amber-400/30 hover:bg-amber-400/25"
        }`}
        aria-label={selfMaintenance ? `Bring ${node.label} back live` : `Put ${node.label} into maintenance`}
      >
        {pending ? "…" : selfMaintenance ? "Bring back live" : "Maintenance"}
      </button>
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

  const downCount = useMemo(
    () => nodes.filter((n) => resolveEffective(n.key, flags).down).length,
    [nodes, flags],
  );

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

  const toggle = async (node: FeatureNode, next: "live" | "maintenance") => {
    setPendingKey(node.key);
    // Preserve any existing message/eta when flipping; the row keeps them.
    const existing = flags[node.key];
    const res = await apiPost("/api/admin/features", {
      key: node.key,
      status: next,
      message: existing?.message ?? undefined,
      eta: existing?.eta ?? undefined,
    });
    setPendingKey(null);
    if (res.ok) {
      toastSuccess(
        next === "maintenance"
          ? `${node.label} is now in maintenance`
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
            Put any surface into maintenance to take it offline gracefully. A child
            inherits its parent: flipping a hub takes its whole subtree down. Recovery
            surfaces (login, settings, this console) can never be gated.
          </p>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-bebas text-3xl tracking-wider text-cream leading-none">
            {data ? downCount : "—"}
          </div>
          <div className="text-[11px] uppercase tracking-wider text-cream/40 mt-1">in maintenance</div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-400/30 bg-amber-400/10 text-amber-200 text-sm px-4 py-3 mb-5">
          Could not load feature flags. If migration 20260616150000_feature_flags has
          not been run yet, run it first. Until then everything stays live (fail-open).
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
              pendingKey={pendingKey}
              onToggle={toggle}
              onEdit={setEditNode}
            />
          ))}
        </div>
      )}

      <p className="mt-3 text-xs text-cream/35">
        Changes apply within about a minute on every client. Each flip is written to the
        audit log as <span className="font-mono text-cream/50">feature_flag_change</span>.
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
