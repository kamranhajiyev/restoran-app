// Code review, 2026-10-08: deleting a dish deletes its recipe (FK cascade), and
// "Bərpa et" brought the dish back without it, so it sold without ever taking
// stock, with no error anywhere. Restore also deleted the trash copy before the
// dish was saved back, and a dish linked to a deleted modifier set made the
// menu save drop every dish's sets.

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem } from '@/types';

const tables: Record<string, unknown[]> = {};
const calls: { op: string; table: string; rows?: unknown }[] = [];

const chain = (result: unknown) => {
  const c: Record<string, unknown> = {};
  for (const k of ['select', 'order', 'eq', 'not', 'in', 'neq', 'lt']) c[k] = () => c;
  c.then = (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
  return c;
};

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: (table: string) => ({
      select: () => chain({ data: tables[table] ?? [], error: null }),
      upsert: async (rows: unknown) => { calls.push({ op: 'upsert', table, rows }); return { error: null }; },
      insert: async (rows: unknown) => { calls.push({ op: 'insert', table, rows }); return { error: null }; },
      delete: () => { calls.push({ op: 'delete', table }); return chain({ error: null }); },
    }),
  },
}));

const LATTE = '11111111-1111-4111-8111-111111111111';
const latte = { id: LATTE, name: 'Latte', price: 5, category: 'Kofe', available: true } as MenuItem;

async function store() {
  vi.resetModules();
  const s = await import('@/lib/store');
  s.setCompanyContext('c1');
  return s;
}

describe('a dish in the trash', () => {
  beforeEach(() => { calls.length = 0; for (const k of Object.keys(tables)) delete tables[k]; });

  it('takes its recipe with it', async () => {
    const s = await store();
    tables.recipe_lines = [
      { menu_item_id: LATTE, stock_item_id: 'milk', qty: '0.2', variant_id: null },
      { menu_item_id: 'other', stock_item_id: 'tea', qty: 1, variant_id: null },
    ];
    expect(await s.trashMenuItems([latte])).toBeNull();
    const row = (calls.find(c => c.op === 'insert' && c.table === 'trash_items')!.rows as { data: Record<string, unknown> }[])[0];
    const { item, recipe } = s.trashedMenuItem(row.data);
    expect(item).toEqual(latte);
    expect(recipe).toEqual([{ stock_item_id: 'milk', qty: 0.2, variant_id: null }]);
  });

  it('gets its recipe back, skipping ingredients deleted since', async () => {
    const s = await store();
    tables.stock_items = [{ id: 'milk' }];
    const r = await s.restoreRecipe(LATTE, [
      { stock_item_id: 'milk', qty: 0.2, variant_id: 'big' },
      { stock_item_id: 'gone', qty: 1, variant_id: null },
    ]);
    expect(r).toEqual({ error: null, skipped: 1 });
    const up = calls.find(c => c.op === 'upsert' && c.table === 'recipe_lines')!;
    expect(up.rows).toEqual([{ company_id: 'c1', menu_item_id: LATTE, stock_item_id: 'milk', qty: 0.2, variant_id: 'big' }]);
  });

  it('linked to a deleted modifier set does not cost the other dishes their sets', async () => {
    const s = await store();
    tables.menu_items = [];
    await s.fetchMenu();
    tables.modifier_groups = [{ id: 'syrups' }];
    const tea = { id: '22222222-2222-4222-8222-222222222222', name: 'Çay', price: 1, category: 'İçki', available: true, modifierGroupIds: ['syrups'] };
    expect(await s.saveMenu([{ ...latte, modifierGroupIds: ['deleted-set'] }, tea] as MenuItem[])).toBeNull();
    const ins = calls.find(c => c.op === 'insert' && c.table === 'menu_item_modifier_groups')!;
    expect(ins.rows).toEqual([{ menu_item_id: tea.id, group_id: 'syrups', position: 0 }]);
  });
});

describe('admin', () => {
  const admin = readFileSync('app/admin/page.tsx', 'utf8');
  const fn = (name: string) => admin.slice(admin.indexOf(`function ${name}(`), admin.indexOf('\n  }\n', admin.indexOf(`function ${name}(`)));

  it('restores the dish and its recipe before removing the trash copy', () => {
    const body = fn('restoreTrashItem');
    expect(body.indexOf('await saveMenu(')).toBeGreaterThan(-1);
    expect(body.indexOf('restoreRecipe(')).toBeGreaterThan(body.indexOf('await saveMenu('));
    expect(body.indexOf('restoreFromTrash(')).toBeGreaterThan(body.indexOf('restoreRecipe('));
  });

  it('removes a photo only after its trash row is gone', () => {
    const empty = fn('handleEmptyTrash');
    expect(empty.indexOf("storage.from('menu-images').remove(")).toBeGreaterThan(empty.indexOf('if (err)'));
    const sil = admin.slice(admin.indexOf('await permanentlyDeleteFromTrash(item.id)') - 40, admin.indexOf('await permanentlyDeleteFromTrash(item.id)') + 400);
    expect(sil).toMatch(/if \(err\) \{ setDialog\(.*\); return; \}\s+const paths = trashPhotoPaths\(\[item\], menu\);/);
  });

  it('keeps a photo a live dish still shows', async () => {
    const s = await store();
    const url = 'https://x.supabase.co/storage/v1/object/public/menu-images/c1/latte.jpg';
    const gone = 'https://x.supabase.co/storage/v1/object/public/menu-images/c1/old.jpg';
    const trash = [
      { id: 't1', type: 'menu', data: { name: 'Latte copy', image: url }, deletedAt: '' },
      { id: 't2', type: 'menu', data: { name: 'Old', image: gone }, deletedAt: '' },
    ];
    expect(s.trashPhotoPaths(trash, [{ ...latte, image: url }])).toEqual(['c1/old.jpg']);
  });

  it('keeps a dish whose trash copy was not written', () => {
    const body = fn('deleteItem');
    expect(body).toMatch(/const err = await trashMenuItems\(\[item\]\);\s+if \(err\) \{ setDialog\(.*\); return; \}/);
    expect(body.indexOf('trashMenuItems(')).toBeLessThan(body.indexOf('setMenu('));
    expect(fn('deleteCategory')).toMatch(/trashMenuItems\(itemsInCat\)/);
  });
});
