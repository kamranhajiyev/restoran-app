// The Zibil qutusu, for real, on "restoran testing": a deleted dish keeps its
// recipe in the trash row and gets it back on "Bərpa et" (an ingredient deleted
// since is skipped), an Anbar inqrediyent in a recipe is refused, one never used
// goes for good, one with stock asks first and then waits in the trash with its
// balance, and only the restaurant's owner touches its trash. Runs the real
// lib/store.ts as the owner. Everything is named "Autotest zibil" and is taken
// out before and after, so Kamran test ucun keeps nothing from it.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '@/types';
import { admin, anon, companyA, ownerA, ownerB, sellerA } from './setup';

// lib/store.ts talks through this client: here it is the owner's login.
vi.mock('@/lib/supabase', async () => ({ supabase: (await import('./setup')).ownerA, isOnline: async () => true }));
const store = await import('@/lib/store');

const NAME = 'Autotest zibil';
let warehouseId = '';
let flourId = '';   // in the dish's recipe
let oilId = '';     // in the recipe, then deleted from Anbar before the restore
const dish = { id: randomUUID(), name: `${NAME} plov`, price: 4, category: NAME, available: true } as MenuItem;

async function cleanUp() {
  const { data: items } = await admin.from('stock_items').select('id').eq('company_id', companyA.id).like('name', `${NAME}%`);
  const ids = (items ?? []).map(i => i.id);
  await admin.from('trash_items').delete().eq('company_id', companyA.id).like('data->>name', `${NAME}%`);
  await admin.from('menu_items').delete().eq('company_id', companyA.id).like('name', `${NAME}%`);
  const { data: wh } = await admin.from('warehouses').select('id').eq('company_id', companyA.id).eq('name', `${NAME} anbar`);
  for (const w of wh ?? []) await admin.from('stock_receipts').delete().eq('warehouse_id', w.id);
  if (ids.length) {
    await admin.from('recipe_lines').delete().in('stock_item_id', ids);
    await admin.from('stock_movements').delete().in('stock_item_id', ids);
    await admin.from('stock_balances').delete().in('stock_item_id', ids);
    await admin.from('stock_items').delete().in('id', ids);
  }
  for (const w of wh ?? []) await admin.from('warehouses').delete().eq('id', w.id);
}

async function newStockItem(name: string): Promise<string> {
  const { data, error } = await ownerA.from('stock_items').insert({ company_id: companyA.id, name: `${NAME} ${name}`, unit: 'kq' }).select('id').single();
  if (error) throw new Error(error.message);
  return data.id;
}

async function buy(stockItemId: string, qty: number) {
  const { error } = await ownerA.rpc('record_receipt', {
    p_id: randomUUID(), p_warehouse_id: warehouseId, p_supplier_id: null,
    p_lines: [{ stock_item_id: stockItemId, qty, unit_cost: 1 }], p_note: NAME,
  });
  if (error) throw new Error(error.message);
}

async function trashRow(type: string, name: string) {
  const { data } = await admin.from('trash_items').select('id, data').eq('company_id', companyA.id).eq('type', type).eq('data->>name', name);
  return data ?? [];
}

const recipeOf = async (menuItemId: string) =>
  ((await admin.from('recipe_lines').select('stock_item_id, qty').eq('menu_item_id', menuItemId)).data ?? [])
    .map(l => ({ stock_item_id: l.stock_item_id, qty: Number(l.qty) }));

beforeAll(async () => {
  await cleanUp();
  store.setCompanyContext(companyA.id);
  const wh = await ownerA.from('warehouses').insert({ company_id: companyA.id, name: `${NAME} anbar` }).select('id').single();
  if (wh.error) throw new Error(wh.error.message);
  warehouseId = wh.data.id;
  flourId = await newStockItem('un');
  oilId = await newStockItem('yağ');
  const made = await ownerA.from('menu_items').insert({
    id: dish.id, company_id: companyA.id, name: dish.name, price: dish.price, category: dish.category, position: 0, kind: 'meal',
  });
  if (made.error) throw new Error(made.error.message);
  const rec = await ownerA.from('recipe_lines').insert([
    { company_id: companyA.id, menu_item_id: dish.id, stock_item_id: flourId, qty: 0.2 },
    { company_id: companyA.id, menu_item_id: dish.id, stock_item_id: oilId, qty: 0.05 },
  ]);
  if (rec.error) throw new Error(rec.error.message);
});

afterAll(cleanUp);

describe('a deleted dish', () => {
  it('goes to the trash with its recipe', async () => {
    expect(await store.trashMenuItems([dish])).toBeNull();
    const rows = await trashRow('menu', dish.name);
    expect(rows).toHaveLength(1);
    const { item, recipe } = store.trashedMenuItem(rows[0].data);
    expect(item.id).toBe(dish.id);
    expect(recipe.map(l => [l.stock_item_id, l.qty]).sort()).toEqual([[flourId, 0.2], [oilId, 0.05]].sort());

    // Then the dish is deleted, and the database takes its recipe with it.
    expect((await ownerA.from('menu_items').delete().eq('id', dish.id)).error).toBeNull();
    expect(await recipeOf(dish.id)).toEqual([]);
  });

  it('is in no one else\'s trash, and only the owner may change it', async () => {
    const [row] = await trashRow('menu', dish.name);
    expect((await ownerB.from('trash_items').select('id').eq('id', row.id)).data).toEqual([]);
    expect((await anon.from('trash_items').select('id').eq('id', row.id)).data ?? []).toEqual([]);
    // The seller reads it (same restaurant) but can neither empty nor add to it.
    expect((await sellerA.from('trash_items').select('id').eq('id', row.id)).data).toHaveLength(1);
    await sellerA.from('trash_items').delete().eq('id', row.id);
    await ownerB.from('trash_items').delete().eq('id', row.id);
    expect(await trashRow('menu', dish.name)).toHaveLength(1);
    expect((await sellerA.from('trash_items').insert({ type: 'menu', company_id: companyA.id, data: { name: `${NAME} satıcı` } })).error).not.toBeNull();
    expect((await ownerB.from('trash_items').insert({ type: 'menu', company_id: companyA.id, data: { name: `${NAME} B` } })).error).not.toBeNull();
  });

  it('comes back with its recipe, skipping an ingredient deleted from Anbar since', async () => {
    // The oil was bought once, so Anbar trashes it rather than deleting it.
    await buy(oilId, 1);
    expect(await store.trashStockItem(oilId, true)).toEqual({ result: 'trashed' });

    const [row] = await trashRow('menu', dish.name);
    const { item, recipe } = store.trashedMenuItem(row.data);
    expect((await ownerA.from('menu_items').insert({
      id: item.id, company_id: companyA.id, name: item.name, price: item.price, category: item.category, position: 0, kind: 'meal',
    })).error).toBeNull();
    expect(await store.restoreRecipe(item.id, recipe)).toEqual({ error: null, skipped: 1 });
    // "Bərpa et" pressed twice puts nothing in twice.
    expect(await store.restoreRecipe(item.id, recipe)).toEqual({ error: null, skipped: 1 });
    expect(await store.restoreFromTrash(row.id)).toBeNull();

    expect(await recipeOf(dish.id)).toEqual([{ stock_item_id: flourId, qty: 0.2 }]);
    expect(await trashRow('menu', dish.name)).toEqual([]);
  });
});

describe('an Anbar inqrediyent', () => {
  it('in a recipe is refused, with the dish named', async () => {
    expect(await store.trashStockItem(flourId)).toEqual({ result: 'in_recipe', dishes: [dish.name], product: false });
    expect((await admin.from('stock_items').select('trashed_at').eq('id', flourId).single()).data!.trashed_at).toBeNull();
  });

  it('never used goes for good, with no trash row', async () => {
    const id = await newStockItem('boş');
    expect(await store.trashStockItem(id)).toEqual({ result: 'deleted' });
    expect((await admin.from('stock_items').select('id').eq('id', id)).data).toEqual([]);
    expect(await trashRow('stock_item', `${NAME} boş`)).toEqual([]);
  });

  it('with stock left asks first, then waits in the trash and comes back with its stock', async () => {
    const id = await newStockItem('düyü');
    await buy(id, 3);
    expect(await store.trashStockItem(id)).toEqual({ result: 'has_stock', qty: 3, unit: 'kq' });
    expect((await admin.from('stock_items').select('trashed_at').eq('id', id).single()).data!.trashed_at).toBeNull();

    expect(await store.trashStockItem(id, true)).toEqual({ result: 'trashed' });
    expect((await admin.from('stock_items').select('trashed_at').eq('id', id).single()).data!.trashed_at).not.toBeNull();
    const rows = await trashRow('stock_item', `${NAME} düyü`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].data.qty)).toBe(3);

    expect((await ownerA.rpc('restore_stock_item', { p_stock_item_id: id })).error).toBeNull();
    expect((await admin.from('stock_items').select('trashed_at').eq('id', id).single()).data!.trashed_at).toBeNull();
    expect(await trashRow('stock_item', `${NAME} düyü`)).toEqual([]);
    const { data: bal } = await admin.from('stock_balances').select('qty').eq('stock_item_id', id).eq('warehouse_id', warehouseId).single();
    expect(Number(bal!.qty)).toBe(3);
  });

  it('is the owner\'s alone', async () => {
    const id = await newStockItem('qoruq');
    await buy(id, 2);
    expect((await sellerA.rpc('trash_stock_item', { p_stock_item_id: id, p_confirm: true })).error?.message).toMatch(/not_owner/);
    expect((await anon.rpc('trash_stock_item', { p_stock_item_id: id, p_confirm: true })).error).not.toBeNull();
    // Another restaurant's owner finds nothing of ours to trash.
    expect((await ownerB.rpc('trash_stock_item', { p_stock_item_id: id, p_confirm: true })).data).toEqual({ result: 'gone' });
    expect((await admin.from('stock_items').select('trashed_at').eq('id', id).single()).data!.trashed_at).toBeNull();

    expect(await store.trashStockItem(id, true)).toEqual({ result: 'trashed' });
    expect((await sellerA.rpc('restore_stock_item', { p_stock_item_id: id })).error?.message).toMatch(/not_owner/);
    await ownerB.rpc('restore_stock_item', { p_stock_item_id: id });
    expect((await admin.from('stock_items').select('trashed_at').eq('id', id).single()).data!.trashed_at).not.toBeNull();
  });
});
