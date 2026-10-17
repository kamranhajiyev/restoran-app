// 2026-10-17: a set could only name "Fanta", not "Fanta 0.5L". A product with
// sizes keeps its stock per size, so the set took nothing for it, and Analiz
// could not say which size went out. A part now names its size.
// Found on the way: a Yemək with sizes (Plov qulyaj) took nothing from stock
// even sold alone; its one recipe is saved with no size.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cleanSetItems, partVariant, setChoices, setLine, soldInSets, soldInSetSizes } from '@/lib/set-items';

const fanta = { id: 'fanta', name: 'Fanta', kind: 'product' as const, setItems: [], variants: [
  { id: 'f03', name: '0.3L', price: 1 }, { id: 'f05', name: '0.5L', price: 1.5 },
] };
const plov = { id: 'plov', name: 'Plov', kind: 'meal' as const, setItems: [], variants: [
  { id: 'qulyaj', name: 'qulyaj', price: 8 }, { id: 'katlet', name: 'katlet', price: 7 },
] };
const ayran = { id: 'ayran', name: 'Ayran', kind: 'product' as const, setItems: [] };
const menu = [
  fanta, plov, ayran,
  { id: 'set1', name: 'Set 1', kind: 'set' as const, setItems: [{ id: 'plov', qty: 1, variantId: 'qulyaj' }, { id: 'fanta', qty: 1, variantId: 'f05' }] },
  { id: 'set2', name: 'Set 2', kind: 'set' as const, setItems: [{ id: 'fanta', qty: 2, variantId: 'f03' }, { id: 'fanta', qty: 1, variantId: 'f05' }] },
  { id: 'old', name: 'Köhnə set', kind: 'set' as const, setItems: [{ id: 'fanta', qty: 1 }, { id: 'ayran', qty: 1 }] },
];

describe('a part with a size', () => {
  it('is kept apart from another size of the same product, and merged with the same one', () => {
    expect(cleanSetItems('set2', [
      { id: 'fanta', qty: 2, variantId: 'f03' }, { id: 'fanta', qty: 1, variantId: 'f05' },
      { id: 'fanta', qty: 1, variantId: 'f03' }, { id: 'ayran', qty: 1, variantId: '' },
    ])).toEqual([
      { id: 'fanta', qty: 3, variantId: 'f03' }, { id: 'fanta', qty: 1, variantId: 'f05' }, { id: 'ayran', qty: 1 },
    ]);
  });

  it('a product with sizes can be picked once per size', () => {
    const ids = (picked: { id: string }[]) => setChoices(menu, 'set9', picked).map(m => m.id);
    expect(ids([])).toEqual(['fanta', 'plov', 'ayran']);
    expect(ids([{ id: 'fanta' }])).toEqual(['fanta', 'plov', 'ayran']);
    expect(ids([{ id: 'fanta' }, { id: 'fanta' }, { id: 'ayran' }])).toEqual(['plov']);
  });

  it('a size deleted since is no size, so the form asks again', () => {
    expect(partVariant({ variantId: 'f05' }, fanta)?.name).toBe('0.5L');
    expect(partVariant({ variantId: 'f1' }, fanta)).toBeUndefined();
    expect(partVariant({}, fanta)).toBeUndefined();
  });

  it('shows its size in the menu list, and says when none is picked', () => {
    expect(setLine(menu[3].setItems, menu)).toBe('Plov · qulyaj × 1 · Fanta · 0.5L × 1');
    expect(setLine(menu[5].setItems, menu)).toBe('Fanta · variant seçilməyib × 1 · Ayran × 1');
  });
});

describe('Analiz counts sets per size', () => {
  const sold = { set1: 3, set2: 2, old: 1 };

  it('the product total is every size together, as before', () => {
    expect(soldInSets(menu, sold)).toEqual({ plov: 3, fanta: 3 + 2 * 2 + 2 + 1, ayran: 1 });
  });

  it('each size counts its own; a part with no size only in the total', () => {
    expect(soldInSetSizes(menu, sold)).toEqual({
      plov: { qulyaj: 3 },
      fanta: { f05: 3 + 2, f03: 4, '': 1 },
      ayran: { '': 1 },
    });
  });

  it('the screen gives each size row its set count, and Excel does not count it twice', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toMatch(/false, setSizes\[v\.id\] \?\? 0\)\);/);
    expect(admin).toMatch(/const inSetSizes = soldInSetSizes\(menu, soldAlone\);/);
    const excel = readFileSync('lib/excel.ts', 'utf8');
    expect(excel).toMatch(/r\.inSets - \(r\.sizes \?\? \[\]\)\.reduce\(\(s, z\) => s \+ z\.inSets, 0\)/);
    expect(excel).toMatch(/inSets: unsized\(r\)/);
  });
});

describe('the set form', () => {
  const admin = readFileSync('app/admin/page.tsx', 'utf8');

  it('will not save a product with sizes without one picked', () => {
    expect(admin).toMatch(/<select required[\s\S]{0,300}value=\{p\.variantId\}/);
    expect(admin).toMatch(/<option value="">Variant seçin<\/option>/);
  });

  it('saves the size', () => {
    expect(admin).toContain('parseFloat(p.qty), variantId: p.variantId })) : []) : undefined,');
    expect(admin).toContain("variantId: partVariant(p, menu.find(m => m.id === p.id))?.id ?? ''");
  });
});

describe('selling', () => {
  const sql = readFileSync('supabase/migrations/20261028_set_variants.sql', 'utf8');

  it('a set part takes its own size', () => {
    expect(sql).toMatch(/select \(p->>'id'\)::uuid, nullif\(p->>'variantId', ''\), s\.n \* \(p->>'qty'\)::numeric/);
  });

  it('a size with no lines of its own takes the dish\'s recipe', () => {
    expect(sql).toMatch(/nullif\(rl\.variant_id, ''\) is not distinct from u\.variant_id\s+--[^\n]*\n\s+or \(nullif\(rl\.variant_id, ''\) is null\s+and u\.variant_id is not null\s+and not exists \(/);
  });

  it('still does not take the set\'s own recipe, and stays closed to every browser', () => {
    expect(sql).toMatch(/select s\.menu_item_id, s\.variant_id, s\.n from sold s where s\.parts is null/);
    expect(sql).toMatch(/revoke execute on function public\.order_stock_lines\(text, uuid\) from public, anon, authenticated;/);
  });
});
