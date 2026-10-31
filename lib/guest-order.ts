// A guest's order from the QR menu, priced by the server.
//
// The menu page used to insert the order itself with the public anon key, so
// anyone could post an order into any restaurant — paid, at any price — and it
// counted as a sale. The guest now sends only what they picked; the price,
// the status and the rest are decided here.
//
// A QR link can name an order type (?type=banket): its menu shows that type's
// prices and its orders are saved under it. Without one the link means what it
// always did: Masa at a table, Takeaway without. Either way the type's price
// change applies, so the guest pays what a waiter would have charged.

import {
  asksForTable, NO_CHANGE, pricedLine, withSwitches, type OrderType, type PriceChange,
} from './order-types';

export type GuestLine = { menuItemId: string; variantId?: string | null; quantity: number };

export type MenuRow = {
  id: string; name: string; price: number; available: boolean; qr_visible: boolean;
  variants: { id: string; name: string; price: number }[] | null;
};

export type PricedLine = {
  menu_item_id: string; menu_item_name: string; menu_item_price: number;
  quantity: number; modifiers: string | null; variant_id: string | null;
  /** The menu price, only when the order type changed it. */
  menu_price?: number;
};

export const MAX_LINES = 50;
export const MAX_QTY = 99;

/** The order type a QR link is for, or why it takes no orders. `typeId` is
 *  the link's ?type=, absent on the links made before types had QRs. */
export function guestOrderType(
  types: OrderType[], typeId: string | null | undefined, hasTable: boolean,
  s: { tablesOn: boolean; deliveryOn: boolean },
): OrderType | { error: string } {
  const all = withSwitches(types, s);
  if (!typeId) return all.find(t => t.builtIn === (hasTable ? 'masa' : 'takeaway'))!;
  const t = all.find(x => x.id === typeId);
  if (!t || !t.on) return { error: 'bad_type' };
  // A type the waiter opens on a table gets one QR per table: without the
  // table nobody would know where to bring the food.
  if (asksForTable(t, s.tablesOn) && !hasTable) return { error: 'pick_table' };
  return t;
}

/** The QR menu's address for a type, and for a table when it has one. */
export function guestMenuLink(origin: string, slug: string, typeId: string, tableId?: number): string {
  const q = new URLSearchParams({ type: typeId });
  if (tableId) q.set('table', String(tableId));
  return `${origin}/${slug}/menu?${q}`;
}

/** The lines with the menu's own prices under the order type's change, or an
 *  error for anything not orderable. */
export function priceGuestLines(lines: GuestLine[], menu: MenuRow[], change: PriceChange = NO_CHANGE): PricedLine[] | { error: string } {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES) return { error: 'bad_lines' };
  const byId = new Map(menu.map(m => [m.id, m]));
  const out: PricedLine[] = [];
  for (const l of lines) {
    const item = byId.get(String(l?.menuItemId));
    const qty = Number(l?.quantity);
    if (!item || !item.available || item.qr_visible === false) return { error: 'unavailable' };
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { error: 'bad_quantity' };
    const variants = item.variants ?? [];
    const variant = l.variantId ? variants.find(v => v.id === l.variantId) : undefined;
    if (l.variantId && !variant) return { error: 'unavailable' };
    if (!l.variantId && variants.length > 0) return { error: 'pick_variant' };
    const { price, menuPrice } = pricedLine(Number(variant ? variant.price : item.price), change);
    out.push({
      menu_item_id: item.id,
      menu_item_name: item.name,
      menu_item_price: price,
      quantity: qty,
      modifiers: variant?.name ?? null,
      variant_id: variant?.id ?? null,
      ...(menuPrice != null ? { menu_price: menuPrice } : {}),
    });
  }
  return out;
}
