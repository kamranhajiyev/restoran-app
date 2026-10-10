// A menu typed from a photo becomes the import file through one function
// (lib/menu-text.ts), and the import's own reader must accept what it writes.

import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import { parseMenuFile } from '@/lib/excel';
import { menuTextToRows, menuTextWorkbook } from '@/lib/menu-text';
import type { MenuItem } from '@/types';

function file(text: string): File {
  const buf = XLSX.write(menuTextWorkbook(menuTextToRows(text)), { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'menyu.xlsx');
}

describe('menu from text', () => {
  it('writes a file the import reads without errors', async () => {
    const text = [
      '# Toyuq dönər | suffix=toyuq | kind=meal',
      'Çörəkdə Dönər   2.20',
      '',
      '# Mal dönər | suffix=mal | kind=meal',
      'Çörəkdə Dönər   3,50 (1.40)',
      '// a note',
      '# Sərin içkilər | kind=product',
      'Cola / Fanta / Sprite 0.3 L 1.50',
      'Limonad: Stəkan=5(1.2) | Qrafin=12',
    ].join('\n');
    expect(menuTextToRows(text).errors).toEqual([]);

    const p = await parseMenuFile(file(text), [], []);
    expect(p.errors).toEqual([]);
    expect(p.newCategories.map(c => c.name)).toEqual(['Toyuq dönər', 'Mal dönər', 'Sərin içkilər']);
    expect(p.newItems.map(m => [m.name, m.price, m.costPrice, m.kind])).toEqual([
      ['Çörəkdə Dönər (toyuq)', 2.2, undefined, 'meal'],
      ['Çörəkdə Dönər (mal)', 3.5, 1.4, 'meal'],
      ['Cola / Fanta / Sprite 0.3 L', 1.5, undefined, 'product'],
      ['Limonad', 5, undefined, 'product'],
    ]);
    expect(p.newItems[3].variants?.map(v => [v.name, v.price, v.costPrice])).toEqual([['Stəkan', 5, 1.2], ['Qrafin', 12, undefined]]);
  });

  it('names the line of a repeated dish, a missing price and a dish with no category', () => {
    const { errors } = menuTextToRows(['Midye 1.20', '# Dönər', 'Lavaş 3', 'lavaş 4', 'Kumpir'].join('\n'));
    expect(errors).toHaveLength(3);
    expect(errors[0]).toContain('Line 1');
    expect(errors[1]).toContain('Line 4');
    expect(errors[1]).toContain('line 3');
    expect(errors[2]).toContain('Line 5');
  });

  it('a price-only text leaves cost, sizes, kind and hidden alone on a dish the restaurant has', async () => {
    const latte = {
      id: 'm1', name: 'Latte', category: 'Kofe', price: 5, available: false, costPrice: 1.2, kind: 'meal',
      variants: [{ id: 'v1', name: 'Böyük', price: 6, costPrice: 1.5 }],
    } as MenuItem;
    const p = await parseMenuFile(file('# Kofe\nLatte 5.50'), [latte], [{ name: 'Kofe', available: true }]);
    expect(p.updatedItems[0]).toEqual({ ...latte, price: 5.5 });
  });
});
