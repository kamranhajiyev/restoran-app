// Order alerts for the kitchen and bar, for venues whose station printers are
// not (yet) wired up: staff hear the order instead of reading a ticket.
//
// Tones are synthesized rather than loaded from .mp3 files — no binary assets,
// nothing to 404, and no decode step before the first beep.

let ctx: AudioContext | null = null;

// iOS suspends — or worse, *interrupts* — the context when the screen locks or the
// app is backgrounded. `interrupted` marks that we came back from such a state and
// must verify the engine is genuinely alive before trusting it (see `revive`).
let interrupted = false;
let wired = false;

// Notice the moments that break audio: the tab going hidden (lock / app-switch) and
// the context itself dropping out of 'running'. Both mean the next beep can't be
// trusted until revived. Wired once, lazily, the first time a context exists.
function wire() {
  if (wired || typeof document === 'undefined') return;
  wired = true;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') interrupted = true;
  });
}

function getCtx(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!ctx) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    ctx.onstatechange = () => { if (ctx && ctx.state !== 'running') interrupted = true; };
  }
  wire();
  return ctx;
}

// Throw the current context away so getCtx() builds a fresh one. iOS can leave a
// context reporting state 'running' while its clock is frozen and no sound ever
// comes out; the only cure is a brand-new context.
function rebuild() {
  const old = ctx;
  ctx = null;
  if (old) { try { old.close(); } catch { /* already gone */ } }
}

// True only if the audio clock actually moves. A healthy context advances
// currentTime; the frozen-but-'running' iOS zombie does not. Costs ~60ms, so it
// runs only on the revive path, never before an ordinary foreground beep.
function clockAdvancing(c: AudioContext): Promise<boolean> {
  const t0 = c.currentTime;
  return new Promise(res => setTimeout(() => res(c.currentTime > t0), 60));
}

// Bring audio back after an interruption. Resume if suspended, then prove the clock
// is running; if it isn't, discard the zombie and build a fresh, resumed context.
async function revive(c: AudioContext): Promise<AudioContext | null> {
  if (c.state !== 'running') {
    try { await c.resume(); } catch { /* fall through to rebuild */ }
  }
  if (c.state === 'running' && await clockAdvancing(c)) {
    interrupted = false;
    return c;
  }
  rebuild();
  const fresh = getCtx();
  if (!fresh) return null;
  if (fresh.state !== 'running') {
    try { await fresh.resume(); } catch { return null; }
  }
  interrupted = false;
  return fresh.state === 'running' ? fresh : null;
}

// resume() on a context the browser has autoplay-blocked does not reject — Chrome
// simply leaves the promise pending until an activation it may never get. Unbounded,
// that hangs `unlocking` below forever and every later caller inherits the hang, which
// is precisely how the "Səsi aktivləşdir" button became a button that does nothing.
// A revive that has not landed in three seconds is a revive that isn't coming: well
// clear of the 60ms clock probe plus a resume, and short enough that the banner tells
// the truth while the waiter is still looking at it.
const REVIVE_TIMEOUT_MS = 3000;

function reviveWithin(c: AudioContext): Promise<AudioContext | null> {
  return Promise.race([
    revive(c),
    new Promise<null>(res => setTimeout(() => res(null), REVIVE_TIMEOUT_MS)),
  ]);
}

// Browsers refuse to produce sound until the user has interacted with the page, so
// this has to run off a real gesture — either any tap at all (armSoundOnFirstGesture)
// or the "Səsi aktivləşdir" button the UI falls back to.
//
// Callers overlap constantly — focus and visibilitychange both fire on one switch
// back to the tab, and a tap can land mid-revive — and two revives at once corrupt
// each other: the one that takes the rebuild path closes the context the other is
// holding, so a perfectly healthy engine reports failure and the UI puts up the
// "sound is off" banner. So a revive already in flight is shared rather than
// started twice.
let unlocking: Promise<boolean> | null = null;

// `fromGesture` marks a call the user actually asked for — a tap, or the banner's
// button. Such a call must NOT join an attempt started without a gesture: that attempt
// is blocked on the very permission this one carries, so sharing it would make the
// gesture inherit a failure instead of curing it. It gets a fresh context and a fresh
// revive; everyone else keeps the de-duplication the comment above describes.
export async function unlockSound(fromGesture = false): Promise<boolean> {
  if (unlocking && !fromGesture) return unlocking;
  if (fromGesture) {
    unlocking = null;   // abandon a pre-gesture attempt; nothing awaits it but itself
    rebuild();          // a context built before the gesture stays blocked — start clean
  }
  const attempt = (async () => {
    const c = getCtx();
    if (!c) return false;
    return (await reviveWithin(c)) !== null;
  })();
  unlocking = attempt;
  try {
    return await attempt;
  } finally {
    // Only clear the lock if it is still ours — a gesture that overtook us owns it now.
    if (unlocking === attempt) unlocking = null;
  }
}

export function isSoundUnlocked(): boolean {
  return ctx?.state === 'running';
}

// The gesture the browser demands need not be a dedicated "enable sound" button —
// any tap on the page counts. A waiter opening an order or pulling to refresh has
// already given us one, so arm the engine off that rather than making him dismiss a
// banner first. `onArmed` reports the outcome so the UI can ask outright only in the
// rare case where a genuine gesture still failed.
export function armSoundOnFirstGesture(onArmed: (ok: boolean) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const events = ['pointerdown', 'touchstart', 'keydown'] as const;
  const off = () => events.forEach(e => document.removeEventListener(e, handler));
  async function handler() {
    const ok = await unlockSound(true);   // this IS the gesture the browser was waiting for
    onArmed(ok);
    if (ok) off();   // armed — the rearm-on-focus path keeps it alive from here
  }
  events.forEach(e => document.addEventListener(e, handler, { passive: true }));
  return off;
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

// A context unlocked hours ago is not a context that will make a sound now:
// browsers suspend it once the tablet idles or the tab goes to the background,
// and iOS can hand back a 'running' context whose clock is dead. Heal it here —
// resume, or rebuild if it's a zombie — rather than leaving the screen silently
// mute until someone reloads.
async function ready(): Promise<AudioContext | null> {
  const c = getCtx();
  if (!c) return null;
  // Fast path: a context still running and never interrupted plays immediately.
  // Anything else — suspended, or back from a lock/background — goes through the
  // full revive-and-verify, which rebuilds a frozen zombie rather than trusting it.
  if (!interrupted && c.state === 'running') return c;
  return revive(c);
}

// The play functions report whether a sound actually came out, so the caller can
// surface the "Səsi aktivləşdir" banner rather than believing it is still armed.

// New order, or more work added to an open one: a bright rising two-note chime.
// Reads as "something arrived".
export async function playNewOrder(): Promise<boolean> {
  const c = await ready();
  if (!c) return false;
  const t = c.currentTime;
  tone(t,         880, 130, 'triangle', 0.30);   // A5
  tone(t + 0.13, 1319, 260, 'triangle', 0.30);   // E6
  return true;
}

// Item removed: a low descending double-beep. Deliberately nothing like the
// new-order chime — staff must be able to tell them apart without looking.
//
// `delayMs` staggers it behind the chime when one refresh brings both an added
// and a removed item: played together the two tones smear into one noise and the
// removal — the costlier one to miss — is what gets lost.
export async function playItemRemoved(delayMs = 0): Promise<boolean> {
  const c = await ready();
  if (!c) return false;
  const t = c.currentTime + delayMs / 1000;
  tone(t,        440, 150, 'square', 0.22);   // A4
  tone(t + 0.20, 294, 300, 'square', 0.22);   // D4
  return true;
}

// A sex finished its part: a soft three-note major arpeggio. "Food is ready, go
// and get it" — the only sound the seller screen makes, so it needs no telling
// apart from anything else there.
export async function playOrderReady(): Promise<boolean> {
  const c = await ready();
  if (!c) return false;
  const t = c.currentTime;
  tone(t,        1047, 120, 'sine', 0.26);   // C6
  tone(t + 0.11, 1319, 120, 'sine', 0.26);   // E6
  tone(t + 0.22, 1568, 300, 'sine', 0.26);   // G6
  return true;
}
