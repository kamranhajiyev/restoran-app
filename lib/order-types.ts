// Sifariş növləri: Masa, Takeaway, Çatdırılma and the ones the owner adds
// (Banket, Glovo…). Each can be switched off, and each can move every menu
// price up or down by manat or by percent.
//
// The price change lives here and only here: the menu the waiter sees, the
// bill, the receipt and the reports must all land on the same qəpik, and the
// one way to be sure of that is one function.
//
// Nothing about the type prints on the guest's bill or receipt: no name, no
// extra line. The change sits inside each dish's price, so the paper looks like
// any other order (only the kitchen ticket names the type). That is why the
// change is always per dish; a once-per-order amount would need its own line.
//
// Stored in companies.order_types (20261030_order_types.sql), read through
// fetchOrderTypes in lib/store.ts.

export type BuiltInType = 'masa' | 'takeaway' | 'delivery';

export interface PriceChange {
  /** +1 raises prices, -1 is a discount. */
  sign: 1 | -1;
  /** Manat, or percent when unit is '%', on every dish. 0 means no change. */
  amount: number;
  unit: 'azn' | '%';
}

export interface OrderType {
  id: string;
  name: string;
  /** Set on the three the till always had; those can be switched off but not deleted. */
  builtIn?: BuiltInType;
  on: boolean;
  /** Opens the hall and tables first, like Masa. Off goes straight to the menu. */
  needsTable: boolean;
  change: PriceChange;
}

export const NO_CHANGE: PriceChange = { sign: 1, amount: 0, unit: 'azn' };

export const DEFAULT_ORDER_TYPES: OrderType[] = [
  { id: 'masa', name: 'Masa', builtIn: 'masa', on: true, needsTable: true, change: NO_CHANGE },
  { id: 'takeaway', name: 'Takeaway', builtIn: 'takeaway', on: true, needsTable: false, change: NO_CHANGE },
  { id: 'delivery', name: 'Çatdırılma', builtIn: 'delivery', on: true, needsTable: false, change: NO_CHANGE },
];

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** A menu price under this order type, rounded to the qəpik. A discount never
 *  takes a dish below 0, and a free one (0 ₼) stays free: "+1 ₼" must not start
 *  charging for the bread. */
export function typedPrice(price: number, change: PriceChange): number {
  if (!change.amount || price <= 0) return price;
  const delta = change.unit === '%' ? price * change.amount / 100 : change.amount;
  return Math.max(0, round(price + change.sign * delta));
}

/** What the order comes to under this type: the dishes at their typed prices. */
export function typedTotal(lines: { price: number; quantity: number }[], change: PriceChange): number {
  return round(lines.reduce((s, l) => s + typedPrice(l.price, change) * l.quantity, 0));
}

/** "+5%", "−1.00 ₼", or '' when the type leaves prices alone. */
export function changeLabel(change: PriceChange): string {
  if (!change.amount) return '';
  const sign = change.sign > 0 ? '+' : '−';
  return change.unit === '%' ? `${sign}${change.amount}%` : `${sign}${change.amount.toFixed(2)} ₼`;
}

/** The types the seller's "Yeni sifariş" offers, in the owner's order. */
export function shownTypes(types: OrderType[], s: { tablesOn: boolean; deliveryOn: boolean }): OrderType[] {
  return withSwitches(types, s).filter(t => t.on);
}

/** Which of the till's three flows a type starts: pick a table, pick a
 *  courier, or straight to the menu. */
export function typeFlow(t: OrderType, tablesOn: boolean): 'masa' | 'kuryer' | 'takeaway' {
  if (t.builtIn === 'delivery') return 'kuryer';
  if (t.builtIn === 'masa') return 'masa';
  return asksForTable(t, tablesOn) ? 'masa' : 'takeaway';
}

/**
 * What an order remembers about its type. Only when the type matters beyond
 * what the order already says (a table, a courier): one the owner added, or a
 * built-in with a price change. Everything else writes nothing, so an order
 * looks exactly as it did before types existed.
 */
export function orderTypeFields(t: OrderType | null | undefined): { orderType?: string; orderTypeName?: string } {
  if (!t || (t.builtIn && !t.change.amount)) return {};
  return { orderType: t.id, orderTypeName: t.name };
}

/**
 * The order_types columns for an insert, present only when the order has a
 * type. Every write path (lib/store, /api/add-order) spreads this, so an order
 * without one sends exactly the columns it always did.
 */
export function orderTypeColumns(o: { orderType?: string; orderTypeName?: string }): { order_type?: string; order_type_name?: string | null } {
  return o.orderType ? { order_type: o.orderType, order_type_name: o.orderTypeName ?? null } : {};
}

/** order_items.menu_price, present only on a line whose type changed its price. */
export function menuPriceColumn(oi: { menuPrice?: number }): { menu_price?: number } {
  return oi.menuPrice != null && Number.isFinite(oi.menuPrice) ? { menu_price: Number(oi.menuPrice) } : {};
}

/**
 * A line going into the cart under a type: what is charged, and the menu price
 * it came from when the two differ. `price` is the menu price with the picked
 * size and modifiers already in it.
 */
export function pricedLine(price: number, change: PriceChange): { price: number; menuPrice?: number } {
  const charged = typedPrice(price, change);
  return charged === price ? { price } : { price: charged, menuPrice: price };
}

/**
 * What the order's type added (positive) or took off (negative), over the
 * lines it changed: charged minus menu price. 0 on an order without a type.
 * The admin badge reads this; the guest's paper never does.
 */
export function typeExtra(items: { menuItem: { price: number }; quantity: number; menuPrice?: number }[]): number {
  return round(items.reduce((s, oi) => oi.menuPrice == null ? s : s + (oi.menuItem.price - oi.menuPrice) * oi.quantity, 0));
}

/** Where an order went, with its type in front when it has one: "Xarici",
 *  "Banket · Zal 1 · 5". `place` is what orderPlace already says. */
export function placeWithType(place: string, o: { orderTypeName?: string; tableNumber: number }): string {
  if (!o.orderTypeName) return place;
  return o.tableNumber && place ? `${o.orderTypeName} · ${place}` : o.orderTypeName;
}

/** The price change an existing order was taken under, looked up by the type
 *  it remembers. A type deleted since changes nothing on new lines. */
export function changeFor(orderType: string | undefined, types: OrderType[]): PriceChange {
  return (orderType && types.find(t => t.id === orderType)?.change) || NO_CHANGE;
}

/** Whether picking this type opens the hall and tables. With Masalar switched
 *  off there are no tables to pick, so every type goes straight to the menu. */
export function asksForTable(t: Pick<OrderType, 'needsTable'>, tablesOn: boolean): boolean {
  return tablesOn && t.needsTable;
}

/** Why a new or edited type cannot be saved, or null. */
export function orderTypeProblem(t: Pick<OrderType, 'id' | 'name' | 'change'>, all: OrderType[]): string | null {
  const name = t.name.trim();
  if (!name) return 'Ad yazın';
  if (all.some(o => o.id !== t.id && o.name.trim().toLocaleLowerCase('az') === name.toLocaleLowerCase('az'))) {
    return 'Bu adda sifariş növü artıq var';
  }
  if (!Number.isFinite(t.change.amount) || t.change.amount < 0) return 'Məbləğ düzgün deyil';
  if (t.change.unit === '%' && t.change.sign < 0 && t.change.amount > 100) return 'Endirim 100%-dən çox ola bilməz';
  return null;
}

const BUILT_INS: BuiltInType[] = ['masa', 'takeaway', 'delivery'];

function cleanChange(raw: unknown): PriceChange {
  const c = (raw ?? {}) as Record<string, unknown>;
  const amount = Number(c.amount);
  if (!Number.isFinite(amount) || amount <= 0) return NO_CHANGE;
  return { sign: c.sign === -1 ? -1 : 1, amount, unit: c.unit === '%' ? '%' : 'azn' };
}

/**
 * The list as companies.order_types holds it, made safe to use: anything
 * malformed is dropped, and the three built-ins are always there, first, even
 * when the column is null (a restaurant that never opened the screen).
 */
export function cleanOrderTypes(raw: unknown): OrderType[] {
  const rows = Array.isArray(raw) ? raw as Record<string, unknown>[] : [];
  const seen = new Set<string>();
  const parsed: OrderType[] = [];
  for (const r of rows) {
    if (!r || typeof r !== 'object' || typeof r.id !== 'string' || seen.has(r.id)) continue;
    const builtIn = BUILT_INS.find(b => b === r.builtIn);
    const name = typeof r.name === 'string' ? r.name.trim() : '';
    if (!name && !builtIn) continue;
    seen.add(r.id);
    const base = builtIn && DEFAULT_ORDER_TYPES.find(d => d.builtIn === builtIn)!;
    parsed.push({
      id: base ? base.id : r.id,
      name: name || base!.name,
      ...(builtIn ? { builtIn } : {}),
      on: r.on !== false,
      needsTable: base ? base.needsTable : r.needsTable === true,
      change: cleanChange(r.change),
    });
  }
  const builtIns = DEFAULT_ORDER_TYPES.map(d => parsed.find(p => p.builtIn === d.builtIn) ?? d);
  return [...builtIns, ...parsed.filter(p => !p.builtIn)];
}

/**
 * Masa and Çatdırılma are switched on and off by the switches that already
 * existed (Masalar, Kuryerlər), so there is one switch each, not two that can
 * disagree. Whatever the list says about them is overruled here.
 */
export function withSwitches(types: OrderType[], s: { tablesOn: boolean; deliveryOn: boolean }): OrderType[] {
  return types.map(t =>
    t.builtIn === 'masa' ? { ...t, on: s.tablesOn }
    : t.builtIn === 'delivery' ? { ...t, on: s.deliveryOn }
    : t);
}
