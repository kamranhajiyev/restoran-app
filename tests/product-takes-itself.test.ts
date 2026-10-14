// Test Restoran, 2026-10-14: "Ayran 200ml" was missing from Anbar. It carried a
// recipe of 10 × Cappy, so every ayran sold took ten Cappy and the ayran itself
// was never counted. A Məhsul now takes only itself, 1 per sale.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync('supabase/migrations/20261022_product_takes_itself.sql', 'utf8');
const sync = sql.slice(sql.indexOf('function public.sync_product_stock'), sql.indexOf('function public.recipe_line_product_guard'));

describe('a Məhsul', () => {
  it('loses every recipe line that is not its own row, and its own take 1', () => {
    expect(sync).toMatch(/delete from recipe_lines\s+where menu_item_id = p_menu_item_id\s+and not product_owns_stock\(p_menu_item_id, stock_item_id\);/);
    expect(sync).toMatch(/update recipe_lines set qty = 1/);
  });

  it('gets its own row even when it had a recipe (a dish turned into a product)', () => {
    // The old early return left such a product with no row in Anbar.
    expect(sync).not.toMatch(/if exists \(select 1 from recipe_lines where menu_item_id = p_menu_item_id and company_id = cid\) then\s+return;/);
  });

  it('never owns another product\'s row: a shared one is its own only by name', () => {
    expect(sql).toMatch(/si\.type = 'product'/);
    expect(sql).toMatch(/or si\.name = m\.name/);
  });

  it('cannot be given a recipe by any screen', () => {
    expect(sql).toMatch(/before insert or update on public\.recipe_lines/);
    expect(sql).toMatch(/new\.qty <> 1 or not product_owns_stock\(new\.menu_item_id, new\.stock_item_id\)/);
  });

  it('fixes the products already wrong, and gives the public key nothing', () => {
    expect(sql).toMatch(/select public\.sync_product_stock\(id\) from public\.menu_items where kind = 'product';/);
    expect(sql).toMatch(/revoke all on function public\.product_owns_stock\(uuid, uuid\) from public, anon, authenticated;/);
    expect(sql).toMatch(/revoke all on function public\.recipe_line_product_guard\(\) from public, anon, authenticated;/);
  });
});
