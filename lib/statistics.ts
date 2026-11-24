// The sums behind admin's Statistika page: revenue, cost, profit, the charts,
// the sellers and the categories. Moved out of app/admin/page.tsx unchanged, so
// a test can check them; the page only lays them out.
//
// Every sum is of orderTotal (components/seller/order-format), the same total
// the till, Tarixçə and the bill print. Orders are grouped by business day
// (lib/business-day), not the calendar day.

import type { MenuItem, Order } from '@/types';
import { orderTotal } from '@/components/seller/order-format';
import { orderServiceCharge } from './service-charge';
import { businessDay, dayOfWeek, tzHour, type CompanySettings } from './business-day';
import { orderPlaceKind, PLACE_WORDS } from './order-place';
import type { PlaceSale } from './place-sales';
import { returnTotals, type SaleReturn } from './returns';

/** What one unit costs, by menu item id and by variant id. An item without its
 *  own cost takes the average of its sizes' costs. No cost → no key. */
export function costMap(menu: MenuItem[]): Record<string, number> {
  const map: Record<string, number> = {};
  menu.forEach(m => {
    if (m.costPrice) {
      map[m.id] = m.costPrice;
    } else if (m.variants?.length) {
      const varCosts = m.variants.filter(v => v.costPrice).map(v => v.costPrice!);
      if (varCosts.length > 0) map[m.id] = varCosts.reduce((s, c) => s + c, 0) / varCosts.length;
    }
    m.variants?.forEach(v => { if (v.costPrice) map[v.id] = v.costPrice; });
  });
  return map;
}

/** The orders whose business day is from `from` to `to`, both included. */
export function ordersInDays<T extends Pick<Order, 'createdAt'>>(orders: T[], s: CompanySettings, from: string, to: string): T[] {
  return orders.filter(o => {
    const d = businessDay(o.createdAt, s);
    return d >= from && d <= to;
  });
}

export function revenue(orders: Order[]): number {
  return orders.reduce((s, o) => s + orderTotal(o), 0);
}

/** Income after a shop's returns, so a chart's points add up to Gəlir. A return
 *  counts on the day it was made. Restaurants have none. */
export function netRevenue(orders: Order[], returns: Pick<SaleReturn, 'total' | 'pay'>[]): number {
  return revenue(orders) - returnTotals(returns).total;
}

/** The top of the page: Gəlir, Xərc, Mənfəət, margin and the average order. */
export function statsSummary(paid: Order[], costs: Record<string, number>) {
  const rev = revenue(paid);
  const cost = paid.reduce((s, o) => s + o.items.reduce((os, oi) => os + (costs[oi.menuItem.id] ?? 0) * oi.quantity, 0), 0);
  const profit = rev - cost;
  return {
    revenue: rev,
    cost,
    profit,
    marginPct: rev > 0 ? (profit / rev) * 100 : 0,
    avg: paid.length > 0 ? rev / paid.length : 0,
  };
}

/** Revenue in each hour 0–23 of the restaurant's clock. */
export function revenueByHour(orders: Order[], tz: string, returns: SaleReturn[] = []): number[] {
  return Array.from({ length: 24 }, (_, h) => netRevenue(
    orders.filter(o => tzHour(o.createdAt, tz) === h), returns.filter(r => tzHour(r.createdAt, tz) === h)));
}

/** Revenue on each weekday, Monday first. */
export function revenueByWeekday(orders: Order[], s: CompanySettings, returns: SaleReturn[] = []): number[] {
  return Array.from({ length: 7 }, (_, i) => {
    const jsDay = i === 6 ? 0 : i + 1;
    const on = (o: { createdAt: string }) => dayOfWeek(businessDay(o.createdAt, s)) === jsDay;
    return netRevenue(orders.filter(on), returns.filter(on));
  });
}

/** Orders and revenue per seller, best first. A return comes off the seller who
 *  made the sale; one with no receipt, or of a sale outside `paid`, off the
 *  seller who took it back. */
export function sellerStats(paid: Order[], returns: SaleReturn[] = []): { name: string; orders: number; rev: number }[] {
  const map: Record<string, { orders: number; rev: number }> = {};
  paid.forEach(o => {
    const name = o.sellerName || 'Naməlum';
    if (!map[name]) map[name] = { orders: 0, rev: 0 };
    map[name].orders += 1;
    map[name].rev += orderTotal(o);
  });
  const soldBy = new Map(paid.map(o => [o.id, o.sellerName]));
  returns.forEach(r => {
    const name = (r.orderId && soldBy.get(r.orderId)) || r.sellerName || 'Naməlum';
    if (!map[name]) map[name] = { orders: 0, rev: 0 };
    map[name].rev -= r.total;
  });
  return Object.entries(map)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.rev - a.rev);
}

/** Revenue, cost and profit per category, most profit first. A line's revenue
 *  is its share of what was paid less the Xidmət haqqı, so a discount is spread
 *  over the lines and the charge is no category's. */
export function categoryReport(paid: Order[], menu: MenuItem[], costs: Record<string, number>, returns: SaleReturn[] = []) {
  const map: Record<string, { rev: number; cost: number }> = {};
  paid.forEach(o => {
    const gross = o.items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0);
    const ratio = gross > 0 ? (orderTotal(o) - orderServiceCharge(o)) / gross : 1;
    o.items.forEach(oi => {
      const menuItem = menu.find(m => m.id === oi.menuItem.id);
      const cat = menuItem?.category || oi.menuItem.category || 'Digər';
      if (!map[cat]) map[cat] = { rev: 0, cost: 0 };
      map[cat].rev += oi.menuItem.price * oi.quantity * ratio;
      map[cat].cost += (costs[oi.menuItem.id] ?? 0) * oi.quantity;
    });
  });
  // A shop's returns, out of the category they were sold in.
  returns.forEach(r => r.lines.forEach(l => {
    const cat = menu.find(m => m.id === l.menuItemId)?.category || 'Digər';
    if (!map[cat]) map[cat] = { rev: 0, cost: 0 };
    map[cat].rev -= l.qty * l.price;
    map[cat].cost -= (l.menuItemId ? costs[l.menuItemId] ?? 0 : 0) * l.qty;
  }));
  return Object.entries(map)
    .map(([cat, { rev, cost }]) => ({ cat, rev, cost, profit: rev - cost }))
    .sort((a, b) => b.profit - a.profit);
}

/** Satış tipləri after returns: each comes off the kind of sale it was; with no
 *  receipt, or a sale outside `paid`, off the counter (it was handed back there).
 *  `pct` is of the rows' own sum, so the rows add up to 100%. */
export function placesAfterReturns(rows: PlaceSale[], paid: Order[], returns: SaleReturn[], deliveryOn: boolean): (PlaceSale & { pct: number })[] {
  const kindOf = new Map(paid.map(o => [o.id, orderPlaceKind(o, { deliveryOn })]));
  const net = rows.map(r => ({ ...r }));
  for (const r of returns) {
    const kind = (r.orderId && kindOf.get(r.orderId)) || 'takeaway';
    let row = net.find(n => n.kind === kind);
    if (!row) net.push(row = { kind, label: PLACE_WORDS.shop, rev: 0, count: 0 });
    row.rev -= r.total;
  }
  const sum = net.reduce((t, r) => t + Math.max(0, r.rev), 0);
  return net.map(r => ({ ...r, pct: sum > 0 ? (Math.max(0, r.rev) / sum) * 100 : 0 }));
}

/** Ödəniş üsulları after returns: cash and card each less what went back that way. */
export function payAfterReturns(t: { nagd: number; kart: number; kuryer: number }, returns: Pick<SaleReturn, 'total' | 'pay'>[]) {
  const back = returnTotals(returns);
  return { nagd: t.nagd - back.cash, kart: t.kart - back.card, kuryer: t.kuryer };
}
