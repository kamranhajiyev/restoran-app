// Natiq, 2026-10-16: Dolma was made a Məhsul, so it got its own row in Anbar;
// turned back into a Yemək, the row stayed there. A Məhsul that changes Növ now
// lets go of its row, and the admin asks before anything with stock goes.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { formRecipeLines, kindChangeStock, leftStockMessage, recipeLostMessage } from '../lib/kind-change';

const sql = readFileSync('supabase/migrations/20261026_product_stops_being_product.sql', 'utf8');
const admin = readFileSync('app/admin/page.tsx', 'utf8');

describe('what a Növ change does to stock', () => {
  it('a Məhsul leaving is a release, whatever it becomes', () => {
    expect(kindChangeStock('product', 'meal')).toBe('release');
    expect(kindChangeStock('product', 'set')).toBe('release');
  });

  it('a Yemək becoming a Məhsul loses its recipe', () => {
    expect(kindChangeStock('meal', 'product')).toBe('drop-recipe');
  });

  it('a new item or no change does nothing', () => {
    expect(kindChangeStock(null, 'product')).toBe('none');
    expect(kindChangeStock('product', 'product')).toBe('none');
    expect(kindChangeStock('meal', 'set')).toBe('none');
  });

  it('a Məhsul\'s own line never shows as a Yemək\'s recipe', () => {
    const own = [{ stockItemId: 'dolma', qty: 1 }];
    expect(formRecipeLines('product', own)).toEqual([]);
    expect(formRecipeLines('meal', own)).toEqual(own);
  });

  it('asks in numbers', () => {
    expect(leftStockMessage([{ stockItemId: 'd', name: 'Dolma', unit: 'ədəd', qty: 12 }]))
      .toBe('Anbarda 12 ədəd Dolma qalıb. Silinsin, yoxsa inqrediyent kimi qalsın?');
    expect(recipeLostMessage(2)).toContain('2 inqrediyent silinəcək');
    expect(recipeLostMessage(null)).toContain('varsa, silinəcək');
  });
});

describe('the database', () => {
  it('lets go of the row when kind leaves product', () => {
    expect(sql).toMatch(/after update of kind on public\.menu_items/);
    expect(sql).toMatch(/if old\.kind = 'product' and new\.kind is distinct from 'product' then\s+perform public\.release_product_stock\(new\.id\);/);
  });

  it('deletes only a row that is empty and never used', () => {
    const release = sql.slice(sql.indexOf('function public.release_product_stock'), sql.indexOf('function public.trg_release_product_stock'));
    expect(release).toMatch(/not exists \(select 1 from stock_movements where stock_item_id = r\.stock_item_id\)\s+and not exists \(select 1 from stock_balances where stock_item_id = r\.stock_item_id and qty <> 0\)/);
  });

  it('takes back a free row of its name when it is a Məhsul again, never one from the trash', () => {
    expect(sql).toMatch(/sid := free_product_stock\(cid, nm\);/);
    expect(sql).toMatch(/sid := free_product_stock\(cid, vnm\);/);
    const free = sql.slice(sql.indexOf('function public.free_product_stock'), sql.indexOf('revoke all on function public.free_product_stock'));
    expect(free).toMatch(/si\.trashed_at is null/);
  });

  it('cleans up the ones already left behind', () => {
    // Only the line named after the dish itself: another product's row in a
    // recipe on purpose stays.
    expect(sql).toMatch(/and m\.kind is distinct from 'product'\s+and si\.type = 'product'\s+and \(si\.name = m\.name or si\.name like m\.name \|\| ' %'\)/);
    expect(sql).toMatch(/delete from public\.stock_items si\s+where si\.type = 'product' and si\.trashed_at is null/);
  });

  it('gives the public key nothing', () => {
    expect(sql).toMatch(/revoke all on function public\.release_product_stock\(uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.product_stock_left\(uuid\) from public, anon;/);
    expect(sql).toMatch(/revoke all on function public\.settle_product_stock\(uuid\[\], boolean\) from public, anon;/);
    expect(sql).toMatch(/revoke all on function public\.free_product_stock\(uuid, text\) from public, anon, authenticated;/);
    expect(sql).not.toMatch(/to anon/);
  });
});

describe('the admin form', () => {
  it('uses these rules, not its own', () => {
    expect(admin).toMatch(/kindChangeStock\(before \? itemKind\(before\) : null, form\.kind\)/);
    expect(admin).toMatch(/formRecipeLines\(kind, r\.lines\)/);
    expect(admin).toMatch(/fetchProductStockLeft\(editingId\)/);
    expect(admin).toMatch(/settleProductStock\(settle\.ids, settle\.keep\)/);
  });
});

// Natiq, 2026-10-16: the dialog said "xammal" while Anbar says "İnqrediyent"
// for the same row. One word on every screen.
describe('the word', () => {
  it('is İnqrediyent everywhere, never xammal', async () => {
    const { readdirSync, statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const f of readdirSync(dir)) {
        const p = join(dir, f);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|tsx)$/.test(f) && /xammal/i.test(readFileSync(p, 'utf8'))) found.push(p);
      }
    };
    ['app', 'components', 'lib', 'electron'].forEach(walk);
    expect(found).toEqual([]);
  });
});
