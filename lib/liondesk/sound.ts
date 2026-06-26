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
