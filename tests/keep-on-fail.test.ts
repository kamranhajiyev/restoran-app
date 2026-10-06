// Test Restoran, 2026-10-06: on any blip the till jumped back to Sifarişlər,
// turned into "Növbəni aç", put the seller back on the first category, or
// blanked the menu — each read answered its failure with [] or null, and the
// screen believed it. A failed read must keep what the screen has.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keepCategory, listOrNull, shiftOrUnknown } from '@/lib/keep-on-fail';

const answer = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const dead = () => Promise.reject(new TypeError('Failed to fetch'));

describe('a list read', () => {
  it('is the list when the route answers', async () => {
    expect(await listOrNull(answer({ items: [{ id: 1 }] }), 'items')).toEqual([{ id: 1 }]);
  });

  it('is an empty list when the restaurant really has none', async () => {
    expect(await listOrNull(answer({ items: [] }), 'items')).toEqual([]);
  });

  it('is null on a 500, even though the route sends an empty list with it', async () => {
    expect(await listOrNull(answer({ items: [] }, 500), 'items')).toBeNull();
  });

  it('is null when the network is down', async () => {
    expect(await listOrNull(dead(), 'items')).toBeNull();
  });
});

describe('the open-shift read', () => {
  it('is the shift when one is open', async () => {
    expect(await shiftOrUnknown(answer({ shift: { id: 's1' } }))).toEqual({ id: 's1' });
  });

  it('is null only when the server says no shift is open', async () => {
    expect(await shiftOrUnknown(answer({ shift: null }))).toBeNull();
  });

  it('is unknown on a 500 — the route sends { shift: null } with it', async () => {
    expect(await shiftOrUnknown(answer({ shift: null }, 500))).toBeUndefined();
  });

  it('is unknown when the network is down or the answer is not a shift', async () => {
    expect(await shiftOrUnknown(dead())).toBeUndefined();
    expect(await shiftOrUnknown(answer({ error: 'refused' }))).toBeUndefined();
  });
});

describe('the category after the menu reloads', () => {
  it("stays on the seller's own", () => {
    expect(keepCategory('Pivə', ['Qəhvə', 'Çay', 'Pivə'])).toBe('Pivə');
  });

  it('goes to the first only when theirs is gone, or none was picked', () => {
    expect(keepCategory('Pivə', ['Qəhvə', 'Çay'])).toBe('Qəhvə');
    expect(keepCategory('', ['Qəhvə', 'Çay'])).toBe('Qəhvə');
  });
});

describe('the seller page', () => {
  const seller = readFileSync('app/seller/page.tsx', 'utf8');

  it('never takes a failed menu, category, table or shift read as an answer', () => {
    expect(seller).not.toMatch(/public-(menu|categories|tables)\?[^\n]*\.catch\(\(\) => (\[\]|\(\{ tables: \[\])/);
    expect(seller).not.toMatch(/public-shift\?[^\n]*\.catch\(\(\) => \(\{ shift: null \}\)\)/);
    expect(seller).not.toMatch(/d\.shift \?\? null/);
    // Unguarded writes of a read that may have failed.
    expect(seller).not.toMatch(/^\s*setMenu\(m\);/m);
    expect(seller).not.toMatch(/setMenu\(m\); setShift\(s\);|setShift\(s\); setPinStaffList\(st\);/);
    expect(seller).not.toMatch(/\bfetchOpenShift\(\)\s*[,\]]/);
  });

  it('keeps the category the seller is on when data reloads', () => {
    expect(seller).toMatch(/setActiveCategory\(cur => keepCategory\(cur, cats\)\)/);
    // Only "Yeni sifariş" itself starts from the first category.
    expect(seller.match(/setActiveCategory\(cats\[0\]\)/g)?.length ?? 0).toBe(2);
  });
});
