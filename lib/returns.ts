// Qaytarma (SHOP-MODE.md, step 5). A return is its own record, saved by
// record_return() (20261113_returns.sql): the goods go back into stock, cash
// comes out of the open shift as a Kassa movement, a card return lowers the
// shift's card total. Every screen that counts money takes returns off through
// the functions here, so no two screens can count them differently.

import { round2 } from '@/components/seller/order-format';
import type { SupabaseClient } from '@supabase/supabase-js';
import { orderLabel } from './order-label';

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
export interface ReturnReply {
  ok: boolean; error?: string; total?: number; approvedBy?: string;
  /** The lines as saved: the server prices them, so the slip prints these. */
  lines?: { name: string; qty: number; price: number }[];
}

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

/** Sales after returns: Tarixçə's and Kassa's bottom line, one rule. */
export function afterReturns(sales: number, back: { total: number }): number {
  return round2(sales - back.total);
}

/** What the next `qty` of a receipt line give back, the rule record_return()
 *  prices by: each line's share of what was paid, counted from the first unit
 *  that came back, so no number of returns gives back more than was paid. */
export function refundOf(paid: number, sold: number, backQty: number, backSum: number, qty: number): number {
  return round2(round2(paid * (backQty + qty) / sold) - backSum);
}

/** A return's total as the server will save it, for the button before saving. */
export function requestTotal(lines: { qty: number; price: number }[]): number {
  return round2(lines.reduce((s, l) => s + round2(l.qty * l.price), 0));
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

/** Was the return certainly not saved? Only the server's own refusals say so;
 *  a dead line, a timeout or an unknown answer may have come after the save. */
export function returnRefused(code: string): boolean {
  return /not_on_receipt|more_than_sold|courier_unpaid|nothing_to_refund|revoked|not_allowed|bad_request|not_paid|not_found|no_shift|not_approved|^locked$/.test(code);
}

/** The database's refusal, in words for the cashier. */
export function returnErrorText(code: string): string {
  if (/not_on_receipt/.test(code)) return 'Bu məhsul həmin qəbzdə yoxdur.';
  if (/more_than_sold/.test(code)) return 'Qəbzdə alınandan çox qaytarmaq olmaz (əvvəlki qaytarmalar da sayılır).';
  if (/courier_unpaid/.test(code)) return 'Kuryer bu sifarişin pulunu hələ gətirməyib — qaytarmaq olmaz.';
  if (/nothing_to_refund/.test(code)) return 'Qaytarılacaq məbləğ 0 ₼-dir.';
  if (/revoked|not_allowed/.test(code)) return 'Bu kassanın icazəsi yoxdur — linki yeniləyin.';
  if (/bad_request/.test(code)) return 'Qaytarma məlumatı düzgün deyil — səbəti yoxlayın.';
  if (/not_paid/.test(code)) return 'Bu qəbz hələ ödənilməyib.';
  if (/not_found/.test(code)) return 'Qəbz tapılmadı.';
  if (/no_shift/.test(code)) return 'Nağd qaytarmaq üçün növbə açıq olmalıdır (Kassa).';
  if (/not_approved/.test(code)) return 'Menecer təsdiqi lazımdır (PIN və ya kart yoxlanmadı).';
  if (/^locked$/.test(code)) return 'Çox sayda yanlış cəhd — bir az gözləyin.';
  return 'Serverdən cavab gəlmədi — qaytarma yazılmış ola bilər (yalnız internetlə işləyir).\n\nPulu verməzdən əvvəl internetə baxıb «Qaytar»a yenidən basın: iki dəfə yazılmır.';
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

/** "45" or "45/2" (till 2, lib/order-label) → the number and the till. A reader
 *  types keys of a US keyboard: on an Azerbaijani, Turkish or Russian one its
 *  "/" comes out as ".". Up to 7 digits: a longer code is a product's barcode,
 *  not a receipt. */
export function parseReceiptLabel(raw: string): { number: number; till: number | null } | null {
  const m = raw.trim().replace(/^№/, '').match(/^(\d{1,7})(?:[/.](\d{1,2}))?$/);
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
  returned: { menuItemId: string | null; variantId: string | null; qty: number; price?: number }[],
): SaleForReturn {
  const gross = items.reduce((s, i) => s + i.qty * i.price, 0);
  const factor = order.discountAmount && gross > 0 ? Math.max(0, (gross - order.discountAmount) / gross) : 1;
  const key = (id: string | null, v: string | null) => `${id}:${v ?? ''}`;
  const groups = new Map<string, { line: SaleForReturn['lines'][number]; sold: number; gross: number; backQty: number; backSum: number }>();
  for (const i of items) {
    const k = key(i.menuItemId, i.variantId);
    const g = groups.get(k);
    // Sold at two prices: each unit is worth their average, so all of them
    // together give back what was paid (the dearer price gave back more).
    if (g) { g.sold += i.qty; g.gross += i.qty * i.price; }
    else groups.set(k, { line: { menuItemId: i.menuItemId, variantId: i.variantId, name: i.name, left: 0, price: 0 }, sold: i.qty, gross: i.qty * i.price, backQty: 0, backSum: 0 });
  }
  for (const r of returned) {
    const g = groups.get(key(r.menuItemId, r.variantId));
    if (g) { g.backQty += r.qty; g.backSum = round2(g.backSum + round2(r.qty * (r.price ?? 0))); }
  }
  const lines = [...groups.values()].flatMap(g => {
    const left = g.sold - g.backQty;
    if (left <= 0) return [];
    // The price of one, kept fine enough that all of them round to the refund.
    const price = Math.max(0, refundOf(g.gross * factor, g.sold, g.backQty, g.backSum, left)) / left;
    return [{ ...g.line, left, price: Math.round(price * 1e6) / 1e6 }];
  });
  return { id: order.id, label: order.label, lines };
}

/** A receipt looked up: the sale, or that there is none with that number, or
 *  that the lookup failed. A failure is never "no such receipt" (2026-11-24:
 *  the exe's lookup never reached the server and read as "tapılmadı"). */
export type SaleLookup = { state: 'found'; sale: SaleForReturn } | { state: 'none' } | { state: 'failed' };

/** The lookup itself, the same for a signed-in till and /api/public-sale. */
export async function findSale(db: SupabaseClient, companyId: string, raw: string): Promise<SaleLookup> {
  const label = parseReceiptLabel(raw);
  if (!label) return { state: 'none' };
  let q = db.from('orders').select('id, order_number, till_number, status, discount_amount, order_items(menu_item_id, variant_id, menu_item_name, menu_item_price, quantity, removed_at)')
    .eq('company_id', companyId).eq('order_number', label.number).eq('status', 'ödənilib')
    .order('created_at', { ascending: false }).limit(1);
  q = label.till && label.till > 1 ? q.eq('till_number', label.till) : q.or('till_number.is.null,till_number.lte.1');
  const { data, error } = await q;
  if (error) return { state: 'failed' };
  const o = data?.[0] as Record<string, unknown> | undefined;
  if (!o) return { state: 'none' };
  // Unread, every unit would be offered again: a failure, not "nothing came back".
  const { data: back, error: backError } = await db.from('return_lines')
    .select('menu_item_id, variant_id, qty, price, returns!inner(order_id)').eq('returns.order_id', o.id as string);
  if (backError || !back) return { state: 'failed' };
  const items = ((o.order_items as Record<string, unknown>[]) ?? []).filter(i => !i.removed_at).map(i => ({
    menuItemId: String(i.menu_item_id), variantId: (i.variant_id as string | null) || null,
    name: String(i.menu_item_name), qty: Number(i.quantity), price: Number(i.menu_item_price),
  }));
  return { state: 'found', sale: saleForReturn(
    { id: o.id as string, label: orderLabel({ orderNumber: o.order_number as number, tillNumber: (o.till_number as number) ?? undefined }), discountAmount: Number(o.discount_amount ?? 0) },
    items,
    back.map(b => ({ menuItemId: b.menu_item_id as string | null, variantId: (b.variant_id as string | null) || null, qty: Number(b.qty), price: Number(b.price) })),
  ) };
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

/** The receipt a return came from, as the admin's Qaytarmalar list shows it:
 *  the sale's number, or none when the goods came back without the receipt
 *  scanned. A sale since gone from the database still says it had one. */
export function returnReceipt(r: Pick<SaleReturn, 'orderId'>, labels: Record<string, string>): string {
  if (!r.orderId) return 'Qəbzsiz';
  const label = labels[r.orderId];
  return label ? `Qəbz №${label}` : 'Qəbz tapılmadı';
}

/** The admin's Qaytarmalar list after its cash/card filter and search box:
 *  the search finds a return by its receipt number ("45" or "45/2"), the
 *  seller, the manager who approved it, or a product brought back. */
export function filterReturnList(
  returns: SaleReturn[],
  labels: Record<string, string>,
  opts: { pay?: '' | 'cash' | 'card'; query?: string },
): SaleReturn[] {
  const q = (opts.query ?? '').trim().toLocaleLowerCase('az');
  return returns.filter(r => {
    if (opts.pay && r.pay !== opts.pay) return false;
    if (!q) return true;
    const label = r.orderId ? labels[r.orderId] ?? '' : '';
    const hay = [label, label.split('/')[0], r.sellerName ?? '', r.approvedBy ?? '', ...r.lines.map(l => l.name)]
      .join(' ').toLocaleLowerCase('az');
    return hay.includes(q);
  });
}
