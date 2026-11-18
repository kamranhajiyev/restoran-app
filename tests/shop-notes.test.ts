// A shop's till has no comments: no Şərh on each line and no Qeyd for the
// whole sale — not for delivery, not when adding to an open sale. A
// restaurant keeps both (the user, 2026-11-17).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { takesNotes } from '@/lib/shop-mode';

const seller = readFileSync('app/seller/page.tsx', 'utf8');

describe('comments on the till', () => {
  it('are off in a shop and on in a restaurant', () => {
    expect(takesNotes('shop')).toBe(false);
    expect(takesNotes('restaurant')).toBe(true);
  });

  it('every cart gets the line note only through the shop rule', () => {
    expect(seller).not.toMatch(/onSetNote=\{setLineNote\}/);
    const carts = seller.match(/<CartItems [^>]*>/g) ?? [];
    expect(carts.length).toBeGreaterThan(0);
    for (const c of carts) expect(c).toContain('onSetNote={lineNote}');
    expect(seller).toMatch(/const lineNote = takesNotes\(kind\) \? setLineNote : undefined/);
  });

  it('every Qeyd box asks the shop rule first', () => {
    const boxes = seller.match(/\{[^{}]*<textarea\s+placeholder="Qeyd\.\.\."/g) ?? [];
    expect(boxes.length).toBe(2);
    for (const b of boxes) expect(b).toContain('takesNotes(kind) &&');
  });
});
