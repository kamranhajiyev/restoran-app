// Unlocking the till when the PIN cannot be checked with the server.
//
// Normally /api/verify-pin answers, against a bcrypt hash that never leaves the
// database. Offline there is nobody to ask, and a waiter locked out of the till
// during an outage is the whole feature failing at the worst moment.
//
// So: after a PIN is accepted online, this stores a slow hash of it on the
// machine, and an offline unlock is checked against that. The server's bcrypt
// hashes are never shipped anywhere.
//
// The honest limit — a 4-digit PIN is 10,000 possibilities, so anyone holding
// this machine's storage can grind them all. PBKDF2 at a high iteration count
// makes each guess cost real time rather than none, and the device salt stops
// one precomputed table covering every restaurant. It does not make the record
// secret, so nothing here is ever a substitute for the online check:
//
//   - only staff who have already unlocked on THIS machine can unlock offline
//   - the record expires, so a stolen till is not a permanent key
//   - the moment the line is back, the server is the authority again

const KEY = 'possiblle.offline-pin.v1';
const ITERATIONS = 310_000;
/** A cached unlock is good for one long shift, not forever. */
const MAX_AGE_MS = 16 * 60 * 60 * 1000;

interface PinRecord {
  staffId: string;
  name: string;
  companyId: string;
  saltB64: string;
  hashB64: string;
  storedAt: number;
}

const b64 = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

async function derive(pin: string, salt: Uint8Array, companyId: string): Promise<string> {
  // The company is mixed in so the same PIN on two restaurants' tills does not
  // produce the same record.
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${companyId}:${pin}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  );
  return b64(bits);
}

function load(): PinRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const all = JSON.parse(raw) as PinRecord[];
    const fresh = all.filter(r => Date.now() - r.storedAt < MAX_AGE_MS);
    if (fresh.length !== all.length) localStorage.setItem(KEY, JSON.stringify(fresh));
    return fresh;
  } catch {
    return [];
  }
}

/** Called after the server has accepted this PIN — never on an offline unlock. */
export async function rememberPin(
  pin: string,
  staff: { id: string; name: string },
  companyId: string,
): Promise<void> {
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const record: PinRecord = {
      staffId: staff.id,
      name: staff.name,
      companyId,
      saltB64: b64(salt.buffer as ArrayBuffer),
      hashB64: await derive(pin, salt, companyId),
      storedAt: Date.now(),
    };
    const rest = load().filter(r => !(r.staffId === record.staffId && r.companyId === companyId));
    localStorage.setItem(KEY, JSON.stringify([...rest, record]));
  } catch {
    // Storage refused. The till simply has no offline unlock — not fatal.
  }
}

export type OfflinePinResult =
  | { ok: true; id: string; name: string }
  | { ok: false; error: 'wrong' | 'unavailable' };

/**
 * Check a PIN with no network. Answers 'unavailable' rather than 'wrong' when
 * nobody has unlocked on this machine yet, so the screen can say why instead of
 * accusing the waiter of a bad PIN.
 */
export async function verifyPinOffline(pin: string, companyId: string): Promise<OfflinePinResult> {
  const records = load().filter(r => r.companyId === companyId);
  if (records.length === 0) return { ok: false, error: 'unavailable' };

  for (const r of records) {
    const candidate = await derive(pin, unb64(r.saltB64), companyId);
    // Length is fixed and both sides are ours, so a plain compare leaks nothing
    // an attacker holding this file does not already have.
    if (candidate === r.hashB64) return { ok: true, id: r.staffId, name: r.name };
  }
  return { ok: false, error: 'wrong' };
}

/** Signing out of the machine should not leave the door open behind you. */
export function forgetPins(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing stored */
  }
}
