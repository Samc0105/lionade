"use client";

import { useEffect, useMemo, useState } from "react";
import { Storefront, Palette, Crown, Medal, Sparkle, LockSimple, CheckCircle } from "@phosphor-icons/react";
import { cdnUrl } from "@/lib/cdn";
import {
  shopCatalog,
  getShopView,
  equipShopEntry,
  type CosmeticKind,
  type ShopEntry,
  type ShopEntryView,
} from "@/lib/liondesk/shop";

// The four cosmetic groups, in display order: the earned cosmetics first (themes
// you can equip, then titles and badges you collect), then the preview priced
// future Fang sink last. Each carries its own accent and section icon.
const GROUPS: { kind: CosmeticKind; heading: string; blurb: string; icon: typeof Palette; color: string }[] = [
  { kind: "theme", heading: "Desk themes", blurb: "Equip any theme you have earned. Equipping is free, it never spends Fangs.", icon: Palette, color: "#FFD700" },
  { kind: "title", heading: "Track titles", blurb: "Top of ladder titles, earned by completing a whole career track.", icon: Crown, color: "#C9A2F2" },
  { kind: "badge", heading: "Quest badges", blurb: "Collectible badges, earned by clearing daily and weekly quests.", icon: Medal, color: "#4A90D9" },
  { kind: "preview", heading: "Coming soon", blurb: "A preview of paid cosmetics. Prices are illustrative and go live with the economy.", icon: Sparkle, color: "#F87171" },
];

export default function Shop() {
  // localStorage owned state only exists on the client. Read after mount to avoid
  // a hydration mismatch; before mount the cards render their static names with
  // neutral state (no flash of an all locked, zero balance gallery).
  const [mounted, setMounted] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    setMounted(true);
    const onFocus = () => setVersion((v) => v + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // The static catalog (SSR safe) gives every card its shape and name before
  // mount. The resolved view (owned / equipped / affordable + the preview Fang
  // balance) is read only after mount, keyed on `version` so the on focus refresh
  // re evaluates it (e.g. after earning a cosmetic on another route).
  const catalog = useMemo(() => shopCatalog(), []);
  const view = useMemo(() => (mounted ? getShopView() : null), [mounted, version]);
  const byId = useMemo(() => {
    const m = new Map<string, ShopEntryView>();
    if (view) for (const e of view.entries) m.set(e.id, e);
    return m;
  }, [view]);

  function equip(entry: ShopEntry) {
    equipShopEntry(entry);
    setVersion((v) => v + 1);
  }

  return (
    <div className="space-y-6">
      {/* Preview Fang balance + the honest coming soon note. Mount guarded so the
          balance never flashes a zero before localStorage is read. */}
      <div
        className="rounded-2xl p-4 sm:p-5"
        style={{ background: "linear-gradient(135deg, rgba(255,215,0,0.10) 0%, rgba(168,85,247,0.06) 55%, rgba(12,16,32,0.95) 100%)", border: "1px solid rgba(255,215,0,0.22)" }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Storefront size={18} weight="fill" color="#FFD700" aria-hidden="true" />
            <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">YOUR COLLECTION</h2>
          </div>
          <span className="font-mono text-[10px] tabular-nums text-cream/55">
            {mounted && view ? `${view.ownedCount}/${view.totalCount} owned` : "…/… owned"}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-gold/25 bg-gold/[0.05] px-3 py-2.5">
          <img src={cdnUrl("/F.png")} alt="Fangs" className="w-7 h-7 object-contain shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold/90">preview balance</p>
            <p className="font-bebas text-2xl text-cream tabular-nums leading-none mt-0.5">
              {mounted && view ? `${view.balance.toLocaleString()} Fangs` : "… Fangs"}
            </p>
          </div>
        </div>

        <p className="text-cream/55 text-[11px] leading-relaxed mt-3">
          Spending goes live with the economy. For now the shop is a preview: equip any cosmetic you have
          already earned, browse what is coming, and nothing is ever bought or spent. Your balance above is
          a preview of the Fangs you have earned, not a live wallet.
        </p>
      </div>

      {/* One section per cosmetic group. */}
      {GROUPS.map((group) => {
        const Icon = group.icon;
        const items = catalog.filter((e) => e.kind === group.kind);
        return (
          <section key={group.kind}>
            <div className="flex items-center gap-2 mb-1">
              <Icon size={18} weight="fill" color={group.color} aria-hidden="true" />
              <h2 className="font-bebas text-xl text-cream tracking-wider leading-none">{group.heading.toUpperCase()}</h2>
            </div>
            <p className="text-cream/55 text-[11px] mb-3">{group.blurb}</p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {items.map((entry) => {
                const v = byId.get(entry.id);
                const owned = mounted && !!v?.owned;
                const equipped = mounted && !!v?.equipped;
                const dim = mounted && entry.kind !== "preview" && !owned;
                return (
                  <div
                    key={entry.id}
                    className={`rounded-xl border p-3 transition-colors ${dim ? "opacity-60" : ""}`}
                    style={{
                      borderColor: owned || equipped ? `${entry.color}55` : "rgba(255,255,255,0.08)",
                      background: owned || equipped ? `${entry.color}10` : "rgba(255,255,255,0.02)",
                    }}
                  >
                    <div className="flex items-start gap-2.5">
                      {/* Swatch / lock. Mount guarded so the locked vs owned glyph
                          never flips after hydration. */}
                      <div className="flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${entry.color}16`, border: `1px solid ${entry.color}3a` }}>
                        {!mounted ? (
                          <span className="w-3.5 h-3.5 rounded-sm bg-white/10 motion-safe:animate-pulse" aria-hidden="true" />
                        ) : owned ? (
                          <CheckCircle size={18} weight="fill" color={entry.color} aria-hidden="true" />
                        ) : entry.kind === "preview" ? (
                          <Sparkle size={17} weight="fill" color={entry.color} aria-hidden="true" />
                        ) : (
                          <LockSimple size={16} weight="fill" color="#6B7280" aria-hidden="true" />
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-syne font-semibold text-sm text-cream truncate">{entry.name}</p>
                          {equipped && (
                            <span className="font-mono text-[8px] uppercase tracking-wider px-1.5 py-0.5 rounded" style={{ color: entry.color, background: `${entry.color}1a`, border: `1px solid ${entry.color}40` }}>
                              equipped
                            </span>
                          )}
                          {entry.kind === "preview" && (
                            <span className="font-mono text-[8px] uppercase tracking-[0.15em] px-1.5 py-0.5 rounded bg-red-500/15 text-red-300 border border-red-500/30">
                              soon
                            </span>
                          )}
                        </div>
                        <p className="text-cream/55 text-[11px] mt-1 leading-snug">{entry.desc}</p>

                        {/* Footer: unlock hint, price (preview), or equip control. */}
                        <div className="flex items-center gap-2 mt-2 flex-wrap">
                          {entry.kind === "preview" && entry.priceFangs !== undefined ? (
                            <>
                              <span className="inline-flex items-center gap-1 font-mono text-[11px] tabular-nums px-1.5 py-0.5 rounded" style={{ color: entry.color, background: `${entry.color}14`, border: `1px solid ${entry.color}3a` }}>
                                <img src={cdnUrl("/F.png")} alt="Fangs" className="w-3.5 h-3.5 object-contain" />
                                {entry.priceFangs.toLocaleString()}
                              </span>
                              <span className="font-mono text-[9px] text-cream/40">
                                {mounted && v?.affordable ? "within your preview balance" : "preview price, not for sale yet"}
                              </span>
                            </>
                          ) : entry.kind === "theme" && owned ? (
                            equipped ? (
                              <span className="font-mono text-[10px] text-cream/45">In use</span>
                            ) : (
                              <button
                                onClick={() => equip(entry)}
                                className="font-mono text-[11px] px-2.5 py-1 rounded-md border transition-colors hover:bg-white/[0.06]"
                                style={{ borderColor: `${entry.color}55`, color: entry.color }}
                              >
                                Equip
                              </button>
                            )
                          ) : owned ? (
                            <span className="font-mono text-[10px]" style={{ color: entry.color }}>Earned</span>
                          ) : !mounted ? (
                            <span className="font-mono text-[10px] text-cream/35" aria-hidden="true">…</span>
                          ) : (
                            <span className="font-mono text-[9px] text-cream/40 leading-snug">{entry.unlockHint}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}

      {/* Honesty note: the economy is server authoritative. */}
      <p className="font-mono text-[10px] text-cream/35 leading-relaxed">
        The shop is a preview. Equipping a theme is a local preference and costs nothing. No Fangs are
        granted or spent here. Real spending arrives once the Fang economy goes live on the server, so the
        economy stays tamper proof.
      </p>
    </div>
  );
}
