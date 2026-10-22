// The till on a tablet (Android emulator, 2026-10-22).
//
// The unsent-orders popup opened under the product cards: the sticky sidebar
// is its own layer, and the cards painted over it. And it said "on this
// computer" on a tablet.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('the till on a tablet', () => {
  it('lifts the sidebar above the products, below the header and windows', () => {
    const page = readFileSync('app/seller/page.tsx', 'utf8');
    const aside = page.match(/<aside className=\{`hidden md:block[^`]*`/)?.[0] ?? '';
    expect(aside).toMatch(/\bz-40\b/);
  });

  it('says "this device", not "this computer", about where orders wait', () => {
    for (const file of ['components/SyncStatus.tsx', 'components/OrderSyncDot.tsx']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/kompüter/);
    }
  });
});
