// Test Restoran, 2026-10-24: halls could not be put in order — they showed by
// name on the site and by id in the exe.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { hallsMoved, nextHallPosition } from '@/lib/hall-order';

const halls = [
  { id: 'a', name: 'Əsas zal', position: 0 },
  { id: 'b', name: 'Qızıl Zal', position: 0 },
  { id: 'c', name: 'Çinar Zal 1', position: 0 },
];

describe('hall order', () => {
  it('moves a hall one step and numbers them all', () => {
    expect(hallsMoved(halls, 'c', -1)?.map(h => [h.id, h.position])).toEqual([['a', 0], ['c', 1], ['b', 2]]);
    expect(hallsMoved(halls, 'a', 1)?.map(h => h.id)).toEqual(['b', 'a', 'c']);
  });

  it('does nothing at either end', () => {
    expect(hallsMoved(halls, 'a', -1)).toBeNull();
    expect(hallsMoved(halls, 'c', 1)).toBeNull();
  });

  it('puts a new hall last', () => {
    expect(nextHallPosition([{ id: 'a', position: 0 }, { id: 'b', position: 4 }])).toBe(5);
    expect(nextHallPosition([])).toBe(0);
  });

  it('admin, the browser till and the exe all show halls by position', () => {
    expect(readFileSync('app/admin/page.tsx', 'utf8')).toContain('saveHallOrder(moved)');
    expect(readFileSync('lib/store.ts', 'utf8')).toMatch(/from\('halls'\)\.select\('id, name, position'\)\.order\('position'\)/);
    expect(readFileSync('app/api/public-tables/route.ts', 'utf8')).toMatch(/\.select\('id, name, position'\)[\s\S]*\.order\('position'\)/);
    expect(readFileSync('lib/till-store/repo.ts', 'utf8')).toContain('from halls where company_id = ? order by position');
  });
});
