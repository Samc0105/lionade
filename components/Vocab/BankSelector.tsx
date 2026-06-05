"use client";

/**
 * BankSelector — horizontal pill row sitting above the Vocab tabs.
 *
 * Each pill is a Word Bank. Click → updates URL `?bank=<slug>`. The active
 * pill gets a brighter border + tinted background using the bank's own color.
 * A trailing "+" button opens the CreateBankModal.
 *
 * Right-click (desktop) OR long-press (touch) on a pill opens a context menu
 * with Rename / Change color / Delete. We deliberately surface delete via an
 * inline kebab on hover too, since long-press discovery is poor on web.
 *
 * Bank selection lives in URL (?bank=) for shareability + browser-back; this
 * component is a controlled view of that URL state.
 */

import { useEffect, useRef, useState } from "react";
import { Plus, DotsThreeVertical, PencilSimple, Palette, Trash, X, Globe, ArrowUUpLeft } from "@phosphor-icons/react";
import { apiDelete, apiPatch } from "@/lib/api-client";
import ConfirmModal from "@/components/ConfirmModal";
import { toastError, toastSuccess } from "@/lib/toast";
import type { VocabBank } from "./CreateBankModal";

const COLOR_PRESETS = [
  { hex: "#4A90D9", label: "electric" },
  { hex: "#FFD700", label: "gold" },
  { hex: "#A855F7", label: "purple" },
  { hex: "#22C55E", label: "green" },
];

interface Props {
  banks: VocabBank[];
  activeSlug: string | null;
  onSelect: (slug: string) => void;
  onCreateClick: () => void;
  onMutated: () => void; // parent re-fetches banks after rename/color/delete
}

export default function BankSelector({ banks, activeSlug, onSelect, onCreateClick, onMutated }: Props) {
  const [menuBankId, setMenuBankId] = useState<string | null>(null);
  const [menuMode, setMenuMode] = useState<"actions" | "rename" | "color">("actions");
  const [renameValue, setRenameValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<VocabBank | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Click-outside / Escape closes the action menu.
  useEffect(() => {
    if (!menuBankId) return;
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuBankId(null);
      }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMenuBankId(null); };
    window.addEventListener("mousedown", onClick);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onClick);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuBankId]);

  const openMenu = (bank: VocabBank) => {
    setMenuBankId(bank.id);
    setMenuMode("actions");
    setRenameValue(bank.name);
  };

  const handleRename = async (bank: VocabBank) => {
    const cleaned = renameValue.trim().slice(0, 50);
    if (!cleaned || cleaned === bank.name || busy) {
      setMenuBankId(null);
      return;
    }
    setBusy(true);
    try {
      const { ok, error } = await apiPatch(`/api/vocab/banks/${bank.id}`, { name: cleaned });
      if (!ok) {
        toastError(error ?? "Couldn't rename that bank.");
        return;
      }
      toastSuccess("Bank renamed.");
      onMutated();
      setMenuBankId(null);
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Rename failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleColorChange = async (bank: VocabBank, color: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const { ok, error } = await apiPatch(`/api/vocab/banks/${bank.id}`, { color });
      if (!ok) {
        toastError(error ?? "Couldn't change color.");
        return;
      }
      onMutated();
      setMenuBankId(null);
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Color update failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleTogglePublic = async (bank: VocabBank) => {
    if (busy) return;
    const nextIsPublic = !bank.is_public;
    setBusy(true);
    try {
      const { ok, error } = await apiPatch(`/api/vocab/banks/${bank.id}`, { is_public: nextIsPublic });
      if (!ok) {
        // Backend handles profanity + 20-bank cap with a specific error string.
        // We surface the server message verbatim (it's already shaped for users
        // per the V3A contract): "Bank name contains language..." → friendly
        // rewrite to the spec copy; "...up to 20 public banks..." → friendly
        // rewrite to the spec copy. Anything else passes through.
        const lower = (error ?? "").toLowerCase();
        if (lower.includes("language we can't publish") || lower.includes("can't be used in public")) {
          toastError("That name can't be used in public banks. Try something else.");
        } else if (lower.includes("public bank") && (lower.includes("up to") || lower.includes("20"))) {
          toastError("You have 20 public banks already. Make one private to publish another.");
        } else {
          toastError(error ?? (nextIsPublic ? "Couldn't publish that bank." : "Couldn't make that bank private."));
        }
        return;
      }
      toastSuccess(
        nextIsPublic
          ? "Bank is now public. Others can clone it."
          : "Bank is private again.",
      );
      onMutated();
      setMenuBankId(null);
    } catch (e: unknown) {
      toastError(e instanceof Error ? e.message : "Publish update failed.");
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = (bank: VocabBank) => {
    if (busy) return;
    setPendingDelete(bank);
  };

  const confirmDelete = async () => {
    if (!pendingDelete || busy) return;
    const bank = pendingDelete;
    setBusy(true);
    try {
      const { ok, error } = await apiDelete(`/api/vocab/banks/${bank.id}`);
      if (!ok) {
        toastError(error ?? "Couldn't delete that bank.");
        throw new Error("delete failed");
      }
      toastSuccess("Bank deleted.");
      setPendingDelete(null);
      onMutated();
      setMenuBankId(null);
    } catch (e: unknown) {
      if (!(e instanceof Error) || !e.message.includes("delete failed")) {
        toastError(e instanceof Error ? e.message : "Delete failed.");
      }
      throw e instanceof Error ? e : new Error("Delete failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative">
      <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-cream/55 mb-2">
        word banks
      </p>
      <div className="flex gap-2 overflow-x-auto pb-1.5">
        {banks.map(bank => {
          const isActive = bank.slug === activeSlug;
          return (
            <div key={bank.id} className="relative shrink-0">
              <button
                type="button"
                onClick={() => onSelect(bank.slug)}
                onContextMenu={e => { e.preventDefault(); openMenu(bank); }}
                className="press-feedback inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 border font-bebas tracking-wider text-sm whitespace-nowrap transition-colors"
                style={{
                  background: isActive
                    ? `linear-gradient(135deg, ${bank.color}28 0%, ${bank.color}10 100%)`
                    : "rgba(255,255,255,0.04)",
                  borderColor: isActive ? `${bank.color}80` : "rgba(255,255,255,0.10)",
                  color: isActive ? "#EEF4FF" : "rgba(238,244,255,0.75)",
                  boxShadow: isActive ? `0 0 12px ${bank.color}30` : "none",
                }}
                aria-pressed={isActive}
              >
                <span aria-hidden="true" className="text-base leading-none">{bank.icon}</span>
                {/* V3A — public + cloned indicators. Render BEFORE the name so
                    the bank's status reads left-to-right with its identity. */}
                {bank.is_public && (
                  <span
                    aria-label="Public bank — others can clone it"
                    title="Public bank — others can clone it"
                    className="inline-flex items-center text-cream/80"
                  >
                    <Globe size={11} weight="bold" aria-hidden="true" />
                  </span>
                )}
                {bank.parent_bank_id && (
                  <span
                    aria-label={bank.parent_username ? `Cloned from ${bank.parent_username}` : "Cloned bank"}
                    title={bank.parent_username ? `Cloned from ${bank.parent_username}` : "Cloned bank"}
                    className="inline-flex items-center text-cream/80"
                  >
                    <ArrowUUpLeft size={11} weight="bold" aria-hidden="true" />
                  </span>
                )}
                <span>{bank.name}</span>
                {bank.kind === "language" && bank.source_lang && bank.target_lang && (
                  <span className="font-mono text-[9px] uppercase tracking-wider opacity-65">
                    {bank.source_lang}/{bank.target_lang}
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  onClick={e => { e.stopPropagation(); openMenu(bank); }}
                  onKeyDown={e => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      e.stopPropagation();
                      openMenu(bank);
                    }
                  }}
                  aria-label={`Edit ${bank.name}`}
                  className="ml-0.5 p-0.5 rounded text-cream/55 hover:text-cream transition-colors cursor-pointer"
                >
                  <DotsThreeVertical size={12} weight="bold" aria-hidden="true" />
                </span>
              </button>

              {/* Context menu */}
              {menuBankId === bank.id && (
                <div
                  ref={menuRef}
                  className="absolute z-30 top-full mt-2 left-0 min-w-[220px] rounded-xl border border-white/10 bg-white/5 backdrop-blur p-2 shadow-2xl"
                  style={{ background: "rgba(12, 16, 32, 0.96)" }}
                >
                  <div className="flex items-center justify-between mb-1.5 px-1">
                    <p className="font-mono text-[9px] uppercase tracking-[0.25em] text-cream/45">
                      {menuMode === "rename" ? "rename" : menuMode === "color" ? "color" : bank.name}
                    </p>
                    <button
                      type="button"
                      onClick={() => setMenuBankId(null)}
                      aria-label="Close menu"
                      className="text-cream/50 hover:text-cream"
                    >
                      <X size={12} weight="bold" aria-hidden="true" />
                    </button>
                  </div>

                  {menuMode === "actions" && (
                    <div className="flex flex-col">
                      <button
                        type="button"
                        onClick={() => setMenuMode("rename")}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-syne text-cream/85 hover:bg-white/10 transition-colors text-left"
                      >
                        <PencilSimple size={14} weight="bold" aria-hidden="true" /> Rename
                      </button>
                      <button
                        type="button"
                        onClick={() => setMenuMode("color")}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-syne text-cream/85 hover:bg-white/10 transition-colors text-left"
                      >
                        <Palette size={14} weight="bold" aria-hidden="true" /> Change color
                      </button>
                      <button
                        type="button"
                        onClick={() => handleTogglePublic(bank)}
                        disabled={busy}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-syne text-cream/85 hover:bg-white/10 transition-colors text-left disabled:opacity-50"
                      >
                        <Globe size={14} weight="bold" aria-hidden="true" />
                        {bank.is_public ? "Make private" : "Make public"}
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(bank)}
                        disabled={busy}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-syne text-red-300 hover:bg-red-400/10 transition-colors text-left disabled:opacity-50"
                      >
                        <Trash size={14} weight="bold" aria-hidden="true" /> Delete bank
                      </button>
                    </div>
                  )}

                  {menuMode === "rename" && (
                    <div className="px-1 pb-1">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={e => setRenameValue(e.target.value.slice(0, 50))}
                        onKeyDown={e => {
                          if (e.key === "Enter") { e.preventDefault(); handleRename(bank); }
                        }}
                        maxLength={50}
                        autoFocus
                        className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-cream placeholder:text-cream/30 font-syne text-sm focus:outline-none focus:border-electric/60"
                      />
                      <div className="flex gap-2 mt-2">
                        <button
                          type="button"
                          onClick={() => setMenuMode("actions")}
                          className="flex-1 px-3 py-1.5 rounded-lg font-syne text-xs bg-white/5 border border-white/10 text-cream/70 hover:bg-white/10"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRename(bank)}
                          disabled={busy || renameValue.trim().length === 0}
                          className="flex-1 px-3 py-1.5 rounded-lg font-syne font-bold text-xs bg-electric text-navy hover:bg-electric/90 disabled:opacity-40"
                        >
                          {busy ? "..." : "Save"}
                        </button>
                      </div>
                    </div>
                  )}

                  {menuMode === "color" && (
                    <div className="px-1 pb-1">
                      <div className="flex gap-2 flex-wrap">
                        {COLOR_PRESETS.map(c => (
                          <button
                            key={c.hex}
                            type="button"
                            onClick={() => handleColorChange(bank, c.hex)}
                            disabled={busy}
                            aria-label={`Pick ${c.label}`}
                            className="w-8 h-8 rounded-full transition-transform hover:scale-110 disabled:opacity-50"
                            style={{
                              background: c.hex,
                              boxShadow: bank.color === c.hex ? "0 0 0 2px rgba(255,255,255,0.85)" : "none",
                              outline: "1px solid rgba(255,255,255,0.1)",
                            }}
                          />
                        ))}
                      </div>
                      <button
                        type="button"
                        onClick={() => setMenuMode("actions")}
                        className="mt-2 w-full px-3 py-1.5 rounded-lg font-syne text-xs bg-white/5 border border-white/10 text-cream/70 hover:bg-white/10"
                      >
                        Back
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* Add-bank "+" pill */}
        <button
          type="button"
          onClick={onCreateClick}
          className="press-feedback shrink-0 inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 border border-dashed border-white/20 bg-white/[0.02] text-cream/70 hover:bg-white/[0.06] hover:border-gold/40 hover:text-gold transition-colors font-syne font-bold text-xs"
          aria-label="Create a new word bank"
        >
          <Plus size={14} weight="bold" aria-hidden="true" />
          <span>New bank</span>
        </button>
      </div>
      <ConfirmModal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => { await confirmDelete(); }}
        title="Delete this bank?"
        message={pendingDelete ? `Every word inside "${pendingDelete.name}" will be removed. This can't be undone.` : undefined}
        confirmLabel="Delete bank"
        destructive
      />
    </div>
  );
}
