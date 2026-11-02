// 2026-11-02: the QR menu showed a set's name and price but not what is in it.
// The public menu function has no set_items, so /api/guest-order GET sends them.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { guestSetLine } from '@/lib/set-items';
import type { MenuItem } from '@/types';

const menu = [
  { id: 'dolma', name: 'Dolma' },
  { id: 'fanta', name: 'Fanta', variants: [{ id: 'half', name: '0.5 L', price: 2 }] },
] as MenuItem[];

describe('a set on the QR menu', () => {
  it('lists its parts, with sizes, and leaves out what only the owner can fix', () => {
    expect(guestSetLine([{ id: 'dolma', qty: 1 }, { id: 'fanta', qty: 2, variantId: 'half' }], menu))
      .toBe('Dolma, 2× Fanta · 0.5 L');
    expect(guestSetLine([{ id: 'gone', qty: 1 }, { id: 'fanta', qty: 1 }], menu)).toBe('Fanta');
  });

  it('gets its parts from the guest route and shows them on the card', () => {
    const route = readFileSync('app/api/guest-order/route.ts', 'utf8');
    expect(route).toMatch(/select\('id, set_items'\)/);
    expect(route).toMatch(/change: t\.change \}, sets \}/);
    const page = readFileSync('app/[slug]/menu/page.tsx', 'utf8');
    expect(page).toMatch(/setItems: lt\.sets\[/);
    expect(page).toMatch(/guestSetLine\(item\.setItems, menuAll\)/);
  });
});
