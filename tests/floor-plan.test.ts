// The till drew tables at the admin board's pixels inside a smaller fixed box,
// so a plan laid out on a wide admin screen ran off the till's edges and the
// seller scrolled inside the map to find a table (lib/floor-plan.ts).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { copySpot, fitPlan, keepLocalTables, MIN_TABLE, nextTableName, PLAN_PAD, resizeTable, tableBox, tableRadius, tablesInHall, toggleShape } from '@/lib/floor-plan';

// A hall laid out on a wide admin screen: the far table sits at x 1100.
const wideHall = [
  { x: 400, y: 20, w: 100, h: 70 },
  { x: 1100, y: 380, w: 100, h: 70 },
];

describe('floor plan fit', () => {
  it('keeps every table inside a narrow till', () => {
    const plan = fitPlan(wideHall, 600, 2000);
    for (const b of wideHall.map(plan.place)) {
      expect(b.x).toBeGreaterThanOrEqual(0);
      expect(b.x + b.w).toBeLessThanOrEqual(600);
      expect(b.y + b.h).toBeLessThanOrEqual(plan.height);
    }
  });

  it('keeps a hall on a wide screen above the bottom of the screen', () => {
    const plan = fitPlan(wideHall, 1700, 500);
    expect(plan.height).toBeLessThanOrEqual(500);
    for (const b of wideHall.map(plan.place)) expect(b.y + b.h).toBeLessThanOrEqual(plan.height);
  });

  it('drops the empty margin the admin left on the left and top', () => {
    const plan = fitPlan(wideHall, 800 + PLAN_PAD * 2, 2000);
    const first = plan.place(wideHall[0]);
    expect(first.x).toBe(PLAN_PAD);
    expect(first.y).toBe(PLAN_PAD);
  });

  it('does not blow a small hall up past 1.5×', () => {
    const plan = fitPlan([{ x: 0, y: 0, w: 100, h: 70 }], 3000, 3000);
    expect(plan.scale).toBe(1.5);
  });

  it('draws a round table with no saved height as a circle', () => {
    expect(tableBox({ shape: 'round', w: 90 }, 0)).toMatchObject({ w: 90, h: 90 });
  });

  it('keeps a round table stretched in admin as a pill, not a circle', () => {
    const b = tableBox({ shape: 'round', w: 240, h: 90 }, 0);
    expect(b).toMatchObject({ w: 240, h: 90 });
    expect(tableRadius('round', b.w, b.h)).toBe(45);
  });

  it('turns square to round and back on double-click, as in Poster', () => {
    expect(toggleShape('rect', 100, 70)).toBe('round');
    expect(toggleShape('round', 100, 70)).toBe('rect');
    expect(toggleShape('round', 70, 100)).toBe('rect-v');
  });

  it('names a one-click table after the highest number in the names given', () => {
    expect(nextTableName([])).toBe('1');
    expect(nextTableName(['3', '16 (Zal 1)', 'Bar', 'Müdür'])).toBe('17');
  });

  it('starts every hall from 1, counting only that hall (2026-10-25, Natiq)', () => {
    const tables = [
      { name: '1', hallId: null }, { name: '27', hallId: 'main' },
      { name: '1', hallId: 'terrace' }, { name: '2', hallId: 'terrace' },
    ];
    const next = (hall: string) => nextTableName(tablesInHall(tables, hall, 'main').map(t => t.name));
    expect(next('main')).toBe('28');
    expect(next('terrace')).toBe('3');
    expect(next('new-hall')).toBe('1');
    // A table with no hall sits in the first hall.
    expect(tablesInHall(tables, 'main', 'main').map(t => t.name)).toEqual(['1', '27']);
  });

  it('puts a copied table just right of the original, not on top of it', () => {
    expect(copySpot({ x: 100, y: 50, w: 70, h: 70 })).toEqual({ x: 190, y: 50 });
  });

  it('does not let a reload put back a busy table\'s old shape', () => {
    // Double-clicked round on screen; a list downloaded before that save still says square.
    const local = [{ id: 1, shape: 'round' }, { id: 2, shape: 'rect' }];
    const server = [{ id: 1, shape: 'rect' }, { id: 2, shape: 'round' }];
    expect(keepLocalTables(server, local, new Set([1]))).toEqual([{ id: 1, shape: 'round' }, { id: 2, shape: 'round' }]);
    expect(keepLocalTables(server, local, new Set())).toBe(server);
  });

  it('never resizes a table too small for its name', () => {
    expect(resizeTable(100, 70, -500, -500)).toEqual({ w: MIN_TABLE, h: MIN_TABLE });
    expect(resizeTable(100, 70, 20, 10)).toEqual({ w: 120, h: 80 });
  });

  it('is used by both the till and admin, neither placing tables on its own', () => {
    for (const page of ['app/seller/page.tsx', 'app/admin/page.tsx']) {
      const src = readFileSync(page, 'utf8');
      expect(src).toContain('tableBox(');
      expect(src).not.toMatch(/t\.x \?\?/);
      expect(src).toContain('tableRadius(');
    }
  });
});
