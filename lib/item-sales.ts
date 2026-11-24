// What each dish and product sold: how many and for how much. Tarixçə's
// "Məhsullar" list and admin's Analiz both count it here, so the till and the
// admin page give the same numbers for the same orders.
//
// An item's sum is its share of what the guest paid: the order's discount is
// spread over its lines by price, and the Xidmət haqqı is kept apart (it is no
// dish's). So the items plus `service` add up to the orders' Cəmi.

import type { MenuItem, Order } from '@/types';
import { orderTotal } from '@/components/seller/order-format';
import { orderServiceCharge } from './service-charge';
import { WIDTH } from './escpos';
import type { Line } from './raster';
import { formatDate } from './dates';
import type { SaleReturn } from './returns';

export type Sale = { qty: number; rev: number };
export type ItemSale = Sale & {
  id: string;
  name: string;
  category: string;
  /** By variant id; '' = a line with no size (sold before the item had sizes). */
  sizes: Record<string, Sale>;
};
export type ItemSales = { items: ItemSale[]; service: number; total: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Paid orders only, most sold first. */
export function itemSales(orders: Order[]): ItemSales {
  const map = new Map<string, ItemSale>();
  let service = 0;
  let total = 0;
  for (const o of orders) {
    if (o.status !== 'ödənilib') continue;
    const charge = orderServiceCharge(o);
    const paid = orderTotal(o);
    service += charge;
    total += paid;
    const gross = o.items.reduce((s, i) => s + i.menuItem.price * i.quantity, 0);
    const ratio = gross > 0 ? (paid - charge) / gross : 1;
    for (const oi of o.items) {
      const id = oi.menuItem.id;
      let s = map.get(id);
      if (!s) {
        s = { id, name: oi.menuItem.name, category: oi.menuItem.category || 'Digər', qty: 0, rev: 0, sizes: {} };
        map.set(id, s);
      }
      const rev = oi.menuItem.price * oi.quantity * ratio;
      s.qty += oi.quantity;
      s.rev += rev;
      const z = (s.sizes[oi.variantId ?? ''] ??= { qty: 0, rev: 0 });
      z.qty += oi.quantity;
      z.rev += rev;
    }
  }
  const items = [...map.values()].sort((a, b) => b.qty - a.qty || b.rev - a.rev || a.name.localeCompare(b.name));
  return { items, service: r2(service), total: r2(total) };
}

/** The same list after a shop's returns (lib/returns): a returned item is not
 *  counted as sold, and Cəmi is what is left. An item brought back that was not
 *  sold in view (bought last week) is a row below zero, so the rows still add
 *  up to Cəmi. */
export function itemSalesAfterReturns(r: ItemSales, returns: Pick<SaleReturn, 'lines' | 'total'>[], menu: Pick<MenuItem, 'id' | 'name' | 'category'>[] = []): ItemSales {
  if (returns.length === 0) return r;
  const map = new Map(r.items.map(s => [s.id, { ...s, sizes: Object.fromEntries(Object.entries(s.sizes).map(([k, z]) => [k, { ...z }])) }]));
  let back = 0;
  for (const ret of returns) {
    back += ret.total;
    for (const l of ret.lines) {
      const id = l.menuItemId ?? l.name;
      let s = map.get(id);
      if (!s) {
        const m = menu.find(x => x.id === id);
        s = { id, name: m?.name ?? l.name, category: m?.category || 'Digər', qty: 0, rev: 0, sizes: {} };
        map.set(id, s);
      }
      const sum = r2(l.qty * l.price);
      s.qty -= l.qty;
      s.rev -= sum;
      const z = (s.sizes[l.variantId ?? ''] ??= { qty: 0, rev: 0 });
      z.qty -= l.qty;
      z.rev -= sum;
    }
  }
  const items = [...map.values()]
    .filter(s => s.qty !== 0 || Math.abs(s.rev) > 0.005)
    .sort((a, b) => b.qty - a.qty || b.rev - a.rev || a.name.localeCompare(b.name));
  return { items, service: r.service, total: r2(r.total - back) };
}

/** A size's name from the menu, or what admin's Analiz calls one it cannot find. */
export function sizeName(menu: MenuItem[], itemId: string, variantId: string): string {
  if (!variantId) return 'ölçüsüz';
  return menu.find(m => m.id === itemId)?.variants?.find(v => v.id === variantId)?.name ?? 'silinmiş ölçü';
}

/** An item's sizes worth listing under it: only when it has a size at all. */
export function shownSizes(menu: MenuItem[], s: ItemSale): { name: string; qty: number; rev: number }[] {
  const keys = Object.keys(s.sizes);
  if (keys.length === 1 && keys[0] === '') return [];
  return keys
    .map(k => ({ name: sizeName(menu, s.id, k), ...s.sizes[k] }))
    .sort((a, b) => b.qty - a.qty);
}

const money = (n: number) => `${n.toFixed(2)}m`;

function row(left: string, amount: string): string {
  const room = WIDTH - amount.length - 1;
  const l = left.length > room ? left.slice(0, room) : left;
  return `${l}${' '.repeat(WIDTH - l.length - amount.length)}${amount}`;
}

/** The list on paper, from the receipt printer like the Hesabat. */
export function itemSalesLines(r: ItemSales, menu: MenuItem[], head: {
  companyName: string;
  from: string;
  timezone: string;
  shift?: string;
  note?: string;       // printed under the total: what the list could not read
}): Line[] {
  const lines: Line[] = [
    { text: `Məhsullar ${formatDate(head.from, head.timezone)}`, big: true, center: true },
    { text: row('Məkan', head.companyName) },
  ];
  if (head.shift) lines.push({ text: row('Növbə', head.shift) });
  lines.push({ text: '-'.repeat(WIDTH) });
  for (const s of r.items) {
    lines.push({ text: row(`${s.qty} x ${s.name}`, money(s.rev)) });
    for (const z of shownSizes(menu, s)) lines.push({ text: row(`   ${z.qty} x ${z.name}`, money(z.rev)) });
  }
  lines.push({ text: '-'.repeat(WIDTH) });
  if (r.service > 0.005) lines.push({ text: row('Xidmət haqqı', money(r.service)) });
  lines.push({ text: row('CƏMİ', money(r.total)), big: true });
  if (head.note) lines.push({ text: head.note });
  return lines;
}
