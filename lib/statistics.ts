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
export function revenueByHour(orders: Order[], tz: string): number[] {
  return Array.from({ length: 24 }, (_, h) => revenue(orders.filter(o => tzHour(o.createdAt, tz) === h)));
}

/** Revenue on each weekday, Monday first. */
export function revenueByWeekday(orders: Order[], s: CompanySettings): number[] {
  return Array.from({ length: 7 }, (_, i) => {
    const jsDay = i === 6 ? 0 : i + 1;
    return revenue(orders.filter(o => dayOfWeek(businessDay(o.createdAt, s)) === jsDay));
  });
}

/** Orders and revenue per seller, best first. */
export function sellerStats(paid: Order[]): { name: string; orders: number; rev: number }[] {
  const map: Record<string, { orders: number; rev: number }> = {};
  paid.forEach(o => {
    const name = o.sellerName || 'Naməlum';
    if (!map[name]) map[name] = { orders: 0, rev: 0 };
    map[name].orders += 1;
    map[name].rev += orderTotal(o);
  });
  return Object.entries(map)
    .map(([name, s]) => ({ name, ...s }))
    .sort((a, b) => b.rev - a.rev);
}

/** Revenue, cost and profit per category, most profit first. A line's revenue
 *  is its share of what was paid less the Xidmət haqqı, so a discount is spread
 *  over the lines and the charge is no category's. */
export function categoryReport(paid: Order[], menu: MenuItem[], costs: Record<string, number>) {
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
  return Object.entries(map)
    .map(([cat, { rev, cost }]) => ({ cat, rev, cost, profit: rev - cost }))
    .sort((a, b) => b.profit - a.profit);
}
