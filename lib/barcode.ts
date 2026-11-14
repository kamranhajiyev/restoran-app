// Barcodes (SHOP-MODE.md, step 3). A product has one, or each of its sizes has
// its own (Fanta 0.33 L and 1 L are different). A barcode reader acts as a
// keyboard: it types the code very fast and presses Enter — the same trick as
// the manager card reader (lib/card-reader), but a barcode is kept as typed
// (letters too, leading zeros too), never turned into a card number.

import type { MenuItem, MenuItemVariant } from '@/types';

/** How a barcode is stored and compared: trimmed, inner spaces gone, upper
 *  case (a reader and a person typing may differ in case). Empty = none. */
export function cleanBarcode(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, '').toUpperCase();
}

export interface BarcodeHit { item: MenuItem; variant?: MenuItemVariant }

/** The product — and the size, when the code is a size's — a scan names. A
 *  product with sizes is found through its sizes only. */
export function findByBarcode(menu: MenuItem[], raw: string): BarcodeHit | null {
  const code = cleanBarcode(raw);
  if (!code) return null;
  for (const item of menu) {
    if (item.variants?.length) {
      const variant = item.variants.find(v => cleanBarcode(v.barcode) === code);
      if (variant) return { item, variant };
    } else if (cleanBarcode(item.barcode) === code) {
      return { item };
    }
  }
  return null;
}

/** The other product (and size) that already has this barcode, so admin can
 *  say so before two products answer one scan. `self` is what is being edited. */
export function barcodeOwner(menu: MenuItem[], raw: string, self: { itemId: string | null; variantId?: string }): string | null {
  const code = cleanBarcode(raw);
  if (!code) return null;
  for (const item of menu) {
    for (const v of item.variants ?? []) {
      if (cleanBarcode(v.barcode) !== code) continue;
      if (item.id === self.itemId && v.id === self.variantId) continue;
      return `${item.name} (${v.name})`;
    }
    if (!item.variants?.length && cleanBarcode(item.barcode) === code && item.id !== self.itemId) return item.name;
  }
  return null;
}

/** Fewer keys than this in one burst is a person. */
export const SCAN_MIN_KEYS = 4;
/** A receipt's barcode is just its number ("45", "7/2"): while Qaytarma waits
 *  for one, a burst of any length counts. Speed alone still tells it from a
 *  person, who cannot type a key and Enter within SCAN_GAP_MS. */
export const RECEIPT_MIN_KEYS = 1;
/** Longer than this between two keys and it was not a reader. */
export const SCAN_GAP_MS = 50;

/**
 * Catches a scan typed anywhere on the page: keys that come faster than a
 * person types and end in Enter. Keys typed slower are left alone (the page
 * handles them as ordinary typing).
 */
export function scanCatcher(onScan: (code: string) => void, now: () => number = Date.now, minKeys: () => number = () => SCAN_MIN_KEYS) {
  let buf = '';
  let last = 0;
  return {
    /** A printable key. */
    key(k: string) {
      const t = now();
      if (t - last > SCAN_GAP_MS) buf = '';
      last = t;
      buf += k;
    },
    /** Enter: true when it ended a scan, so nothing else should act on it. */
    enter(): boolean {
      const fast = now() - last <= SCAN_GAP_MS && buf.length >= minKeys();
      const code = buf;
      buf = '';
      if (fast) onScan(code);
      return fast;
    },
  };
}

/** Bazarlıq: a scanned item goes into the purchase. Already there: its count
 *  +1. Otherwise it fills the empty first line the form opens with, or is
 *  added as a new line of 1. */
export function addScannedLine<L extends { stockItemId: string; qty: string }>(lines: L[], stockItemId: string, blank: Omit<L, 'stockItemId' | 'qty'>): L[] {
  const i = lines.findIndex(l => l.stockItemId === stockItemId);
  if (i >= 0) return lines.map((l, k) => k === i ? { ...l, qty: String((parseFloat(l.qty) || 0) + 1) } : l);
  const empty = lines.findIndex(l => !l.qty.trim());
  if (empty >= 0 && lines.length === 1) return [{ ...lines[0], stockItemId, qty: '1' }];
  return [...lines, { ...blank, stockItemId, qty: '1' } as L];
}
