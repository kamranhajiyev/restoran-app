import { describe, expect, it } from 'vitest';
import type { ImportPreview } from '@/lib/excel';
import { importBlocked, menuImportRows } from '@/lib/menu-import';

const preview: ImportPreview = {
  newItems: [
    { id: 'a', name: 'Lülə Kabab', category: 'Kabablar', price: 8, available: true, kind: 'meal' },
    { id: 'b', name: 'Ayran', category: 'İçkilər', price: 1, available: false, costPrice: 0.4 },
  ],
  updatedItems: [],
  newCategories: [{ name: 'Kabablar', available: true }, { name: 'İçkilər', available: true }],
  errors: [],
  totalRows: 2,
};

describe('menuImportRows', () => {
  it('writes the rows the admin import writes, all under the one company', () => {
    const { categories, items } = menuImportRows(preview, 'co');
    expect(categories).toEqual([
      { name: 'Kabablar', available: true, qr_visible: true, position: 0, company_id: 'co' },
      { name: 'İçkilər', available: true, qr_visible: true, position: 1, company_id: 'co' },
    ]);
    expect(items[0]).toMatchObject({ id: 'a', kind: 'meal', position: 0, company_id: 'co', qr_visible: true, image: null });
    // No Növ in the file means Məhsul, as in saveMenu.
    expect(items[1]).toMatchObject({ kind: 'product', available: false, cost_price: 0.4, variants: null, position: 1 });
  });
});

describe('importBlocked', () => {
  it('lets only an empty company take a whole menu', () => {
    expect(importBlocked({ items: 0, categories: 0 })).toBeNull();
    expect(importBlocked({ items: 3, categories: 0 })).toMatch(/admin import/);
    expect(importBlocked({ items: 0, categories: 1 })).toMatch(/admin import/);
  });
});
