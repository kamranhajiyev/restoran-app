// Mağaza modu, step 5 (SHOP-MODE.md): Qaytarma. A return is its own record;
// a manager approves every one; with a receipt it is priced as paid and never
// more than was bought; cash leaves the drawer as a Kassa movement, a card
// return lowers the Terminal figure; every report takes it off through
// lib/returns, so no two screens count it differently. Online only.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  cartToReturnLines, netOfReturns, parseReceiptLabel, requestTotal, returnErrorText,
  returnTotals, saleForReturn, type SaleReturn,
} from '@/lib/returns';
import { refundNeeds, TILL_ACTIONS } from '@/lib/till-rules';
import { shiftSales } from '@/lib/shift-sales';
import { historyReportLines } from '@/lib/history-report';
import { itemSalesAfterReturns } from '@/lib/item-sales';
import { returnReceiptLines } from '@/lib/printer';

const read = (p: string) => readFileSync(p, 'utf8');

const ret = (over: Partial<SaleReturn>): SaleReturn => ({
  id: 'r', orderId: null, total: 2, pay: 'cash', sellerName: 'Kamran', approvedBy: 'Menecer', createdAt: '2026-11-14T10:00:00Z',
  lines: [{ menuItemId: 'cappy', variantId: null, name: 'Cappy', qty: 1, price: 2 }], ...over,
});

describe('the figures', () => {
  it('a 6.60 sale and a 2.00 cash return leave 4.60 for the day', () => {
    const back = returnTotals([ret({})]);
    expect(back).toEqual({ cash: 2, card: 0, total: 2 });
    expect(Math.round((6.6 - back.total) * 100) / 100).toBe(4.6);
  });

  it('cash and card returns are kept apart', () => {
    expect(returnTotals([ret({ total: 2 }), ret({ total: 1.5, pay: 'card' }), ret({ total: 0.7 })]))
      .toEqual({ cash: 2.7, card: 1.5, total: 4.2 });
  });

  it('a card return lowers the shift\'s Terminal figure; a cash one does not (it is a Kassa movement)', () => {
    const paid = [{ cash_amount: 6.6, card_amount: 0 }, { cash_amount: 0, card_amount: 5 }];
    expect(shiftSales(paid, [], [{ total: 1.5 }])).toMatchObject({ cash: 6.6, card: 3.5 });
    expect(shiftSales(paid, [])).toMatchObject({ cash: 6.6, card: 5 });
  });

  it('Statistika: income, cost and profit after returns, at each item\'s cost', () => {
    const n = netOfReturns({ revenue: 6.6, cost: 3 }, [ret({})], id => (id === 'cappy' ? 1.2 : 0));
    expect(n).toMatchObject({ revenue: 4.6, cost: 1.8, profit: 2.8, back: 2 });
    expect(n.marginPct).toBeCloseTo(60.87, 1);
  });

  it('Top məhsullar: a returned item is not counted as sold', () => {
    const item = (id: string, name: string, qty: number, rev: number) => ({ id, name, category: 'İçki', qty, rev, sizes: { '': { qty, rev } } });
    const sales = { items: [item('cappy', 'Cappy', 2, 4), item('su', 'Su', 1, 0.5)], service: 0, total: 4.5 };
    const after = itemSalesAfterReturns(sales, [ret({})]);
    expect(after.items.find(i => i.id === 'cappy')).toMatchObject({ qty: 1, rev: 2, sizes: { '': { qty: 1, rev: 2 } } });
    expect(after.items.find(i => i.id === 'su')).toEqual(sales.items[1]);
    expect(after.total).toBe(2.5);
    const all = ret({ total: 4, lines: [{ menuItemId: 'cappy', variantId: null, name: 'Cappy', qty: 2, price: 2 }] });
    expect(itemSalesAfterReturns(sales, [all]).items.map(i => i.id)).toEqual(['su']);
    expect(sales.items[0].qty).toBe(2);   // the orders' own list is left alone
  });

  it('the printed Hesabat shows the returns and what is left after them', () => {
    const lines = historyReportLines(
      { count: 1, toplam: 6.6, endirim: 0, cemi: 6.6, nagd: 6.6, kart: 0, kuryer: 0, legv: { count: 0, sum: 0 } } as never,
      { companyName: 'Test Mağaza', from: '2026-11-14T00:00:00Z', to: '2026-11-14T20:00:00Z', printedBy: 'Kamran', timezone: 'Asia/Baku', returns: returnTotals([ret({})]) },
    ).map(l => l.text.replace(/\s+/g, ' '));
    expect(lines).toContain('Qaytarma -2.00m');
    expect(lines).toContain('Qaytarmadan sonra 4.60m');
  });
});

describe('with a receipt', () => {
  it('reads "45" and "45/2" (till 2)', () => {
    expect(parseReceiptLabel('45')).toEqual({ number: 45, till: null });
    expect(parseReceiptLabel(' №45/2 ')).toEqual({ number: 45, till: 2 });
    expect(parseReceiptLabel('abc')).toBeNull();
  });

  it('offers what is left, at the price paid after the bill\'s discount', () => {
    const sale = saleForReturn({ id: 'o', label: '45', discountAmount: 1 },
      [
        { menuItemId: 'cappy', variantId: null, name: 'Cappy', qty: 2, price: 2 },
        { menuItemId: 'cappy', variantId: null, name: 'Cappy', qty: 1, price: 2 },
        { menuItemId: 'su', variantId: null, name: 'Su', qty: 2, price: 0.5 },
      ],
      [{ menuItemId: 'su', variantId: null, qty: 2 }]);
    // gross 7.00, discount 1.00 → Cappy's 6.00 is worth 5.14, all three together.
    expect(sale.lines).toEqual([{ menuItemId: 'cappy', variantId: null, name: 'Cappy', left: 3, price: 1.713333 }]);
    expect(requestTotal([{ qty: 3, price: 1.713333 }])).toBe(5.14);
  });
});

describe('the till', () => {
  const seller = read('app/seller/page.tsx');
  it('asks a manager every time, rules or not; a manager doing it is the approval', () => {
    expect(refundNeeds(null, 'seller')).toBe('approve');
    expect(refundNeeds({ seller: { refund: 'free' } }, 'seller')).toBe('approve');
    expect(refundNeeds({ seller: { refund: 'deny' } }, 'seller')).toBe('deny');
    expect(refundNeeds({ seller: { refund: 'deny' } }, 'manager')).toBe('manager');
    expect(TILL_ACTIONS.find(a => a.id === 'refund')?.label).toBe('Qaytarma');
    expect(seller).toMatch(/const approver = await approveReturn\(\);\s+if \(!approver\) return;/);
  });

  it('sends a return once even when pressed again after a lost reply, and never queues it', () => {
    expect(seller).toMatch(/if \(returnIdRef\.current\?\.key !== key\) returnIdRef\.current = \{ key, id: crypto\.randomUUID\(\) \};/);
    const fn = seller.slice(seller.indexOf('async function submitReturn()'), seller.indexOf('// A barcode, scanned anywhere'));
    expect(fn).not.toMatch(/enqueue|postOrQueue|toLocal/);
  });

  it('turns a refusal into words the cashier understands', () => {
    expect(returnErrorText('more_than_sold')).toMatch(/alınandan çox/);
    expect(returnErrorText('no_shift')).toMatch(/növbə açıq/);
    expect(returnErrorText('Failed to fetch')).toMatch(/yalnız internetlə/);
  });

  it('cart lines become return lines, with the size', () => {
    expect(cartToReturnLines([{ menuItem: { id: 'f', name: 'Fanta', price: 3 }, quantity: 2, variantId: 'v1', modifiers: '1 L' }]))
      .toEqual([{ menuItemId: 'f', variantId: 'v1', name: 'Fanta (1 L)', qty: 2, price: 3 }]);
    expect(requestTotal([{ qty: 3, price: 0.7 }, { qty: 1, price: 1.9 }])).toBe(4);
  });

  it('prints a Qaytarma receipt with a minus total and who approved it', () => {
    const t = returnReceiptLines(ret({}), 'Test Mağaza', '45').map(l => l.text.replace(/\s+/g, ' '));
    expect(t).toContain('QAYTARMA');
    expect(t).toContain('Qəbz #45');
    expect(t).toContain('CƏMİ: -2.00');
    expect(t).toContain('Təsdiq: Menecer');
  });

  it('Tarixçə shows the returns and Cəmi after them, in a shop', () => {
    expect(seller).toMatch(/const historyBack = returnTotals\(historyReturns \?\? \[\]\);/);
    expect(seller).toMatch(/afterReturns\(historyRevenue, isShop \? historyBack : \{ total: 0 \}\)/);
  });
});

describe('the database', () => {
  const sql = read('supabase/migrations/20261113_returns.sql');
  const route = read('app/api/add-return/route.ts');
  it('saves through one function, closed to the public key', () => {
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/revoke all on function public\.record_return\(uuid, text, jsonb, text, text, text, uuid\) from public, anon;/);
    expect(sql).toMatch(/revoke all on public\.returns, public\.return_lines from anon;/);
    expect(sql).not.toMatch(/create policy \w+ on public\.returns for (insert|update|delete|all)/);
  });
  it('never gives back more than was bought, or without a manager', () => {
    expect(sql).toMatch(/if back \+ ln\.qty > sold then raise exception 'more_than_sold'/);
    expect(sql).toMatch(/raise exception 'not_approved'/);
  });
  it('takes cash out of the open shift as a Kassa movement keyed by the return', () => {
    expect(sql).toMatch(/'id', p_id::text, 'at', now\(\), 'amount', -tot/);
  });
  it('a link till is checked before it can return anything', () => {
    expect(route).toMatch(/if \(!\(await verifySellerToken\(companyId, token \?\? ''\)\)\)/);
  });
});
