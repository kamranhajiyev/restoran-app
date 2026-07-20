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

// Browsers refuse to produce sound until the user has interacted with the page.
// A kitchen tablet sitting untouched on a shelf would stay silent forever, so
// the UI must call this from a real click — see the "Səsi aktivləşdir" banner.
export async function unlockSound(): Promise<boolean> {
  const c = getCtx();
  if (!c) return false;
  return (await revive(c)) !== null;
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
// put the "Səsi aktivləşdir" banner back rather than believing it is still armed.

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

// A sex finished its part: a soft three-note major arpeggio.
//
// The seller hears this next to playNewOrder(), and both rise — so the telling
// apart is done by timbre and length, not pitch direction: sine against triangle,
// three notes against two. "Food is ready, go and get it", not "more work".
//
// `delayMs` for the same reason playItemRemoved has one: one refresh can bring a
// new order and a ready sex together, and two chimes on top of each other are one
// noise that means neither.
export async function playOrderReady(delayMs = 0): Promise<boolean> {
  const c = await ready();
  if (!c) return false;
  const t = c.currentTime + delayMs / 1000;
  tone(t,        1047, 120, 'sine', 0.26);   // C6
  tone(t + 0.11, 1319, 120, 'sine', 0.26);   // E6
  tone(t + 0.22, 1568, 300, 'sine', 0.26);   // G6
  return true;
}
