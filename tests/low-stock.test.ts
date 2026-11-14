// Mağaza modu, step 6 (SHOP-MODE.md): az qalan mal. The owner sets a limit in
// Anbar; below it, the item comes first in Qalıqlar marked "az qalıb", Anbar
// gets a red count, and the till's card says "3 qalıb". A sale is never
// blocked, and no limit means no warning.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { leftLabel, lowForTill, lowKey, lowStock, stockTotals } from '@/lib/low-stock';

const read = (p: string) => readFileSync(p, 'utf8');

describe('running low', () => {
  const bal = [
    { stockItemId: 'cappy', qty: 2 }, { stockItemId: 'cappy', qty: 1 }, // two warehouses
    { stockItemId: 'su', qty: 40 },
    { stockItemId: 'fanta-1l', qty: 0 },
  ];
  it('counts the stock over every warehouse', () => {
    expect(stockTotals(bal).get('cappy')).toBe(3);
  });
  it('is below the limit, not at it; no limit or 0 never warns', () => {
    const low = lowStock([
      { stockItemId: 'cappy', minQty: 5 },
      { stockItemId: 'su', minQty: 40 },
      { stockItemId: 'fanta-1l', minQty: 0 },
      { stockItemId: 'never-bought', minQty: 2 },
    ], bal);
    expect(low).toEqual([
      { stockItemId: 'cappy', qty: 3, minQty: 5 },
      { stockItemId: 'never-bought', qty: 0, minQty: 2 },
    ]);
  });
  it('reaches the till per product, or per size', () => {
    const low = [{ stockItemId: 'cappy', qty: 3, minQty: 5 }, { stockItemId: 'fanta-1l', qty: 0, minQty: 2 }];
    const links = [
      { menuItemId: 'm-cappy', variantId: null, stockItemId: 'cappy' },
      { menuItemId: 'm-fanta', variantId: 'v-1l', stockItemId: 'fanta-1l' },
      { menuItemId: 'm-su', variantId: null, stockItemId: 'su' },
    ];
    expect(lowForTill(low, links)).toEqual({ [lowKey('m-cappy')]: 3, [lowKey('m-fanta', 'v-1l')]: 0 });
  });
  it('reads "3 qalıb", and "Bitib" when none is left', () => {
    expect(leftLabel(3)).toBe('3 qalıb');
    expect(leftLabel(0.25)).toBe('0.25 qalıb');
    expect(leftLabel(0)).toBe('Bitib');
  });
});

describe('where it shows', () => {
  it('a link till asks a checked route that answers nothing but the low ones', () => {
    const route = read('app/api/public-low-stock/route.ts');
    expect(route).toMatch(/const refused = await refuseTillRead\(req, companyId\);/);
    expect(route).toMatch(/\.eq\('company_id', companyId\)/);
    expect(route).toMatch(/return Response\.json\(\{ low: \{\} \}\)/);
    expect(read('app/seller/page.tsx')).toMatch(/\/api\/public-low-stock\?companyId=\$\{overrideCompanyId\}/);
  });
  it('the till card warns, and never blocks the sale', () => {
    const seller = read('app/seller/page.tsx');
    expect(seller).toMatch(/const own = lowLeft\[lowKey\(item\.id\)\];/);
    expect(seller).not.toMatch(/lowLeft[^\n]*return;/);
  });
  it('Anbar takes the limit and puts the low ones first; the tab gets a red count', () => {
    const anbar = read('components/AnbarPanel.tsx');
    expect(anbar).toMatch(/\{shop && \(\s*<label[^>]*>\s*Limit/);
    expect(anbar).toMatch(/\.sort\(\(a, b\) => Number\(lowIds\.has\(b\.stockItemId\)\) - Number\(lowIds\.has\(a\.stockItemId\)\)\)/);
    const admin = read('app/admin/page.tsx');
    expect(admin).toMatch(/: n\.id === 'anbar' && lowCount > 0 \? lowCount : null;/);
  });
});
