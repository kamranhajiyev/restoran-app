// Qaytarma, found in the exe and then in review, 2026-11-24 (Natiq, Test
// Restoran PR; no real shop had it): the exe's receipt lookup never reached the
// server and read as "tapılmadı"; refunds over what was paid; reports that left
// the returns in; and the smaller ones below.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MenuItem, Order } from '@/types';
import { historyReportLines } from '@/lib/history-report';
import { itemSales, itemSalesAfterReturns } from '@/lib/item-sales';
import { placeSales } from '@/lib/place-sales';
import { orderTotal } from '@/components/seller/order-format';
import {
  afterReturns, findSale, parseReceiptLabel, refundOf, requestTotal, returnErrorText, saleForReturn, type SaleReturn,
} from '@/lib/returns';
import { categoryReport, netRevenue, payAfterReturns, placesAfterReturns, revenueByHour, sellerStats } from '@/lib/statistics';
import { siteGet, tillFetch } from '@/lib/till-data';
import { tillPost } from '@/lib/till-write';
import { within } from '@/lib/timeout';

const read = (p: string) => readFileSync(p, 'utf8');
const seller = read('app/seller/page.tsx');
const admin = read('app/admin/page.tsx');
const sql = read('supabase/migrations/20261118_return_money.sql');

describe('the exe asks the server', () => {
  afterEach(() => vi.unstubAllGlobals());

  function exe(api: (path: string) => Promise<unknown>) {
    const fetched: string[] = [];
    vi.stubGlobal('fetch', async (p: string) => { fetched.push(String(p)); throw new TypeError('app:// has no server'); });
    vi.stubGlobal('window', { location: { href: 'app://till/' }, posNative: { till: { api } } });
    return fetched;
  }

  it('a receipt lookup through siteGet goes out through the machine; tillFetch never would', async () => {
    const asked: string[] = [];
    const fetched = exe(async path => { asked.push(path); return { ok: true, status: 200, body: '{"sale":null}' }; });
    const path = '/api/public-sale?companyId=c&label=100185';
    expect(await (await siteGet(path)).json()).toEqual({ sale: null });
    expect(asked).toEqual([path]);
    expect(fetched).toEqual([]);
    await expect(tillFetch(path)).rejects.toThrow('no server');
  });

  it('a return is sent the same way, and a dead line is an answer', async () => {
    exe(async () => ({ ok: true, status: 200, body: '{"ok":true,"total":2}' }));
    expect(await tillPost('/api/add-return', {}, 1000)).toEqual({ ok: true, total: 2 });
    exe(() => new Promise(() => {}));
    expect(await tillPost('/api/add-return', {}, 10)).toEqual({ ok: false, error: 'network' });
    await expect(within(new Promise(() => {}), 10)).rejects.toThrow('timeout');
  });

  // Every route tillFetch names must be one the till's own database answers:
  // any other is looked for inside the exe and fails with the line up.
  it('tillFetch is only used for what the till holds itself', () => {
    const local = new Set([...read('lib/till-data.ts').matchAll(/case "(\/api\/[a-z-]+)"/g)].map(m => m[1]));
    // readSaleSettings asks it only in a browser (`!hasLocalDb()`).
    local.add('/api/public-settings');
    const used = [...seller.matchAll(/tillFetch\(\s*[`'"](\/api\/[a-z-]+)/g)].map(m => m[1]);
    expect(used.length).toBeGreaterThan(10);
    expect(used.filter(r => !local.has(r))).toEqual([]);
    expect(seller).toMatch(/if \(linkCompanyId && !hasLocalDb\(\)\) \{\s+const d = await jsonOrNull\(tillFetch\(`\/api\/public-settings/);
  });

  it('Kassa in a shop closes on the server\'s figures, card returns and all', () => {
    expect(seller).toMatch(/const read = isShop \? siteGet : tillFetch;/);
    expect(seller).toMatch(/await fetchShiftSales\(fresh\.openedAt, \{ shop: isShop \}\)/);
    const store = read('lib/store.ts');
    expect(store).toMatch(/if \(local && opts\?\.shop\) \{\s+const back = await fetchReturnsOrNull\(openedAt\);\s+return back \? [^;]+ : null;/);
  });
});

describe('a failed lookup is not "no such receipt"', () => {
  const db = (orders: unknown, lines: unknown) => ({
    from: (t: string) => {
      const answer = t === 'orders' ? orders : lines;
      const q: Record<string, unknown> = { then: (r: (v: unknown) => void) => r(answer) };
      for (const k of ['select', 'eq', 'order', 'limit', 'or']) q[k] = () => q;
      return q;
    },
  }) as never;
  const row = { id: 'o', order_number: 100185, till_number: 1, discount_amount: 0, order_items: [{ menu_item_id: 'a', variant_id: null, menu_item_name: 'Cappy', menu_item_price: 2, quantity: 2, removed_at: null }] };

  it('tells found, none and failed apart', async () => {
    expect(await findSale(db({ data: [row] }, { data: [] }), 'c', '100185')).toMatchObject({ state: 'found', sale: { label: '100185', lines: [{ left: 2, price: 2 }] } });
    expect(await findSale(db({ data: [] }, { data: [] }), 'c', '100185')).toEqual({ state: 'none' });
    expect(await findSale(db({ data: null, error: {} }, { data: [] }), 'c', '100185')).toEqual({ state: 'failed' });
  });

  it('an unread list of earlier returns is a failure, not "nothing came back"', async () => {
    expect(await findSale(db({ data: [row] }, { data: null, error: {} }), 'c', '100185')).toEqual({ state: 'failed' });
  });

  it('the till says which it was, and leaves another sale\'s cart alone', () => {
    const fn = seller.slice(seller.indexOf('async function findReturnSale'), seller.indexOf('// A product off the receipt'));
    expect(fn).toMatch(/if \(!receiptWaitRef\.current\) return;/);
    expect(fn).toMatch(/state === 'failed'\) \{ showAlert\('Qəbz yoxlanmadı — internet/);
    expect(fn).toMatch(/lines\.length === 0\) \{ showAlert\(`Qəbz №\$\{sale\.label\}: hamısı artıq qaytarılıb/);
  });

  it('a product\'s barcode is not a receipt; "/" typed as "." still is', () => {
    expect(parseReceiptLabel('4600123456789')).toBeNull();
    expect(parseReceiptLabel('12345670')).toBeNull();
    expect(parseReceiptLabel('100185')).toEqual({ number: 100185, till: null });
    expect(parseReceiptLabel('185.2')).toEqual({ number: 185, till: 2 });
  });
});

describe('never more back than was paid', () => {
  const sale = (items: [string, number, number][], discountAmount = 0, back: [string, number, number][] = []) => saleForReturn(
    { id: 'o', label: '1', discountAmount },
    items.map(([id, qty, price]) => ({ menuItemId: id, variantId: null, name: id, qty, price })),
    back.map(([id, qty, price]) => ({ menuItemId: id, variantId: null, qty, price })));
  const all = (s: ReturnType<typeof sale>) => requestTotal(s.lines.map(l => ({ qty: l.left, price: l.price })));

  it('3 × 1.00 less 1.00, paid 2.00: 2.00 back, not 2.01', () => {
    expect(all(sale([['a', 3, 1]], 1))).toBe(2);
  });
  it('2.00 and 3.00 of one product, paid 5.00: 5.00 back, not 6.00', () => {
    expect(all(sale([['a', 1, 2], ['a', 1, 3]]))).toBe(5);
  });
  it('one at a time adds up to the same', () => {
    let given = 0;
    const steps = [0, 1, 2].map(n => { const r = refundOf(2, 3, n, given, 1); given = Math.round((given + r) * 100) / 100; return r; });
    expect(steps).toEqual([0.67, 0.66, 0.67]);
    expect(given).toBe(2);
    expect(all(sale([['a', 3, 1]], 1, [['a', 1, 0.67]]))).toBe(1.33);
  });
  it('a sale with no discount is untouched', () => {
    expect(sale([['a', 2, 3.4]]).lines).toEqual([{ menuItemId: 'a', variantId: null, name: 'a', left: 2, price: 3.4 }]);
  });
  it('the database prices the same way, caps the sale, and the slip prints what it saved', () => {
    expect(sql).toMatch(/round\(worth \* \(back \+ ln\.qty\) \/ sold, 2\) - given, room\)/);
    expect(sql).not.toMatch(/max\(oi\.menu_item_price\)/);
    expect(seller).toMatch(/lines: \(reply\.lines \?\? lines\)/);
  });
  it('a delivery whose money the rider still has gives nothing back', () => {
    expect(sql).toMatch(/coalesce\(ord\.courier_debt, 0\) - coalesce\(ord\.courier_cash, 0\) - coalesce\(ord\.courier_card, 0\) > 0\.005 then\s+raise exception 'courier_unpaid'/);
    expect(returnErrorText('courier_unpaid')).toMatch(/Kuryer/);
  });
  it('the button shows the refund, with no Xidmət haqqı on it', () => {
    expect(seller.match(/Qaytar · −\$\{requestTotal\(cartToReturnLines\(cart\)\)\.toFixed\(2\)\}/g)).toHaveLength(2);
    expect(seller.match(/percent=\{returnMode \? 0 : cartPercent\}/g)).toHaveLength(2);
  });
  it('"+" in the cart stops at what the receipt has', () => {
    const fn = seller.slice(seller.indexOf('function addCartLineAgain'), seller.indexOf('function setLineNote'));
    expect(fn).toMatch(/if \(returnMode && returnSale\)[\s\S]*addFromSale\(sold\); return;/);
  });
});

describe('stock', () => {
  const body = (src: string, name: string) => src.slice(src.indexOf(`function public.${name}(`)).split('$function$')[1];
  it('goods go back by the very rule a sale takes them by', () => {
    const sold = body(read('supabase/migrations/20261028_set_variants.sql'), 'order_stock_lines');
    const back = body(sql, 'return_stock_lines');
    const rule = (s: string) => s.slice(s.indexOf('), units as (')).replace(/\s+/g, ' ');
    expect(rule(back)).toBe(rule(sold));
  });
  it('a sale whose goods came back is not deleted, and admin says why', () => {
    expect(sql).toMatch(/when \(OLD\.status = 'ödənilib' and NEW\.status is distinct from OLD\.status\)/);
    expect(read('lib/store.ts')).toMatch(/has_returns\/\.test\(error\.message\)\) return 'has_returns'/);
    expect(admin).toMatch(/if \(undone === 'has_returns'\) \{ setDialog/);
    // A 500 would be sent again forever.
    expect(read('app/api/return-courier-order/route.ts')).toMatch(/has_returns\/\.test\(error\.message\)\) return Response\.json\(\{ ok: false, error: 'has_returns' \}\);/);
  });
  it('the new functions are closed to every browser', () => {
    for (const f of ['return_stock_lines(uuid, uuid)', 'return_saved_lines(uuid)', 'keep_returned_sale()']) {
      expect(sql).toContain(`revoke all on function public.${f} from public, anon, authenticated;`);
    }
  });
});

describe('every report takes returns off', () => {
  const order = (id: string, sellerName: string, price: number, over: Partial<Order> = {}) => ({
    id, sellerName, tableNumber: 0, status: 'ödənilib', createdAt: '2026-11-24T10:00:00Z',
    items: [{ menuItem: { id: 'cappy', name: 'Cappy', price, category: 'İçki' }, quantity: 1 }], ...over,
  }) as unknown as Order;
  const paid = [order('o1', 'Aysel', 60), order('o2', 'Kamran', 40, { courierId: 'k' })];
  const back = (over: Partial<SaleReturn>): SaleReturn => ({ id: 'r', orderId: null, total: 10, pay: 'cash', sellerName: 'Kamran', approvedBy: 'M', createdAt: '2026-11-24T12:00:00Z',
    lines: [{ menuItemId: 'cappy', variantId: null, name: 'Cappy', qty: 1, price: 10 }], ...over });
  const menu = [{ id: 'cappy', name: 'Cappy', category: 'İçki' }] as MenuItem[];

  it('100 sold, 10 back: 90', () => {
    expect(afterReturns(100, { total: 10 })).toBe(90);
    expect(netRevenue(paid, [back({})])).toBe(90);
    const hours = revenueByHour(paid, 'UTC', [back({})]);
    expect([hours[10], hours[12]]).toEqual([100, -10]);
    expect(hours.reduce((a, b) => a + b, 0)).toBe(90);
  });
  it('payment types', () => {
    expect(payAfterReturns({ nagd: 60, kart: 40, kuryer: 0 }, [back({}), back({ total: 5, pay: 'card' })])).toEqual({ nagd: 50, kart: 35, kuryer: 0 });
  });
  it('categories', () => {
    expect(categoryReport(paid, menu, { cappy: 4 }, [back({})])).toEqual([{ cat: 'İçki', rev: 90, cost: 4, profit: 86 }]);
  });
  it('sellers: off who made the sale, else who took it back', () => {
    const of = (r: SaleReturn) => Object.fromEntries(sellerStats(paid, [r]).map(s => [s.name, s.rev]));
    expect(of(back({ orderId: 'o1' }))).toEqual({ Aysel: 50, Kamran: 40 });
    expect(of(back({}))).toEqual({ Aysel: 60, Kamran: 30 });
  });
  it('Satış tipləri add up to what is left, and to 100%', () => {
    const rows = placesAfterReturns(placeSales(paid, true, orderTotal, true), paid, [back({ orderId: 'o2', total: 10 })], true);
    expect(rows.map(r => [r.kind, r.rev])).toEqual([['takeaway', 60], ['delivery', 30]]);
    expect(rows.reduce((s, r) => s + r.pct, 0)).toBeCloseTo(100);
  });
  it('Məhsullar: the rows add up to Cəmi, even for a thing sold another day', () => {
    const r = itemSalesAfterReturns(itemSales(paid), [back({}), back({ total: 3, lines: [{ menuItemId: 'su', variantId: 'v', name: 'Su', qty: 1, price: 3 }] })], menu);
    expect(r.items.find(i => i.id === 'su')).toMatchObject({ qty: -1, rev: -3, sizes: { v: { qty: -1, rev: -3 } } });
    expect(r.items.reduce((s, i) => s + i.rev, 0)).toBe(r.total);
    expect(r.total).toBe(87);
  });
  it('a restaurant, with no returns, is counted as before', () => {
    const sales = itemSales(paid);
    expect(itemSalesAfterReturns(sales, [])).toBe(sales);
    expect(netRevenue(paid, [])).toBe(100);
  });
  it('admin gives them to every sum', () => {
    for (const use of ['netOfReturns(grossStats, backs', 'payAfterReturns(payTotals, backs', 'sellerStatsOf(chartPaid, backs', 'menuCostMap, backs)',
      'itemSalesAfterReturns(itemSales(chartPaid), backs', 'bizSettings.timezone, backs)', 'revenueByWeekday(chartPaid, bizSettings, backs)', 'chartPaid, backs, deliveryOn)']) {
      expect(admin, use).toContain(use);
    }
    expect(admin.match(/netRevenue\(ordersInDays\(/g)).toHaveLength(3);
    expect(admin).not.toMatch(/\brevenue\(ordersInDays/);
  });
  it('Kassa: till and admin, open shift and closed', () => {
    expect(seller).toMatch(/afterReturns\(kassaTotals\.cemi, \(isShop && kassaBack\) \|\| \{ total: 0 \}\)/);
    expect(admin).toMatch(/total: afterReturns\(t\.cemi, t\.back \?\? \{ total: 0 \}\)/);
    expect(admin).not.toMatch(/closedShiftTotals\[s\.id\]!\.cemi/);
  });
});

describe('what could not be read is said, not counted as none', () => {
  it('Hesabat on paper', () => {
    const head = { companyName: 'M', from: '2026-11-24T00:00:00Z', to: '2026-11-24T12:00:00Z', printedBy: 'K', timezone: 'Asia/Baku' };
    const r = { count: 1, toplam: 5, endirim: 0, cemi: 5, nagd: 5, kart: 0, kuryer: 0, legv: { count: 0, sum: 0 } };
    expect(historyReportLines(r, { ...head, returns: null }).map(l => l.text)).toContain('Qaytarmalar oxunmadı (internet)');
    expect(historyReportLines(r, { ...head, returns: undefined }).map(l => l.text).join()).not.toMatch(/Qaytarma/);
  });
  it('another shift\'s or range\'s returns are never left standing', () => {
    expect(seller).toMatch(/else if \(historyReturnsFor\.current !== key\) setHistoryReturns\(null\);/);
    expect(admin).toMatch(/if \(cancelled\) return;\s+if \(rs\) \{ statsReturnsFor\.current = key; setStatsReturns\(rs\); \}\s+else if \(statsReturnsFor\.current !== key\) setStatsReturns\(null\);/);
  });
  it('a day with only returns shows its boxes', () => {
    expect(seller).toMatch(/historyOrders\.length > 0 \|\| \(isShop && \(historyBackUnread \|\| historyBack\.total > 0\)\)/);
    expect(seller).toMatch(/\{!historyLoading && historyShown && \(/);
  });
  it('every row is read, not the first 1000', () => {
    const store = read('lib/store.ts');
    const fn = store.slice(store.indexOf('export async function fetchReturnsOrNull'), store.indexOf('// Whether this database has menu_items.barcode'));
    expect(fn).toMatch(/readAll</);
    expect(read('app/api/public-returns/route.ts')).toMatch(/readAll</);
  });
});

describe('the till\'s smaller ones', () => {
  it('a product taken off sale can still come back', () => {
    expect(seller).toMatch(/if \(!hit\.item\.available && !returnMode\)/);
    expect(seller.match(/\(m\.available \|\| returnMode\)/g)).toHaveLength(2);
  });
  it('no raw code reaches the cashier', () => {
    for (const code of ['bad_request', 'revoked', 'not_allowed', 'nothing_to_refund', 'courier_unpaid', 'duplicate key value violates unique constraint']) {
      expect(returnErrorText(code)).not.toMatch(/_|duplicate|revoked/);
    }
    expect(returnErrorText('network')).toMatch(/yalnız onlayn/);
  });
  it('each Qaytarma starts on Nağd, not the last one\'s Karta', () => {
    expect(seller).toMatch(/setReturnPay\('cash'\);\s+setReturnMode\(true\)/);
  });
});
