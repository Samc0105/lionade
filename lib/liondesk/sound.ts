// Tiny Web Audio sound kit for LionDesk. No audio files: every sound is a short
// synthesized envelope, so it's zero-asset and zero-API. Respects a mute pref
// in localStorage. The browser only allows audio after a user gesture, so call
// resumeAudio() on the first interaction.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    try {
      ctx = new AC();
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const MUTE_KEY = "lionade.liondesk.muted";

export function isMuted(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(MUTE_KEY) === "1";
}

export function setMuted(m: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
  } catch {
    /* ignore */
  }
}

/** Resume the audio context. Call from a user-gesture handler so later
 *  timer-driven sounds (arrivals, breaches) are allowed to play. */
export function resumeAudio(): void {
  getCtx();
}

function beep(freq: number, durMs: number, type: OscillatorType = "sine", gain = 0.05, whenOffset = 0): void {
  const c = getCtx();
  if (!c || isMuted()) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + whenOffset;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + durMs / 1000);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + durMs / 1000 + 0.02);
}

export function playArrival(): void {
  beep(660, 110, "triangle", 0.04);
}

export function playResolve(): void {
  beep(880, 80, "sine", 0.05);
  beep(1175, 120, "sine", 0.05, 0.08);
}

export function playBreach(): void {
  beep(196, 220, "sawtooth", 0.045);
}

export function playWin(): void {
  [523, 659, 784, 1047].forEach((f, i) => beep(f, 150, "sine", 0.05, i * 0.12));
}

/** A botched, catastrophic call (a "mishandled" ticket). A descending buzz. */
export function playFail(): void {
  beep(160, 180, "sawtooth", 0.05);
  beep(120, 240, "sawtooth", 0.05, 0.1);
}

/** Clocking in: a short rising "ready" chime. */
export function playClockIn(): void {
  beep(440, 90, "sine", 0.05);
  beep(660, 150, "sine", 0.05, 0.09);
}

/** A stockroom part arrived: a soft two-note doorbell. */
export function playDelivery(): void {
  beep(720, 70, "triangle", 0.045);
  beep(960, 120, "triangle", 0.045, 0.07);
}

/** A resolve-streak milestone: a bright ascending triad. */
export function playStreak(): void {
  [784, 988, 1319].forEach((f, i) => beep(f, 110, "sine", 0.045, i * 0.07));
}

// ── Night Shift atmosphere ──────────────────────────────────────────────────

let drone: { osc: OscillatorNode; sub: OscillatorNode; gain: GainNode } | null = null;

/** Start the low ambient server-room hum (idempotent). */
export function startAmbient(): void {
  const c = getCtx();
  if (!c || isMuted() || drone) return;
  const osc = c.createOscillator();
  const sub = c.createOscillator();
  const gain = c.createGain();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  sub.type = "sine";
  sub.frequency.value = 27.5;
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.02, c.currentTime + 1.2);
  osc.connect(gain);
  sub.connect(gain);
  gain.connect(c.destination);
  osc.start();
  sub.start();
  drone = { osc, sub, gain };
}

/** Raise the dread as the threat nears the core (level 0..1). */
export function setAmbientTension(level: number): void {
  const c = getCtx();
  if (!drone || !c) return;
  const l = Math.max(0, Math.min(1, level));
  drone.osc.frequency.setTargetAtTime(55 + l * 45, c.currentTime, 0.4);
  drone.gain.gain.setTargetAtTime(0.02 + l * 0.035, c.currentTime, 0.4);
}

export function stopAmbient(): void {
  const c = getCtx();
  if (!drone || !c) return;
  try {
    drone.gain.gain.cancelScheduledValues(c.currentTime);
    drone.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.25);
    drone.osc.stop(c.currentTime + 0.6);
    drone.sub.stop(c.currentTime + 0.6);
  } catch {
    /* ignore */
  }
  drone = null;
}

/** Alarm when the threat advances a step. */
export function playAlarm(): void {
  beep(880, 130, "square", 0.05);
  beep(660, 170, "square", 0.05, 0.14);
}

/** Confirmation when you contain the threat on the right feed. */
export function playContain(): void {
  beep(520, 70, "sine", 0.05);
  beep(820, 100, "sine", 0.05, 0.07);
}

/** The breach jump-scare stinger. */
export function playStinger(): void {
  beep(150, 450, "sawtooth", 0.09);
  beep(95, 650, "sawtooth", 0.09, 0.04);
  beep(70, 800, "square", 0.07, 0.08);
}

// ── LionDesk help desk ambience + event cues ────────────────────────────────
// The help desk runs its own calm office hum, kept separate from the Night Shift
// server-room drone above so the two games never share or fight over a single
// oscillator. It is a soft low sine with a faint fluorescent overtone, much
// gentler than the breach-room dread. Like every cue here it is gated through
// getCtx + isMuted, so it stays silent when muted and never starts before the
// first user gesture has resumed the audio context.

let deskHum: { low: OscillatorNode; air: OscillatorNode; gain: GainNode } | null = null;

/** Start the calm help desk office hum (idempotent). */
export function startDeskHum(): void {
  const c = getCtx();
  if (!c || isMuted() || deskHum) return;
  const low = c.createOscillator();
  const air = c.createOscillator();
  const gain = c.createGain();
  const airGain = c.createGain();
  low.type = "sine";
  low.frequency.value = 60;
  air.type = "triangle";
  air.frequency.value = 120;
  airGain.gain.value = 0.18; // the overtone sits well under the low hum
  gain.gain.setValueAtTime(0.0001, c.currentTime);
  gain.gain.linearRampToValueAtTime(0.013, c.currentTime + 1.4); // tasteful, low
  low.connect(gain);
  air.connect(airGain);
  airGain.connect(gain);
  gain.connect(c.destination);
  low.start();
  air.start();
  deskHum = { low, air, gain };
}

/** Stop the help desk hum (fades out so it never clicks off). */
export function stopDeskHum(): void {
  const c = getCtx();
  if (!deskHum || !c) return;
  try {
    deskHum.gain.gain.cancelScheduledValues(c.currentTime);
    deskHum.gain.gain.setTargetAtTime(0.0001, c.currentTime, 0.3);
    deskHum.low.stop(c.currentTime + 0.7);
    deskHum.air.stop(c.currentTime + 0.7);
  } catch {
    /* ignore */
  }
  deskHum = null;
}

/** A ticket escalated up the chain (handed to a higher tier or a manager): a
 *  short, neutral two-note rise that reads as "passing it on," distinct from the
 *  resolve chime so the player hears the difference. */
export function playEscalate(): void {
  beep(494, 90, "triangle", 0.045); // B4
  beep(740, 140, "triangle", 0.045, 0.08); // F sharp 5
}

/** Bridge Pressure crossed into a new tension stage (1..3). A rising interval
 *  that gets brighter and sharper the higher the stage, so the spikes feel like
 *  the room heating up. Kept short and tasteful, never a wall of sound. */
export function playBridgeSpike(stage: number): void {
  const s = Math.max(1, Math.min(3, Math.round(stage)));
  const base = 300 + (s - 1) * 45;
  const top = base * (1 + 0.16 * s);
  const type: OscillatorType = s >= 3 ? "sawtooth" : "square";
  beep(base, 120, type, 0.04);
  beep(top, 150 + s * 20, type, 0.04, 0.1);
}

/** Career promotion fanfare for the TechHub Saga promotion moment: a bright
 *  five-note gold flourish, grander than the per-shift win chime. Cosmetic, and
 *  gated + mute-aware like the rest of the kit. Consumed by the promotion overlay
 *  (components/liondesk/PromotionMoment.tsx) when a new title is crossed. */
export function playPromotion(): void {
  [523, 659, 784, 1047, 1319].forEach((f, i) => beep(f, 180, "sine", 0.05, i * 0.1));
}
