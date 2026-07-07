"use client";

import { useEffect, useState } from "react";
import { ArrowLeft, FloppyDisk, Trash, Lightning, Shuffle, Flask, ShareNetwork, DeviceMobile, LinkSimple, WarningOctagon, Brain, type Icon } from "@phosphor-icons/react";
import LionDesk from "@/components/liondesk/LionDesk";
import { generateShift, generateAdaptiveShift, adaptiveTuning, MODIFIERS, type GenerateOpts } from "@/lib/liondesk/generate";
import { getCombos, saveCombo, deleteCombo, type SavedCombo } from "@/lib/liondesk/savedCombos";
import { encodeCombo, decodeCombo } from "@/lib/liondesk/combocode";
import { recordShiftResult } from "@/lib/liondesk/stats";
import { recordShiftConcepts, getWeakestConcepts, getRecentGrades } from "@/lib/liondesk/conceptMastery";
import { recordPlayDay } from "@/lib/liondesk/playstreak";
import AchievementBanner from "@/components/liondesk/AchievementBanner";
import type { Shift } from "@/lib/liondesk/types";
import type { State } from "@/lib/liondesk/engine";
import type { Track } from "@/lib/helpdesk/types";

type TrackSel = Track | "any";
const TRACK_OPTS: { id: TrackSel; label: string }[] = [
  { id: "any", label: "Any" },
  { id: "helpdesk", label: "IT" },
  { id: "soc", label: "SOC" },
  { id: "swe", label: "SWE" },
  { id: "redteam", label: "Red Team" },
];

// The behavior mutators (Idea 13). Each reshapes how the shift plays: a phone
// heavy switchboard, a cascade of chained tickets, or a time compressed crisis.
// They also appear as regular checkboxes in the grid below; this row is a one tap
// launch that builds a shift around a single behavior, at the current track and
// ticket count. The label and description are read straight from MODIFIERS so the
// copy lives in exactly one place.
const BEHAVIOR_PRESETS: { id: string; Icon: Icon; tint: string }[] = [
  { id: "callerstorm", Icon: DeviceMobile, tint: "#4A90D9" },
  { id: "chainreaction", Icon: LinkSimple, tint: "#A855F7" },
  { id: "codered", Icon: WarningOctagon, tint: "#EF4444" },
];

export default function MutatorLab() {
  const [track, setTrack] = useState<TrackSel>("any");
  const [count, setCount] = useState(6);
  const [enabled, setEnabled] = useState<string[]>([]);
  const [combos, setCombos] = useState<SavedCombo[]>([]);
  const [name, setName] = useState("");
  const [shift, setShift] = useState<Shift | null>(null);
  const [lastOpts, setLastOpts] = useState<GenerateOpts>({});
  const [runKey, setRunKey] = useState(0);
  const [copied, setCopied] = useState(false);
  const [codeInput, setCodeInput] = useState("");
  // Inline rejection notice for "Load code" — decodeCombo returns null on a
  // typo or truncated paste, and a silent no-op reads as a dead button.
  const [codeError, setCodeError] = useState<string | null>(null);
  const [newAch, setNewAch] = useState<string[]>([]);
  // One-line summary of what the adaptive generator decided for the current run,
  // shown in the playing view. Null for every non-adaptive launch.
  const [adaptiveNote, setAdaptiveNote] = useState<string | null>(null);

  useEffect(() => { setCombos(getCombos()); }, []);

  const trackOpt = (): Track | undefined => (track === "any" ? undefined : track);
  function play(opts: GenerateOpts) {
    setAdaptiveNote(null);
    setLastOpts(opts);
    setShift(generateShift(opts));
    setRunKey((k) => k + 1);
  }
  // Adaptive launch (Idea 28): bias the queue toward the player's weakest concepts
  // and nudge size and SLA pressure from their recent grades. Both signals are read
  // from local stores on click (never at first paint, so there is no flash of
  // zero), and a fresh draw is rolled each launch and each replay.
  function playAdaptive() {
    const weakConcepts = getWeakestConcepts(3);
    const recentGrades = getRecentGrades();
    setAdaptiveNote(adaptiveTuning(recentGrades, count).summary);
    setShift(generateAdaptiveShift({ track: trackOpt(), count, weakConcepts, recentGrades, name: "Adaptive Shift" }));
    setRunKey((k) => k + 1);
  }
  function toggle(id: string) {
    setEnabled((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  }
  function doSave() {
    const n = name.trim();
    if (!n) return;
    setCombos(saveCombo({ name: n, track: trackOpt(), count, modifierIds: enabled }));
    setName("");
  }
  function loadCombo(c: SavedCombo) {
    setTrack(c.track ?? "any");
    setCount(c.count);
    setEnabled(c.modifierIds);
  }
  function shareCombo() {
    const code = encodeCombo({ track: trackOpt(), count, modifierIds: enabled });
    const url = `${window.location.origin}/learn/techhub/surprise?combo=${code}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => {});
    }
  }
  function loadFromCode() {
    const raw = codeInput.trim();
    if (!raw) return;
    const code = raw.includes("combo=") ? raw.split("combo=")[1].split("&")[0] : raw;
    const c = decodeCombo(code);
    if (c) {
      setTrack(c.track ?? "any"); setCount(c.count); setEnabled(c.modifierIds); setCodeInput(""); setCodeError(null);
    } else {
      setCodeError("That code did not decode. Check you copied the whole link.");
    }
  }

  /* ── playing ── */
  if (shift) {
    return (
      <div className="space-y-3">
        <button onClick={() => setShift(null)} className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.18em] text-cream/55 hover:text-[#C9A2F2] transition-colors">
          <ArrowLeft size={14} weight="bold" aria-hidden="true" /> back to the lab
        </button>
        <AchievementBanner ids={newAch} />
        {adaptiveNote && (
          <div className="rounded-lg border border-[#A855F7]/30 bg-[#A855F7]/[0.08] px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-[#C9A2F2] mb-0.5">adaptive</p>
            <p className="text-cream/70 text-[12px] leading-snug">{adaptiveNote}</p>
          </div>
        )}
        {shift.modifiers && shift.modifiers.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45">modifiers</span>
            {shift.modifiers.map((m) => (
              <span key={m.id} title={m.desc} className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ background: "rgba(168,85,247,0.15)", color: "#C9A2F2", border: "1px solid rgba(168,85,247,0.35)" }}>{m.label}</span>
            ))}
          </div>
        )}
        <LionDesk key={`${shift.id}-${runKey}`} shift={shift} onComplete={(r, state: State) => { recordPlayDay(); recordShiftConcepts(shift, state); setNewAch(recordShiftResult(shift, r)); }} onReplay={() => (shift.id.startsWith("adaptive-") ? playAdaptive() : play(lastOpts))} onExit={() => setShift(null)} />
      </div>
    );
  }

  /* ── builder ── */
  const seg = (active: boolean) => `px-3 py-1.5 rounded-md font-mono text-[11px] border transition-colors ${active ? "border-[#A855F7]/70 bg-[#A855F7]/15 text-cream" : "border-white/12 text-cream/60 hover:bg-white/[0.05]"}`;

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] p-5 space-y-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">track</p>
          <div className="flex gap-2 flex-wrap">{TRACK_OPTS.map((t) => <button key={t.id} className={seg(track === t.id)} onClick={() => setTrack(t.id)}>{t.label}</button>)}</div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">tickets</p>
          <div className="flex items-center gap-3">
            <button onClick={() => setCount((c) => Math.max(4, c - 1))} className="w-8 h-8 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06]">−</button>
            <span className="font-bebas text-2xl text-cream tabular-nums w-8 text-center">{count}</span>
            <button onClick={() => setCount((c) => Math.min(9, c + 1))} className="w-8 h-8 rounded-md border border-white/15 text-cream/70 hover:bg-white/[0.06]">+</button>
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">modifiers</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {MODIFIERS.map((m) => {
              const on = enabled.includes(m.id);
              return (
                <button key={m.id} onClick={() => toggle(m.id)} className={`text-left rounded-lg border p-2.5 transition-colors ${on ? "border-[#A855F7]/60 bg-[#A855F7]/10" : "border-white/[0.08] hover:bg-white/[0.04]"}`}>
                  <div className="flex items-center gap-2">
                    <span className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center ${on ? "bg-[#A855F7] border-[#A855F7]" : "border-white/25"}`}>{on && <span className="text-[#04060c] text-[9px] font-bold leading-none">✓</span>}</span>
                    <span className="text-cream text-sm font-semibold">{m.label}</span>
                  </div>
                  <p className="text-cream/50 text-[11px] mt-1 leading-snug">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">behavior shifts</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {BEHAVIOR_PRESETS.map(({ id, Icon, tint }) => {
              const m = MODIFIERS.find((x) => x.id === id);
              if (!m) return null;
              return (
                <button key={id} onClick={() => play({ track: trackOpt(), count, modifierIds: [id], name: m.label })} className="text-left rounded-lg border p-2.5 transition-colors hover:bg-white/[0.04]" style={{ borderColor: `${tint}55` }}>
                  <div className="flex items-center gap-2">
                    <Icon size={16} weight="fill" color={tint} aria-hidden="true" />
                    <span className="text-cream text-sm font-semibold">{m.label}</span>
                  </div>
                  <p className="text-cream/50 text-[11px] mt-1 leading-snug">{m.desc}</p>
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-1.5">adaptive</p>
          <button onClick={playAdaptive} className="w-full text-left rounded-lg border p-2.5 transition-colors hover:bg-white/[0.04]" style={{ borderColor: "#A855F755" }}>
            <div className="flex items-center gap-2">
              <Brain size={16} weight="fill" color="#C9A2F2" aria-hidden="true" />
              <span className="text-cream text-sm font-semibold">Adaptive shift</span>
            </div>
            <p className="text-cream/50 text-[11px] mt-1 leading-snug">Tunes to you. Biases the queue toward your weak concepts and nudges size and SLA pressure from your recent grades, to keep you in the productive struggle range.</p>
          </button>
        </div>

        <div className="flex gap-2 flex-wrap pt-1">
          <button onClick={() => play({ track: trackOpt(), count, modifierIds: enabled, name: "Lab Shift" })} className="px-5 py-2.5 min-h-[44px] rounded-xl font-bold text-sm text-[#04060c] inline-flex items-center gap-2" style={{ background: "linear-gradient(135deg,#A855F7,#4A90D9)" }}>
            <Lightning size={16} weight="fill" /> Build it
          </button>
          <button onClick={() => play({ track: trackOpt(), count, name: "Surprise Shift" })} className="px-4 py-2.5 rounded-xl border border-white/15 text-cream/80 text-sm hover:bg-white/[0.06] inline-flex items-center gap-2">
            <Shuffle size={15} weight="fill" /> Roll random
          </button>
          <button onClick={() => play({ track: trackOpt(), count, chaos: true, name: "Chaos Shift" })} className="px-4 py-2.5 rounded-xl border border-red-500/35 text-red-200/85 text-sm hover:bg-red-500/10 inline-flex items-center gap-2">
            <Flask size={15} weight="fill" /> Chaos
          </button>
          <button onClick={shareCombo} className="px-4 py-2.5 rounded-xl border border-white/15 text-cream/70 text-sm hover:bg-white/[0.06] inline-flex items-center gap-2">
            <ShareNetwork size={15} weight="fill" /> {copied ? "Link copied" : "Share combo"}
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1 border-t border-white/[0.06]">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="name this combo..." maxLength={28} className="flex-1 bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/30 focus:outline-none" />
          <button onClick={doSave} disabled={!name.trim()} className="px-3 py-2 rounded-lg border border-white/15 text-cream/75 text-sm hover:bg-white/[0.06] disabled:opacity-40 inline-flex items-center gap-1.5"><FloppyDisk size={14} weight="fill" /> Save</button>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <input value={codeInput} onChange={(e) => { setCodeInput(e.target.value); setCodeError(null); }} placeholder="paste a shared combo code or link..." className="flex-1 bg-black/20 border border-white/[0.08] rounded-lg px-3 py-2 text-sm text-cream placeholder:text-cream/30 focus:outline-none" />
            <button onClick={loadFromCode} disabled={!codeInput.trim()} className="px-3 py-2 rounded-lg border border-white/15 text-cream/75 text-sm hover:bg-white/[0.06] disabled:opacity-40">Load code</button>
          </div>
          {codeError && (
            <p role="alert" className="mt-1.5 font-mono text-[11px] text-red-300/90">{codeError}</p>
          )}
        </div>
      </div>

      {combos.length > 0 && (
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-cream/45 mb-2">saved combos</p>
          <ul className="space-y-2">
            {combos.map((c) => (
              <li key={c.name} className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
                <div className="flex-1 min-w-0">
                  <p className="font-syne font-semibold text-sm text-cream truncate">{c.name}</p>
                  <p className="font-mono text-[10px] text-cream/45 truncate">{(c.track ?? "any")} · {c.count} tickets · {c.modifierIds.length ? c.modifierIds.map((id) => MODIFIERS.find((m) => m.id === id)?.label ?? id).join(", ") : "no modifiers"}</p>
                </div>
                <button onClick={() => loadCombo(c)} className="px-2.5 py-1 rounded-md border border-white/15 text-cream/70 text-[11px] hover:bg-white/[0.06]">Load</button>
                <button onClick={() => play({ track: c.track, count: c.count, modifierIds: c.modifierIds, name: c.name })} className="px-2.5 py-1 rounded-md border border-[#A855F7]/40 text-[#C9A2F2] text-[11px] hover:bg-[#A855F7]/10">Play</button>
                <button onClick={() => setCombos(deleteCombo(c.name))} aria-label="Delete combo" className="w-7 h-7 rounded-md border border-white/15 text-cream/50 hover:text-red-300 hover:bg-white/[0.06] flex items-center justify-center"><Trash size={13} /></button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
