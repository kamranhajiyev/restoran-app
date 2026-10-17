// Customer request, 2026-10-10: "Set 1 (ayran + dolma)" could take the ayran
// off the stock but never the dolma: a recipe line could only point at a
// warehouse item, and a cooked dish is not one. A set (Növ = Set) now lists the
// meals and products inside it, and selling it takes each one's own recipe.
// Recipes moved from Anbar → Reseptlər into the menu form, next to Növ.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { itemKind, KIND_LABEL, setChoices, setLine } from '@/lib/set-items';
import { cleanRecipe } from '@/lib/recipes';
import { azNormalize, searchByName } from '@/lib/az-text';

const sql = readFileSync('supabase/migrations/20261014_set_stock.sql', 'utf8');
const admin = readFileSync('app/admin/page.tsx', 'utf8');
const anbar = readFileSync('components/AnbarPanel.tsx', 'utf8');
const store = readFileSync('lib/store.ts', 'utf8');

const menu = [
  { id: 'ayran', name: 'ATENA AYRAN 200 ML', kind: 'product' as const, setItems: [] },
  { id: 'dolma', name: 'Yarpaq dolması', kind: 'meal' as const, setItems: [] },
  { id: 'set1', name: 'Set 1', kind: 'set' as const, setItems: [{ id: 'ayran', qty: 1 }, { id: 'dolma', qty: 2 }] },
  { id: 'set2', name: 'Set 2', kind: 'set' as const, setItems: [] },
  { id: 'old', name: 'Köhnə set', kind: 'meal' as const, setItems: [{ id: 'ayran', qty: 1 }] },
  { id: 'cay', name: 'Çay' },
];

describe('Növ', () => {
  it('has three values, and anything with parts is a set', () => {
    expect(KIND_LABEL).toEqual({ product: 'Məhsul', meal: 'Yemək', set: 'Set' });
    expect(menu.map(itemKind)).toEqual(['product', 'meal', 'set', 'set', 'set', 'product']);
  });

  it('is read the same way by the form, the filter and the menu file', () => {
    expect(admin).toMatch(/kind: itemKind\(item\),/);
    expect(admin).toMatch(/kindFilter === 'all' \|\| itemKind\(m\) === kindFilter/);
    expect(admin).toMatch(/\['set', 'Setlər'\]/);
    expect(readFileSync('lib/excel.ts', 'utf8')).toMatch(/\[COL\.kind\]: KIND_LABEL\[itemKind\(m\)\]/);
    // No screen reads the column on its own.
    expect(admin).not.toMatch(/\.kind \?\? 'product'/);
  });

  it('the database accepts Set', () => {
    expect(sql).toMatch(/check \(kind in \('product', 'meal', 'set'\)\)/);
  });
});

describe('what goes inside a set', () => {
  it('is a meal or a product: not itself, not another set, not twice', () => {
    expect(setChoices(menu, 'set2', []).map(m => m.id)).toEqual(['ayran', 'dolma', 'cay']);
    expect(setChoices(menu, 'set2', [{ id: 'ayran' }]).map(m => m.id)).toEqual(['dolma', 'cay']);
  });

  it('is found without Azerbaijani letters', () => {
    expect(azNormalize('Çay ŞƏKƏR')).toBe('cay seker');
    expect(searchByName(menu, 'dolmasi').map(m => m.id)).toEqual(['dolma']);
    expect(searchByName(menu, 'cay').map(m => m.id)).toEqual(['cay']);
    expect(searchByName(menu, '  ')).toHaveLength(menu.length);
  });

  it('shows under the set in the menu list, without parts deleted since', () => {
    expect(setLine(menu[2].setItems, menu)).toBe('ATENA AYRAN 200 ML × 1 · Yarpaq dolması × 2');
    expect(setLine([{ id: 'gone', qty: 1 }, { id: 'cay', qty: 1 }], menu)).toBe('Çay × 1');
    expect(setLine(undefined, menu)).toBe('');
  });

  it('is emptied when Növ is switched away from Set', () => {
    expect(admin).toContain("cleanSetItems(id, form.kind === 'set' ? form.setItems.map(");
    expect(admin).toMatch(/parseFloat\(p\.qty\), variantId: p\.variantId \}\)\) : \[\]\) : undefined,/);
  });
});

describe('selling a set', () => {
  const lines = sql.slice(sql.indexOf('function public.order_stock_lines('), sql.indexOf('$function$;'));
  const take = sql.slice(sql.indexOf('function public.take_order_stock('));

  it('takes each part\'s recipe, times how many are inside', () => {
    expect(lines).toMatch(/jsonb_array_elements\(s\.parts\) p/);
    expect(lines).toMatch(/select \(p->>'id'\)::uuid, null, s\.n \* \(p->>'qty'\)::numeric/);
  });

  it('does not also take the set\'s own recipe', () => {
    expect(lines).toMatch(/select s\.menu_item_id, s\.variant_id, s\.n from sold s where s\.parts is null/);
  });

  it('writes the movements and the balances from the same rows', () => {
    expect(take.match(/from order_stock_lines\(p_order_id, p_company_id\) l/g)).toHaveLength(2);
    expect(take).not.toMatch(/join recipe_lines/);
  });

  it('is closed to every browser', () => {
    expect(sql).toMatch(/revoke execute on function public\.order_stock_lines\(text, uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke execute on function public\.take_order_stock\(text, uuid, text\) from public, anon, authenticated;/);
  });
});

describe('a recipe', () => {
  it('is saved without empty rows, with a doubled ingredient counted once', () => {
    expect(cleanRecipe([
      { stockItemId: 'et', qty: '0.15' }, { stockItemId: 'duyu', qty: '' }, { stockItemId: '', qty: '2' },
      { stockItemId: 'et', qty: '0,05' }, { stockItemId: 'yarpaq', qty: '0' }, { stockItemId: 'sogan', qty: 1 },
    ])).toEqual([{ stockItemId: 'et', qty: 0.15 + 0.05 }, { stockItemId: 'sogan', qty: 1 }]);
  });

  it('lives in the menu form, not in Anbar', () => {
    expect(anbar).not.toMatch(/recipes|Reseptlər|saveRecipe/);
    expect(admin).toMatch(/form\.kind === 'meal' && \(/);
  });

  it('is saved after its dish, and only when it really loaded', () => {
    expect(admin).toMatch(/if \(saved && item\.kind === 'meal' && recipe\.state === 'ready'\) \{\s+const err = await saveRecipe\(item\.id, cleanRecipe\(recipe\.rows\)\);/);
    const fetch = store.slice(store.indexOf('export async function fetchRecipeForm('), store.indexOf('export async function saveRecipe('));
    expect(fetch.match(/return null;/g)!.length).toBeGreaterThanOrEqual(3);
    expect(fetch).not.toMatch(/return \[\]/);
  });

  it('leaves a product\'s per-size stock lines alone', () => {
    const save = store.slice(store.indexOf('export async function saveRecipe('), store.indexOf('export async function linkProductStock('));
    expect(save).toMatch(/\.delete\(\)\.eq\('menu_item_id', menuItemId\)\.eq\('company_id', _companyId\)\.is\('variant_id', null\)/);
  });
});
