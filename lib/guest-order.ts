// A guest's order from the QR menu, priced by the server.
//
// The menu page used to insert the order itself with the public anon key, so
// anyone could post an order into any restaurant — paid, at any price — and it
// counted as a sale. The guest now sends only what they picked; the price,
// the status and the rest are decided here.

export type GuestLine = { menuItemId: string; variantId?: string | null; quantity: number };

export type MenuRow = {
  id: string; name: string; price: number; available: boolean; qr_visible: boolean;
  variants: { id: string; name: string; price: number }[] | null;
};

export type PricedLine = {
  menu_item_id: string; menu_item_name: string; menu_item_price: number;
  quantity: number; modifiers: string | null; variant_id: string | null;
};

export const MAX_LINES = 50;
export const MAX_QTY = 99;

/** The lines with the menu's own prices, or an error for anything not orderable. */
export function priceGuestLines(lines: GuestLine[], menu: MenuRow[]): PricedLine[] | { error: string } {
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
    out.push({
      menu_item_id: item.id,
      menu_item_name: item.name,
      menu_item_price: Number(variant ? variant.price : item.price),
      quantity: qty,
      modifiers: variant?.name ?? null,
      variant_id: variant?.id ?? null,
    });
  }
  return out;
}
