// 2026-10-08: importing a short price list (only Kateqoriya, Məhsul, Qiymət) wiped
// every matched dish's cost and sizes and turned hidden dishes back on, because a
// missing column read as "empty". A column the file does not have now leaves
// that field alone.

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseMenuFile } from '@/lib/excel';
import type { MenuItem } from '@/types';

function file(rows: Record<string, unknown>[]): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Menyu');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'menyu.xlsx');
}

const latte: MenuItem = {
  id: 'm1', name: 'Latte', category: 'Kofe', price: 5, available: false, costPrice: 1.2,
  variants: [{ id: 'v1', name: 'Böyük', price: 6, costPrice: 1.5 }],
} as MenuItem;

describe('menu import', () => {
  it('keeps cost, sizes and hidden when the file has no such columns', async () => {
    const p = await parseMenuFile(file([{ 'Kateqoriya': 'Kofe', 'Məhsul': 'Latte', 'Qiymət (₼)': 5.5 }]), [latte], [{ name: 'Kofe', available: true }]);
    expect(p.errors).toEqual([]);
    const u = p.updatedItems[0];
    expect(u.price).toBe(5.5);
    expect(u.costPrice).toBe(1.2);
    expect(u.available).toBe(false);
    expect(u.variants).toEqual(latte.variants);
  });

  it('still clears them when the column is there and the cell is empty', async () => {
    const p = await parseMenuFile(file([{
      'Kateqoriya': 'Kofe', 'Məhsul': 'Latte', 'Qiymət (₼)': 5, 'Maya dəyəri (₼)': '', 'Mövcud': 'Bəli', 'Variantlar': '',
    }]), [latte], [{ name: 'Kofe', available: true }]);
    const u = p.updatedItems[0];
    expect(u.costPrice).toBeUndefined();
    expect(u.available).toBe(true);
    expect(u.variants).toBeUndefined();
  });
});
