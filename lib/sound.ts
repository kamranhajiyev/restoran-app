// Order alerts for the kitchen and bar, for venues whose station printers are
// not (yet) wired up: staff hear the order instead of reading a ticket.
//
// Tones are synthesized rather than loaded from .mp3 files — no binary assets,
// nothing to 404, and no decode step before the first beep.

let ctx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  return ctx;
}

// Browsers refuse to produce sound until the user has interacted with the page.
// A kitchen tablet sitting untouched on a shelf would stay silent forever, so
// the UI must call this from a real click — see the "Səsi aktivləşdir" banner.
export async function unlockSound(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch { return false; }
  }
  return c.state === 'running';
}

export function isSoundUnlocked(): boolean {
  return ctx?.state === 'running';
}

// One note. `type` shapes the timbre: a triangle reads as a friendly chime,
// a square as a blunt alert.
function tone(startAt: number, freq: number, durationMs: number, type: OscillatorType, gain: number) {
  const c = getCtx();
  if (!c) return;
  const osc = c.createOscillator();
  const amp = c.createGain();
  const dur = durationMs / 1000;

  osc.type = type;
  osc.frequency.setValueAtTime(freq, startAt);

  // A hard start/stop on a square wave clicks. Ramp both ends.
  amp.gain.setValueAtTime(0, startAt);
  amp.gain.linearRampToValueAtTime(gain, startAt + 0.012);
  amp.gain.setValueAtTime(gain, startAt + dur - 0.03);
  amp.gain.linearRampToValueAtTime(0, startAt + dur);

  osc.connect(amp).connect(c.destination);
  osc.start(startAt);
  osc.stop(startAt + dur);
}

// New order: a bright rising two-note chime. Reads as "something arrived".
export function playNewOrder(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  tone(t,         880, 130, 'triangle', 0.30);   // A5
  tone(t + 0.13, 1319, 260, 'triangle', 0.30);   // E6
}

// Item removed: a low descending double-beep. Deliberately nothing like the
// new-order chime — staff must be able to tell them apart without looking.
export function playItemRemoved(): void {
  const c = getCtx();
  if (!c || c.state !== 'running') return;
  const t = c.currentTime;
  tone(t,        440, 150, 'square', 0.22);   // A4
  tone(t + 0.20, 294, 300, 'square', 0.22);   // D4
}
