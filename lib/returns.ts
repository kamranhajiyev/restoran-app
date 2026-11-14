// Qaytarma (SHOP-MODE.md, step 5). A return is its own record, saved by
// record_return() (20261113_returns.sql): the goods go back into stock, cash
// comes out of the open shift as a Kassa movement, a card return lowers the
// shift's card total. Every screen that counts money takes returns off through
// the functions here, so no two screens can count them differently.

import { round2 } from '@/components/seller/order-format';

export interface ReturnLine { menuItemId: string | null; variantId: string | null; name: string; qty: number; price: number }
export interface SaleReturn {
  id: string;
  orderId: string | null;
  total: number;
  pay: 'cash' | 'card';
  sellerName: string | null;
  approvedBy: string | null;
  createdAt: string;
  lines: ReturnLine[];
}

/** What the till sends: a line per product (and size) brought back. */
export interface ReturnRequest {
  id: string;
  orderId: string | null;
  pay: 'cash' | 'card';
  seller: string;
  approvedBy: string;
  /** The manager's PIN or card: record_return() checks it itself and saves
   *  the name it finds (20261114_return_approval.sql). Neither = only the
   *  owner's own session, in a company with no manager. */
  pin?: string;
  card?: string;
  device?: string;
  lines: { menuItemId: string | null; variantId: string | null; name: string; qty: number; price: number }[];
}

/** What record_return() hands back: saved, or refused for the approval. */
export interface ReturnReply { ok: boolean; error?: string; total?: number; approvedBy?: string }

/** The arguments for record_return(), the same from both paths (a signed-in
 *  till calls it straight, a link till through /api/add-return). */
export function returnRpcArgs(r: ReturnRequest, company?: string): Record<string, unknown> {
  return {
    p_id: r.id, p_order_id: r.orderId, p_lines: r.lines, p_pay: r.pay,
    p_seller: r.seller, p_approved_by: r.approvedBy,
    p_pin: r.pin ?? null, p_card: r.card ?? null, p_device: r.device ?? '',
    ...(company ? { p_company: company } : {}),
  };
}

/** The Kassa movement record_return() adds for a cash return, for the exe's
 *  and APK's own copy of the shift: same id, so it is never counted twice. */
export function returnMovement(id: string, total: number, receipt: string | null, by: string, at = new Date().toISOString()) {
  return { id, at, amount: -total, reason: `Qaytarma${receipt ? ` · №${receipt}` : ''}`, by };
}

/** The money given back, split the way the boxes show it. */
export function returnTotals(returns: Pick<SaleReturn, 'total' | 'pay'>[]): { cash: number; card: number; total: number } {
  let cash = 0, card = 0;
  for (const r of returns) {
    if (r.pay === 'cash') cash += r.total; else card += r.total;
  }
  return { cash: round2(cash), card: round2(card), total: round2(cash + card) };
}

/** A return's total as the server will save it, for the button before saving. */
export function requestTotal(lines: { qty: number; price: number }[]): number {
  return round2(lines.reduce((s, l) => s + round2(l.qty * l.price), 0));
}

/** How many of each product came back — for Top məhsullar, so a returned item
 *  is not counted as sold. Keyed by product name, as that list is. */
export function returnedQty(returns: Pick<SaleReturn, 'lines'>[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of returns) for (const l of r.lines) out.set(l.name, (out.get(l.name) ?? 0) + l.qty);
  return out;
}

/** The till's cart, as lines to return (one per product and size). */
export function cartToReturnLines(cart: { menuItem: { id: string; name: string; price: number }; quantity: number; variantId?: string; modifiers?: string }[]): ReturnRequest['lines'] {
  return cart.map(c => ({
    menuItemId: c.menuItem.id,
    variantId: c.variantId ?? null,
    name: c.modifiers ? `${c.menuItem.name} (${c.modifiers})` : c.menuItem.name,
    qty: c.quantity,
    price: c.menuItem.price,
  }));
}

/** The database's refusal, in words for the cashier. */
export function returnErrorText(code: string): string {
  if (/not_on_receipt/.test(code)) return 'Bu məhsul həmin qəbzdə yoxdur.';
  if (/more_than_sold/.test(code)) return 'Qəbzdə alınandan çox qaytarmaq olmaz (əvvəlki qaytarmalar da sayılır).';
  if (/not_paid/.test(code)) return 'Bu qəbz hələ ödənilməyib.';
  if (/not_found/.test(code)) return 'Qəbz tapılmadı.';
  if (/no_shift/.test(code)) return 'Nağd qaytarmaq üçün növbə açıq olmalıdır (Kassa).';
  if (/not_approved/.test(code)) return 'Menecer təsdiqi lazımdır (PIN və ya kart yoxlanmadı).';
  if (/^locked$/.test(code)) return 'Çox sayda yanlış cəhd — bir az gözləyin.';
  if (/fetch|network|failed to fetch|load failed/i.test(code)) return 'İnternet bağlantısı yoxdur — qaytarma yalnız onlayn olur.';
  return code;
}

/** A database row (with its return_lines) as the screens use it. */
export function rowToReturn(r: Record<string, unknown>): SaleReturn {
  const lines = Array.isArray(r.return_lines) ? r.return_lines as Record<string, unknown>[] : [];
  return {
    id: String(r.id),
    orderId: (r.order_id as string | null) ?? null,
    total: Number(r.total),
    pay: r.pay === 'card' ? 'card' : 'cash',
    sellerName: (r.seller_name as string | null) ?? null,
    approvedBy: (r.approved_by as string | null) ?? null,
    createdAt: String(r.created_at),
    lines: lines.map(l => ({
      menuItemId: (l.menu_item_id as string | null) ?? null,
      variantId: (l.variant_id as string | null) ?? null,
      name: String(l.name),
      qty: Number(l.qty),
      price: Number(l.price),
    })),
  };
}

/** "45" or "45/2" (till 2, lib/order-label) → the number and the till. */
export function parseReceiptLabel(raw: string): { number: number; till: number | null } | null {
  const m = raw.trim().replace(/^№/, '').match(/^(\d+)(?:\/(\d+))?$/);
  if (!m) return null;
  return { number: Number(m[1]), till: m[2] ? Number(m[2]) : null };
}

/** A paid sale found by its receipt, as the Qaytarma screen offers it: each
 *  product with what can still come back and at what price (after the bill's
 *  discount, the way record_return() will price it). */
export interface SaleForReturn {
  id: string;
  label: string;
  lines: { menuItemId: string; variantId: string | null; name: string; left: number; price: number }[];
}

export function saleForReturn(
  order: { id: string; label: string; discountAmount?: number },
  items: { menuItemId: string; variantId: string | null; name: string; qty: number; price: number }[],
  returned: { menuItemId: string | null; variantId: string | null; qty: number }[],
): SaleForReturn {
  const gross = items.reduce((s, i) => s + i.qty * i.price, 0);
  const factor = order.discountAmount && gross > 0 ? Math.max(0, (gross - order.discountAmount) / gross) : 1;
  const key = (id: string | null, v: string | null) => `${id}:${v ?? ''}`;
  const groups = new Map<string, SaleForReturn['lines'][number]>();
  for (const i of items) {
    const k = key(i.menuItemId, i.variantId);
    const g = groups.get(k);
    if (g) { g.left += i.qty; g.price = Math.max(g.price, round2(i.price * factor)); }
    else groups.set(k, { menuItemId: i.menuItemId, variantId: i.variantId, name: i.name, left: i.qty, price: round2(i.price * factor) });
  }
  for (const r of returned) {
    const g = groups.get(key(r.menuItemId, r.variantId));
    if (g) g.left -= r.qty;
  }
  return { id: order.id, label: order.label, lines: [...groups.values()].filter(l => l.left > 0) };
}

/** Statistika after returns: income and cost both shrink by what came back
 *  (cost at each item's unit cost), and profit and margin follow. */
export function netOfReturns(
  s: { revenue: number; cost: number },
  returns: Pick<SaleReturn, 'total' | 'lines'>[],
  unitCost: (menuItemId: string) => number,
): { revenue: number; cost: number; profit: number; marginPct: number; back: number } {
  const back = round2(returns.reduce((t, r) => t + r.total, 0));
  const backCost = returns.reduce((t, r) => t + r.lines.reduce((c, l) => c + (l.menuItemId ? unitCost(l.menuItemId) : 0) * l.qty, 0), 0);
  const revenue = round2(s.revenue - back);
  const cost = round2(s.cost - backCost);
  const profit = round2(revenue - cost);
  return { revenue, cost, profit, marginPct: revenue > 0 ? (profit / revenue) * 100 : 0, back };
}

/** Top məhsullar after returns: a returned item is not counted as sold. */
export function itemsAfterReturns<T extends { qty: number; rev: number; cost: number }>(
  items: Record<string, T>,
  returns: Pick<SaleReturn, 'lines'>[],
  unitCost: (menuItemId: string) => number,
): Record<string, T> {
  const out: Record<string, T> = Object.fromEntries(Object.entries(items).map(([k, v]) => [k, { ...v }]));
  for (const r of returns) for (const l of r.lines) {
    const it = l.menuItemId ? out[l.menuItemId] : undefined;
    if (!it) continue;
    it.qty -= l.qty;
    it.rev = round2(it.rev - l.qty * l.price);
    it.cost = round2(it.cost - l.qty * unitCost(l.menuItemId!));
  }
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v.qty > 0)) as Record<string, T>;
}
