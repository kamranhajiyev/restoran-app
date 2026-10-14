// Customer request, 2026-10-10: "Set 1 (ayran + dolma)" sold once and ayran
// sold once read as ayran 1; the owner counts ayrans and wanted 2. Cəmi adds
// what went out inside sets, without touching Satış or the money next to it.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanSetItems, menuRowBatches, setSplit, soldInSets, withSets } from '@/lib/set-items';

const menu = [
  { id: 'set1', setItems: [{ id: 'ayran', qty: 1 }, { id: 'dolma', qty: 1 }] },
  { id: 'set2', setItems: [{ id: 'ayran', qty: 2 }] },
  { id: 'ayran', setItems: [] },
  { id: 'dolma' },
  { id: 'corek', setItems: [] },
];

describe('what went out inside sets', () => {
  it('one set and one ayran is two ayrans and one dolma', () => {
    const inSets = soldInSets(menu, { set1: 1, ayran: 1 });
    expect(inSets).toEqual({ ayran: 1, dolma: 1 });
    expect(withSets({ qty: 1, inSets: inSets.ayran })).toBe(2);
    expect(setSplit({ qty: 1, inSets: inSets.ayran })).toBe('1 tək + 1 setdə');
  });

  it('multiplies by how many sets sold and how many are inside each', () => {
    expect(soldInSets(menu, { set1: 3, set2: 2 })).toEqual({ ayran: 7, dolma: 3 });
  });

  it('bread sold alone, in no set, is counted once', () => {
    const inSets = soldInSets(menu, { corek: 1 });
    expect(inSets.corek).toBeUndefined();
    expect(withSets({ qty: 1, inSets: inSets.corek ?? 0 })).toBe(1);
  });

  it('a set that did not sell adds nothing', () => {
    expect(soldInSets(menu, { ayran: 4 })).toEqual({});
  });
});

describe('a set\'s contents from the form', () => {
  it('drops the set itself, merges a product listed twice, keeps whole numbers from 1', () => {
    expect(cleanSetItems('set1', [
      { id: 'set1', qty: 1 }, { id: 'ayran', qty: 1 }, { id: 'ayran', qty: 2 }, { id: 'dolma', qty: 0 }, { id: 'corek', qty: NaN },
    ])).toEqual([{ id: 'ayran', qty: 3 }, { id: 'dolma', qty: 1 }, { id: 'corek', qty: 1 }]);
  });
});

describe('saving the menu', () => {
  it('keeps a dish whose set contents never loaded out of the upsert that names the column', () => {
    const known = { id: 'a', set_items: null };
    const unknown = { id: 'b' };
    expect(menuRowBatches([known, unknown, { id: 'c', set_items: [{ id: 'a', qty: 1 }] }]))
      .toEqual([[known, { id: 'c', set_items: [{ id: 'a', qty: 1 }] }], [unknown]]);
    // A database without the column: one batch, and no row names it.
    expect(menuRowBatches([unknown])).toEqual([[unknown]]);
  });

  it('saveMenu sends the batches, and leaves the column out when the contents are unknown', () => {
    const store = readFileSync('lib/store.ts', 'utf8');
    expect(store).toMatch(/for \(const batch of menuRowBatches\(rows\)\)/);
    expect(store).toMatch(/\.\.\.\(m\.setItems \? \{ set_items:/);
    expect(store).toMatch(/setItems: r\.set_items === undefined \? undefined : \(r\.set_items \?\? \[\]\)/);
  });
});

describe('Cəmi is counted in one place', () => {
  const admin = readFileSync('app/admin/page.tsx', 'utf8');
  const excel = readFileSync('lib/excel.ts', 'utf8');

  it('the Analiz table and its Excel export both use lib/set-items', () => {
    expect(admin).toMatch(/import \{[^}]*\bsoldInSets\b[^}]*\bwithSets\b[^}]*\} from '@\/lib\/set-items'/);
    expect(excel).toMatch(/import \{[^}]*\bwithSets\b[^}]*\} from '\.\/set-items'/);
    expect(excel).toMatch(/'Cəmi \(ədəd\)': withSets\(r\)/);
    // No screen adds the two numbers itself.
    expect(admin).not.toMatch(/qty \+ \w+\.inSets/);
    expect(excel).not.toMatch(/qty \+ \w+\.inSets/);
  });

  it('the form saves a set\'s contents only when they really loaded', () => {
    expect(admin).toMatch(/setItems: setsLoaded && form\.setKnown \? cleanSetItems\(/);
    expect(admin).toMatch(/setKnown: item\.setItems !== undefined,/);
  });

  // Owner report, 2026-10-14: a set made from the quick-add row opened in
  // Düzəlt with no Set button and no contents until the page was refreshed.
  it('a quick-added item opens in Düzəlt as known-empty, not unloaded', () => {
    const quick = admin.slice(admin.indexOf('function submitQuickAdd'), admin.indexOf('function addVariant'));
    expect(quick).toMatch(/setItems: setsLoaded \? \[\] : undefined,/);
    expect(quick).toMatch(/modifierGroupIds: modifiersLoaded \? \[\] : undefined,/);
  });

  it('the public menu does not send a set\'s contents', () => {
    expect(readFileSync('app/api/public-menu/route.ts', 'utf8')).not.toMatch(/set_items/);
  });
});
