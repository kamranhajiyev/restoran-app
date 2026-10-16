// Natiq, 2026-10-16: Anbar's delete was a real delete. The database refused it
// for anything ever used ("hərəkəti var"), and had it gone through, a receipt
// would keep its total but lose the line. A used inqrediyent now goes to the
// Zibil qutusu with its history.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goneItems, stockLeftQuestion, stockTrashDone, stockTrashMessage } from '../lib/stock-trash';

const sql = readFileSync('supabase/migrations/20261027_stock_item_trash.sql', 'utf8');
const anbar = readFileSync('components/AnbarPanel.tsx', 'utf8');
const admin = readFileSync('app/admin/page.tsx', 'utf8');
const store = readFileSync('lib/store.ts', 'utf8');

describe('what the screen says', () => {
  it('names the dishes that still use it', () => {
    expect(stockTrashMessage({ result: 'in_recipe', dishes: ['Dolma', 'Plov'], product: false }, 'Yağ'))
      .toBe('«Yağ» bu yeməklərin reseptində var: Dolma, Plov. Əvvəlcə reseptdən çıxarın.');
    expect(stockTrashMessage({ result: 'in_recipe', dishes: ['Ayran'], product: true }, 'Ayran'))
      .toContain('menyuda Məhsuldur');
  });

  it('asks before stock goes, in numbers', () => {
    expect(stockLeftQuestion(3, 'kq', 'Düyü')).toMatch(/^Anbarda 3 kq Düyü qalıb — silinsin\?/);
    expect(stockLeftQuestion(2.5, 'kq', 'Un')).toMatch(/^Anbarda 2\.5 kq Un qalıb/);
    expect(stockLeftQuestion(0, 'kq', 'Un')).toMatch(/^Un anbarlarda sıfır deyil/);
  });

  it('says where it went', () => {
    expect(stockTrashMessage({ result: 'trashed' }, 'Düyü')).toBeNull();
    expect(stockTrashDone({ result: 'trashed' })).toBe('Zibil qutusuna göndərildi');
    expect(stockTrashDone({ result: 'deleted' })).toBe('Silindi');
  });
});

describe('the database', () => {
  it('refuses one in a recipe before anything else', () => {
    expect(sql.indexOf("'in_recipe'")).toBeLessThan(sql.indexOf('delete from stock_items'));
  });

  it('deletes for good only what was never used', () => {
    expect(sql).toMatch(/if not has_left and not exists \(select 1 from stock_movements where stock_item_id = si\.id\) then\s+delete from stock_balances/);
  });

  it('asks before stock goes, then trashes it with a row to restore from', () => {
    expect(sql).toMatch(/if has_left and not p_confirm then/);
    expect(sql).toMatch(/coalesce\(bool_or\(qty <> 0\), false\)/);
    expect(sql).toMatch(/update stock_items set trashed_at = now\(\)/);
    expect(sql).toMatch(/insert into trash_items \(type, data, company_id\)\s+values \('stock_item'/);
  });

  it('is the owner\'s, and gives the public key nothing', () => {
    expect(sql.match(/role = 'owner'/g)?.length).toBe(2);
    expect(sql).toMatch(/revoke all on function public\.trash_stock_item\(uuid, boolean\) from public, anon;/);
    expect(sql).toMatch(/revoke all on function public\.restore_stock_item\(uuid\) from public, anon;/);
    expect(sql).not.toMatch(/to anon/);
  });
});

describe('the screens', () => {
  it('Anbar goes through the database\'s decision, never a plain delete', () => {
    expect(anbar).toMatch(/trashStockItem\(it\.id, confirm\)/);
    expect(store).not.toMatch(/from\('stock_items'\)\.delete\(\)/);
  });

  it('the Zibil qutusu shows and restores it', () => {
    expect(admin).toMatch(/item\.type === 'stock_item' \? 'İnqrediyent'/);
    expect(admin).toMatch(/restoreStockItem\(String\(item\.data\.id/);
  });

  it('an old purchase shows a trashed inqrediyent by its own name, not the first live one', () => {
    const gone = goneItems([{ stockItemId: 'd', name: 'Düyü', unit: 'kq' }, { stockItemId: 'u', name: 'Un', unit: 'kq' }], [{ id: 'u' }]);
    expect([...gone.entries()]).toEqual([['d', { name: 'Düyü (silinib)', unit: 'kq' }]]);
    expect(anbar).toMatch(/gone\.has\(l\.stockItemId\) && <option value=\{l\.stockItemId\}>/);
  });

  it('a dish back from the trash does not take a trashed inqrediyent again', () => {
    expect(store).toMatch(/!\(s\.trashed_at && s\.type !== 'product'\)/);
  });
});
