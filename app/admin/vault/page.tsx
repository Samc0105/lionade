"use client";

/**
 * /admin/vault — Shared credentials. ADMIN ONLY.
 *
 * Account logins for shared Lionade social and service accounts. The list
 * (GET /api/admin/vault) returns ONLY non-secret fields; the encrypted secret
 * never ships with it. A plaintext password leaves the server in exactly one
 * place: POST /api/admin/vault/[id]/reveal, and only after the server has
 * re-verified the caller is an admin and written a vault_reveal audit row.
 *
 * Client-side rules this file honors:
 *   - The role gate is enforced by app/admin/layout.tsx; we self-gate the
 *     admin-only content here too (support staff get an access note, never a
 *     broken table) and the SWR key is null for non-admins so no fetch fires.
 *   - A revealed secret lives ONLY in transient component state. It is never
 *     written to the SWR cache, localStorage, or any log. Closing the card or
 *     re-mutating the list clears it.
 *   - Mutations surface results via toasts (not inline banners); inline banners
 *     are reserved for SWR load failures.
 */

import { useState } from "react";
import useSWR from "swr";
import { swrFetcher, apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import { useAdminRole } from "@/lib/use-admin-role";
import { toastSuccess, toastError } from "@/lib/toast";
import ConfirmModal from "@/components/ConfirmModal";
import { CARD_BG, AdminModalShell } from "@/components/admin/shared";
import type { VaultItem } from "@/lib/vault/types";
import {
  ShieldCheck,
  LockKey,
  Eye,
  EyeSlash,
  Copy,
  Plus,
  PencilSimple,
  Trash,
  LinkSimple,
  Key,
  Warning,
} from "@phosphor-icons/react";

// The fields an admin can type into the add / edit forms. `secret` is split out
// because it is write-only from the client's perspective (never read back from
// the list) and is optional on edit (blank means "keep the existing secret").
interface VaultFormFields {
  label: string;
  category: string;
  username: string;
  url: string;
  notes: string;
  secret: string;
}

const EMPTY_FORM: VaultFormFields = {
  label: "",
  category: "",
  username: "",
  url: "",
  notes: "",
  secret: "",
};

const fieldInput =
  "w-full mb-3 px-3 py-2.5 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-gold/40";
const fieldLabel =
  "block text-[11px] uppercase tracking-wider text-cream/40 font-bold mb-1";

function fmtDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString() : "—";
}

export default function AdminVaultPage() {
  const { isAdmin } = useAdminRole();

  const listKey = "/api/admin/vault";
  const { data, error, isLoading, mutate } = useSWR<{ credentials: VaultItem[] }>(
    isAdmin ? listKey : null,
    swrFetcher,
    { keepPreviousData: true, revalidateOnFocus: true },
  );

  // ── add / edit form state ─────────────────────────────────────────
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<VaultFormFields>(EMPTY_FORM);
  const [showSecretInput, setShowSecretInput] = useState(false);
  const [busy, setBusy] = useState(false);

  // ── delete confirm state ──────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<VaultItem | null>(null);

  // ── reveal state (transient only; keyed by credential id) ──────────
  // Revealed plaintext is held here and nowhere else. It is wiped on Hide and
  // whenever the list is re-fetched.
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [revealBusy, setRevealBusy] = useState<string | null>(null);

  // ── key-rotation state (admin / danger area) ──────────────────────
  // Rotation re-seals every stored secret under the active encryption key.
  // It assumes the operator has already swapped the env keys (see the modal
  // copy). It is safe to re-run; already-rotated rows simply re-seal.
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotateBusy, setRotateBusy] = useState(false);

  if (!isAdmin) {
    return (
      <div
        className="rounded-xl border border-white/[0.08] text-cream/60 text-sm px-4 py-6 text-center"
        style={{ background: CARD_BG }}
      >
        Shared credentials are admin only.
      </div>
    );
  }

  const credentials = data?.credentials ?? [];

  const setField = (key: keyof VaultFormFields, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setShowSecretInput(false);
    setAddOpen(true);
  };

  const openEdit = (c: VaultItem) => {
    setForm({
      label: c.label,
      category: c.category ?? "",
      username: c.username ?? "",
      url: c.url ?? "",
      notes: c.notes ?? "",
      secret: "", // blank keeps the existing secret
    });
    setShowSecretInput(false);
    setEditId(c.id);
  };

  const closeForm = () => {
    setAddOpen(false);
    setEditId(null);
    setForm(EMPTY_FORM);
    setShowSecretInput(false);
  };

  // Build the JSON body shared by create and edit. Optional strings are trimmed;
  // an empty optional becomes null so the server stores a clean absence.
  const baseBody = () => {
    const opt = (v: string) => {
      const t = v.trim();
      return t.length > 0 ? t : null;
    };
    return {
      label: form.label.trim(),
      category: opt(form.category),
      username: opt(form.username),
      url: opt(form.url),
      notes: opt(form.notes),
    };
  };

  const submitAdd = async () => {
    if (form.label.trim().length < 1) {
      toastError("A label is required");
      return;
    }
    if (form.secret.length < 1) {
      toastError("A password or secret is required");
      return;
    }
    setBusy(true);
    const res = await apiPost(listKey, { ...baseBody(), secret: form.secret });
    setBusy(false);
    if (res.ok) {
      toastSuccess("Credential added");
      closeForm();
      void mutate();
    } else {
      toastError(res.error ?? "Could not store credential");
    }
  };

  const submitEdit = async () => {
    if (!editId) return;
    if (form.label.trim().length < 1) {
      toastError("A label is required");
      return;
    }
    // A non-empty secret rotates it; a blank secret is omitted so the server
    // keeps the existing one.
    const body: Record<string, string | null> = baseBody();
    if (form.secret.length > 0) body.secret = form.secret;
    setBusy(true);
    const res = await apiPatch(`/api/admin/vault/${editId}`, body);
    setBusy(false);
    if (res.ok) {
      toastSuccess(form.secret.length > 0 ? "Credential updated and password rotated" : "Credential updated");
      // A rotated secret invalidates any open reveal for this row.
      setRevealed((r) => {
        const next = { ...r };
        delete next[editId];
        return next;
      });
      closeForm();
      void mutate();
    } else {
      toastError(res.error ?? "Could not update credential");
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const res = await apiDelete(`/api/admin/vault/${deleteTarget.id}`);
    if (res.ok) {
      toastSuccess("Credential deleted");
      setRevealed((r) => {
        const next = { ...r };
        delete next[deleteTarget.id];
        return next;
      });
      setDeleteTarget(null);
      void mutate();
    } else {
      toastError(res.error ?? "Could not delete credential");
    }
  };

  const reveal = async (id: string) => {
    if (revealBusy) return; // single-flight guard — each reveal is an audited event
    setRevealBusy(id);
    const res = await apiPost<{ secret: string }>(`/api/admin/vault/${id}/reveal`, {});
    setRevealBusy(null);
    if (res.ok && typeof res.data?.secret === "string") {
      setRevealed((r) => ({ ...r, [id]: res.data!.secret }));
    } else {
      toastError(res.error ?? "Could not reveal credential");
    }
  };

  const hide = (id: string) =>
    setRevealed((r) => {
      const next = { ...r };
      delete next[id];
      return next;
    });

  const copy = async (id: string) => {
    const value = revealed[id];
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toastSuccess("Copied to clipboard");
    } catch {
      toastError("Could not copy. Copy it manually.");
    }
  };

  // Re-encrypt every stored secret under the active key. The server reads the
  // new key from CREDENTIAL_ENCRYPTION_KEY and the old key from
  // CREDENTIAL_ENCRYPTION_KEY_PREVIOUS; the operator must set both before
  // confirming. A revealed value is invalidated because the underlying
  // ciphertext changes, so we clear any open reveals on success.
  const confirmRotate = async () => {
    setRotateBusy(true);
    const res = await apiPost<{ ok: boolean; rotatedCount: number; failedIds: string[] }>(
      "/api/admin/vault/rotate",
      {},
    );
    setRotateBusy(false);
    if (res.ok) {
      const rotatedCount = res.data?.rotatedCount ?? 0;
      const failedIds = res.data?.failedIds ?? [];
      if (failedIds.length > 0) {
        toastError(
          `Rotated ${rotatedCount}, but ${failedIds.length} could not be re-encrypted. Re-run rotation after checking the keys.`,
        );
      } else {
        toastSuccess(
          rotatedCount === 1
            ? "Re-encrypted 1 credential under the new key."
            : `Re-encrypted ${rotatedCount} credentials under the new key.`,
        );
      }
      setRotateOpen(false);
      setRevealed({});
      void mutate();
    } else {
      toastError(res.error ?? "Could not rotate the encryption key");
    }
  };

  return (
    <div>
      <div className="flex items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-bebas text-4xl tracking-wider text-cream mb-1 flex items-center gap-3">
            <ShieldCheck size={30} weight="fill" className="text-gold" aria-hidden="true" />
            Shared credentials
          </h1>
          <p className="text-sm text-cream/50 max-w-2xl">
            Account logins for shared Lionade social and service accounts. Admin
            only. Every reveal is logged.
          </p>
        </div>
        <button
          onClick={openAdd}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold shrink-0 disabled:opacity-60"
          style={{
            background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
            color: "#04080F",
          }}
        >
          <Plus size={15} weight="bold" aria-hidden="true" /> Add credential
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 text-red-300 text-sm px-4 py-3 mb-5">
          Could not load the credential vault.
        </div>
      )}

      {/* Loading skeleton — no flash of an empty state before the list resolves. */}
      {isLoading && !data ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-32 rounded-2xl bg-white/[0.04] animate-pulse"
            />
          ))}
        </div>
      ) : credentials.length === 0 ? (
        <div
          className="rounded-2xl border border-white/[0.08] px-6 py-14 text-center"
          style={{ background: CARD_BG }}
        >
          <LockKey size={32} weight="fill" className="text-cream/30 mx-auto mb-3" aria-hidden="true" />
          <p className="text-cream/60 text-sm mb-1">No shared credentials yet.</p>
          <p className="text-cream/40 text-xs">
            Add the first one to keep shared logins out of chat threads and inboxes.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {credentials.map((c) => {
            const shown = revealed[c.id];
            const isRevealed = typeof shown === "string";
            const isRevealing = revealBusy === c.id;
            return (
              <div
                key={c.id}
                className="rounded-2xl border border-white/[0.08] p-5"
                style={{ background: CARD_BG }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <h2 className="font-bebas text-xl tracking-wider text-cream">
                        {c.label}
                      </h2>
                      {c.category && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/30">
                          {c.category}
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-cream/35 mt-0.5">
                      Updated {fmtDate(c.updated_at)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => openEdit(c)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-electric/30 text-electric bg-electric/10 text-xs font-bold transition-all hover:brightness-110"
                    >
                      <PencilSimple size={14} aria-hidden="true" /> Edit
                    </button>
                    <button
                      onClick={() => setDeleteTarget(c)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-red-400/30 text-red-400 bg-red-400/10 text-xs font-bold transition-all hover:brightness-110"
                    >
                      <Trash size={14} aria-hidden="true" /> Delete
                    </button>
                  </div>
                </div>

                <div className="grid sm:grid-cols-2 gap-x-6 gap-y-4 mt-4">
                  {/* Username / login handle — non-secret, shown in plaintext. */}
                  <div>
                    <div className={fieldLabel}>Login</div>
                    <div className="text-sm text-cream/85 font-mono break-all">
                      {c.username ?? <span className="text-cream/30 font-sans">—</span>}
                    </div>
                  </div>

                  {/* URL — non-secret, linked. */}
                  <div>
                    <div className={fieldLabel}>URL</div>
                    {c.url ? (
                      <a
                        href={c.url}
                        target="_blank"
                        rel="noopener noreferrer nofollow"
                        className="text-sm text-electric hover:underline inline-flex items-center gap-1.5 break-all"
                      >
                        <LinkSimple size={13} aria-hidden="true" /> {c.url}
                      </a>
                    ) : (
                      <span className="text-cream/30 text-sm">—</span>
                    )}
                  </div>

                  {/* Password — masked by default; revealed value is transient. */}
                  <div className="sm:col-span-2">
                    <div className={fieldLabel}>Password</div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm text-cream/85 font-mono px-3 py-1.5 rounded-lg bg-white/[0.05] border border-white/10 break-all">
                        {isRevealed ? shown : "••••••••••••"}
                      </code>
                      {isRevealed ? (
                        <>
                          <button
                            onClick={() => copy(c.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-cream/70 text-xs font-bold hover:bg-white/5"
                          >
                            <Copy size={13} aria-hidden="true" /> Copy
                          </button>
                          <button
                            onClick={() => hide(c.id)}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-cream/70 text-xs font-bold hover:bg-white/5"
                          >
                            <EyeSlash size={13} aria-hidden="true" /> Hide
                          </button>
                        </>
                      ) : (
                        <button
                          onClick={() => reveal(c.id)}
                          disabled={isRevealing}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gold/30 text-gold bg-gold/10 text-xs font-bold hover:brightness-110 disabled:opacity-60"
                          title="Audited action: logged as vault_reveal"
                        >
                          <Eye size={13} aria-hidden="true" />{" "}
                          {isRevealing ? "Revealing..." : "Reveal"}
                        </button>
                      )}
                    </div>
                    {isRevealed && (
                      <p className="text-[11px] text-cream/40 mt-1.5">
                        This reveal was logged. Hide it when you are done.
                      </p>
                    )}
                  </div>

                  {/* Notes — non-secret. */}
                  {c.notes && (
                    <div className="sm:col-span-2">
                      <div className={fieldLabel}>Notes</div>
                      <p className="text-sm text-cream/70 whitespace-pre-wrap break-words">
                        {c.notes}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Admin / danger area: encryption-key rotation ── */}
      <div
        className="mt-8 rounded-2xl border border-gold/20 p-5"
        style={{ background: CARD_BG }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-bebas text-xl tracking-wider text-gold flex items-center gap-2">
              <Key size={20} weight="fill" className="text-gold" aria-hidden="true" />
              Rotate encryption key
            </h2>
            <p className="text-xs text-cream/50 mt-1 max-w-2xl">
              Re-encrypts every stored secret under a new encryption key. Set the
              environment first, then run rotation here. Safe to re-run.
            </p>
          </div>
          <button
            onClick={() => setRotateOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl border border-gold/30 text-gold bg-gold/10 text-sm font-bold shrink-0 transition-all hover:brightness-110"
          >
            <Key size={15} weight="bold" aria-hidden="true" /> Rotate encryption key
          </button>
        </div>
      </div>

      {/* ── Add / Edit modal (one shell, switched by addOpen / editId) ── */}
      <AdminModalShell
        open={addOpen || editId !== null}
        onClose={closeForm}
        busy={busy}
        labelId="vault-form-title"
        borderClass="border-gold/25"
      >
        <h3 id="vault-form-title" className="font-bebas text-2xl tracking-wider text-gold mb-1">
          {editId ? "Edit credential" : "Add credential"}
        </h3>
        <p className="text-xs text-cream/50 mb-4">
          {editId
            ? "Leave the password blank to keep the current one. Entering a new one rotates it."
            : "Stored encrypted at rest. The password is only ever shown again through an audited reveal."}
        </p>

        <label className={fieldLabel}>Label (required)</label>
        <input
          value={form.label}
          onChange={(e) => setField("label", e.target.value)}
          placeholder="e.g. Lionade Instagram"
          maxLength={200}
          className={fieldInput}
        />

        <label className={fieldLabel}>Category</label>
        <input
          value={form.category}
          onChange={(e) => setField("category", e.target.value)}
          placeholder="e.g. social"
          maxLength={100}
          className={fieldInput}
        />

        <label className={fieldLabel}>Login (email or handle)</label>
        <input
          value={form.username}
          onChange={(e) => setField("username", e.target.value)}
          placeholder="e.g. social@getlionade.com"
          maxLength={300}
          autoComplete="off"
          className={fieldInput}
        />

        <label className={fieldLabel}>URL</label>
        <input
          value={form.url}
          onChange={(e) => setField("url", e.target.value)}
          placeholder="https://..."
          maxLength={500}
          className={fieldInput}
        />

        <label className={fieldLabel}>
          {editId ? "New password (leave blank to keep current)" : "Password or secret (required)"}
        </label>
        <div className="relative mb-3">
          <input
            value={form.secret}
            onChange={(e) => setField("secret", e.target.value)}
            type={showSecretInput ? "text" : "password"}
            placeholder={editId ? "Leave blank to keep current" : "Enter the password"}
            maxLength={8000}
            autoComplete="new-password"
            className="w-full px-3 py-2.5 pr-11 rounded-xl bg-white/[0.05] border border-white/10 text-sm text-cream placeholder:text-cream/25 outline-none focus:border-gold/40 font-mono"
          />
          <button
            type="button"
            onClick={() => setShowSecretInput((s) => !s)}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-cream/40 hover:text-cream/70 hover:bg-white/5"
            aria-label={showSecretInput ? "Hide password" : "Show password"}
          >
            {showSecretInput ? (
              <EyeSlash size={16} aria-hidden="true" />
            ) : (
              <Eye size={16} aria-hidden="true" />
            )}
          </button>
        </div>

        <label className={fieldLabel}>Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => setField("notes", e.target.value)}
          placeholder="Anything a teammate needs to know to use this account."
          rows={2}
          maxLength={2000}
          className={`${fieldInput} resize-none`}
        />

        <div className="flex gap-2 mt-1">
          <button
            onClick={closeForm}
            disabled={busy}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={editId ? submitEdit : submitAdd}
            disabled={busy}
            className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: "#04080F",
            }}
          >
            {busy ? "Working..." : editId ? "Save changes" : "Add credential"}
          </button>
        </div>
      </AdminModalShell>

      {/* ── Delete confirm ── */}
      <ConfirmModal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        onConfirm={confirmDelete}
        title="Delete credential?"
        message={
          deleteTarget
            ? `"${deleteTarget.label}" will be permanently removed from the vault. This is logged to the audit trail.`
            : undefined
        }
        confirmLabel="Delete credential"
        destructive
      />

      {/* ── Rotate encryption key (rich explanation + confirm) ── */}
      <AdminModalShell
        open={rotateOpen}
        onClose={() => setRotateOpen(false)}
        busy={rotateBusy}
        labelId="vault-rotate-title"
        borderClass="border-gold/25"
      >
        <h3
          id="vault-rotate-title"
          className="font-bebas text-2xl tracking-wider text-gold mb-1 flex items-center gap-2"
        >
          <Key size={22} weight="fill" className="text-gold" aria-hidden="true" />
          Rotate encryption key
        </h3>
        <p className="text-sm text-cream/60 mb-4">
          This re-encrypts every stored credential under the new key. Do the two
          steps in order.
        </p>

        <ol className="space-y-3 mb-4">
          <li className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[11px] uppercase tracking-wider text-gold font-bold mb-1">
              Step 1: set the environment
            </div>
            <p className="text-sm text-cream/70">
              Set{" "}
              <code className="font-mono text-cream/90 px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 break-all">
                CREDENTIAL_ENCRYPTION_KEY
              </code>{" "}
              to the new key and{" "}
              <code className="font-mono text-cream/90 px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 break-all">
                CREDENTIAL_ENCRYPTION_KEY_PREVIOUS
              </code>{" "}
              to the old key. Both must be present before you run rotation.
            </p>
          </li>
          <li className="rounded-xl border border-white/10 bg-white/[0.04] p-3">
            <div className="text-[11px] uppercase tracking-wider text-gold font-bold mb-1">
              Step 2: run rotation
            </div>
            <p className="text-sm text-cream/70">
              Confirm below. Every secret is decrypted with whichever key still
              works, then re-encrypted under the new key.
            </p>
          </li>
        </ol>

        <div className="rounded-xl border border-electric/25 bg-electric/[0.08] p-3 mb-5 flex gap-2.5">
          <Warning size={18} weight="fill" className="text-electric shrink-0 mt-0.5" aria-hidden="true" />
          <p className="text-xs text-cream/70">
            Safe to re-run. If any rows fail, fix the keys and run it again. No
            secrets are shown or logged during rotation.
          </p>
        </div>

        <div className="flex gap-2">
          <button
            onClick={() => setRotateOpen(false)}
            disabled={rotateBusy}
            className="flex-1 py-3 rounded-xl border border-white/10 text-cream/70 text-sm font-bold hover:bg-white/5 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={confirmRotate}
            disabled={rotateBusy}
            className="flex-1 py-3 rounded-xl text-sm font-bold disabled:opacity-60"
            style={{
              background: "linear-gradient(135deg, #F0B429 0%, #B8960C 50%, #F0B429 100%)",
              color: "#04080F",
            }}
          >
            {rotateBusy ? "Rotating..." : "Rotate now"}
          </button>
        </div>
      </AdminModalShell>
    </div>
  );
}
