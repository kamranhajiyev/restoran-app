// Test Restoran, 2026-10-06: on any blip the till jumped back to Sifarişlər,
// turned into "Növbəni aç", put the seller back on the first category, or
// blanked the menu — each read answered its failure with [] or null, and the
// screen believed it. A failed read must keep what the screen has.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { keepCategory, listOrNull, salesOrNull, shiftOrUnknown } from '@/lib/keep-on-fail';

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

describe('the shift sales read', () => {
  it('is the sales when the route answers', async () => {
    expect(await salesOrNull(answer({ cash: 12.5, card: 3 }))).toEqual({ cash: 12.5, card: 3 });
  });

  it('is null — never 0 ₼ — when the read failed', async () => {
    expect(await salesOrNull(answer({ error: 'x' }, 500))).toBeNull();
    expect(await salesOrNull(dead())).toBeNull();
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

  it('never shows a failed Tarixçə or Kassa read as no orders, or closes a shift on it', () => {
    expect(seller).not.toMatch(/d\.orders \?\? \[\]\)\.catch\(\(\) => \[\]\)\s*\n\s*: fetchOrders\(/);
    expect(seller).not.toMatch(/\.catch\(\(\) => \(\{ cash: 0/);
    expect(seller).not.toMatch(/\.then\(setShiftSales\)/);
    const route = readFileSync('app/api/public-shift-sales/route.ts', 'utf8');
    expect(route).not.toMatch(/return Response\.json\(\{ cash: 0, card: 0, courierCard: 0/);
  });

  it('keeps the category the seller is on when data reloads', () => {
    expect(seller).toMatch(/setActiveCategory\(cur => keepCategory\(cur, cats\)\)/);
    // Only "Yeni sifariş" itself starts from the first category.
    expect(seller.match(/setActiveCategory\(cats\[0\]\)/g)?.length ?? 0).toBe(2);
  });
});

// 2026-10-08: two more reads that showed a failure as an answer — admin's
// courier money at 0 ₼, and "load more" adding nothing as if there were no more.
describe('more failed reads', () => {
  it('admin keeps the courier money on screen', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).not.toMatch(/setCourierCollected\(\{ nagd: 0, kart: 0 \}\)/);
    expect(admin).toMatch(/fetchCourierCollectionsOrNull\(from, to\)/);
  });

  it('"load more" says it failed instead of adding nothing', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).not.toMatch(/d\.orders \?\? \[\]\)\.catch\(\(\) => \[\]\)/);
  });
});
