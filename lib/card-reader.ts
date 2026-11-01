// A manager's card on the till's RFID reader (2026-11-01).
//
// The readers built into tills, and the cheap USB ones, act as a keyboard:
// a tap types the card's number and presses Enter. So the till needs no
// driver, only to tell a card from a person typing a PIN. A reader types a
// dozen keys within a few milliseconds of each other; a person needs well
// over a tenth of a second per key. The browser till, the exe and the APK
// all read cards through `cardCatcher`.
//
// The same 125 kHz card (EM-Marine) can come out of a reader two ways:
// "0012677920", or "193,29472" (193 × 65536 + 29472). The pair is only the
// low 24 bits of the ten-digit number: on a card whose number is above
// 16777215 the two differ. So a number of up to ten digits is kept as its
// low 24 bits, and whichever way the reader types it, or the owner copies it
// off the card, it is one number.

/** Fewer keys than this in one burst is a person, however fast. */
export const CARD_MIN_KEYS = 6;
/** Longer than this between two keys and it was not a reader. */
export const CARD_GAP_MS = 50;

// A 13.56 MHz card read by a phone's NFC (android/…/NfcCards.java), or by an
// app like NFC Tools for the owner to copy into admin, is its id in hex:
// "04:A2:3B:1C" (some apps write "04 A2 3B 1C", "04-A2-3B-1C" or
// "04A23B1C"). It becomes a decimal number here, so both land on the same
// number, and the rules below apply to it as to any other. Run together with
// no letter in it, it cannot be told from a decimal number and is one.
const HEX_ID = /^[0-9a-f]{2}(?:[:\s-][0-9a-f]{2}){3,9}$/i;
const HEX_RUN = /^(?=.*[a-f])(?:[0-9a-f]{2}){4,10}$/i;

function hexBytes(t: string): string | null {
  if (HEX_ID.test(t)) return t.split(/[:\s-]/).join(':');
  if (HEX_RUN.test(t)) return t.match(/../g)!.join(':');
  return null;
}

/** Hex bytes as one decimal number, without BigInt (old Android Chrome). */
function hexToDecimal(hex: string): string {
  const digits = [0]; // least significant first
  for (const pair of hex.split(':')) {
    let carry = parseInt(pair, 16);
    for (let i = 0; i < digits.length; i++) {
      const v = digits[i] * 256 + carry;
      digits[i] = v % 10;
      carry = Math.floor(v / 10);
    }
    while (carry > 0) { digits.push(carry % 10); carry = Math.floor(carry / 10); }
  }
  return digits.reverse().join('');
}

/** The card's number as it is saved and checked, or null when it is not one. */
export function cardNumber(raw: string): string | null {
  const t = raw.trim();
  const hex = hexBytes(t);
  const s = hex ? hexToDecimal(hex) : t;
  const pair = /^(\d{1,3})[,.](\d{1,5})$/.exec(s);
  if (pair) {
    const facility = Number(pair[1]);
    const id = Number(pair[2]);
    if (facility > 255 || id > 65535) return null;
    return String(facility * 65536 + id);
  }
  if (!/^\d+$/.test(s)) return null;
  const n = s.replace(/^0+/, '');
  if (n.length > 20) return null;
  if (n.length > 10) return n;
  const low = Number(n) % 16777216;
  return low > 0 ? String(low) : null;
}

/**
 * Sorts a hardware keyboard's keys into card taps and typing. `key` gets each
 * digit (or "," / "."), `enter` the Enter or Tab after it. A burst too short
 * to be a card goes on to `onKeys` as typing, a moment later; one with no
 * Enter after it is still a card when the keys stop.
 */
export function cardCatcher(onCard: (card: string) => void, onKeys: (keys: string) => void) {
  let buf = '';
  let timer: ReturnType<typeof setTimeout> | null = null;

  function flush() {
    if (timer) clearTimeout(timer);
    timer = null;
    const keys = buf;
    buf = '';
    if (!keys) return;
    if (keys.length >= CARD_MIN_KEYS) {
      const card = cardNumber(keys);
      if (card) onCard(card);
      return;
    }
    onKeys(keys);
  }

  return {
    key(k: string) {
      buf += k;
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, CARD_GAP_MS);
    },
    /** True when the Enter ended a card, so nothing else should act on it. */
    enter(): boolean {
      const card = buf.length >= CARD_MIN_KEYS;
      flush();
      return card;
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      buf = '';
    },
  };
}
