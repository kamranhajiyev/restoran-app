// Xidmət haqqı: a percent of the order added on top, like 8% on a 100 ₼ order
// making the bill 108 ₼. The owner picks the percent and the order types it
// applies to (usually Masa and Banket, not Takeaway).
//
// Unlike an order type's price change (lib/order-types), this one is meant to
// be seen: the guest's bill prints it on its own line, so they know why the
// total is more than the dishes.
//
// Stored in companies.service_charge (20261031_service_charge.sql), read
// through fetchServiceCharge in lib/store.ts.

export interface ServiceCharge {
  on: boolean;
  /** Percent of the dishes' total. */
  percent: number;
  /** Order type ids (lib/order-types) it applies to. */
  typeIds: string[];
}

export const NO_SERVICE_CHARGE: ServiceCharge = { on: false, percent: 0, typeIds: ['masa'] };

const round = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** The charge on dishes worth `subtotal`, rounded to the qəpik. */
export function serviceAmount(subtotal: number, percent: number): number {
  if (!(percent > 0) || !(subtotal > 0)) return 0;
  // The subtotal to the qəpik first: summed in floats, 7.60 can arrive as
  // 7.6000000000000005, and the cart and the bill must land on the same qəpik.
  return round(round(subtotal) * percent / 100);
}

/** The percent an order of this type pays, or 0. */
export function chargeFor(sc: ServiceCharge, typeId: string | undefined): number {
  return sc.on && typeId && sc.typeIds.includes(typeId) ? sc.percent : 0;
}

/** Which order type an order is: the one it remembers, or for a plain order
 *  (no type saved, lib/order-types orderTypeFields) the built-in it went by. */
export function orderTypeId(o: { orderType?: string; tableNumber: number; courierId?: string }): string {
  return o.orderType ?? (o.courierId ? 'delivery' : o.tableNumber ? 'masa' : 'takeaway');
}

/** The type of an order still in the cart: the card it was started from, or,
 *  when none was picked, the built-in its flow is. The same id orderTypeId
 *  reads back off the saved order. */
export function newOrderTypeId(picked: { id: string } | null, flow: 'masa' | 'takeaway' | 'kuryer' | null): string {
  return picked?.id ?? (flow === 'kuryer' ? 'delivery' : flow === 'masa' ? 'masa' : 'takeaway');
}

/** The dishes, not counting lines taken off. */
export function dishesTotal(items: { menuItem: { price: number }; quantity: number }[]): number {
  return round(items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0));
}

/** The charge on an order: its percent of the dishes on it now, so dishes
 *  added or taken off later move it too. 0 on an order taken without one. */
export function orderServiceCharge(o: { items: { menuItem: { price: number }; quantity: number }[]; serviceChargePercent?: number }): number {
  return serviceAmount(dishesTotal(o.items), o.serviceChargePercent ?? 0);
}

/** What dishes still in the cart add to an open order's charge: the charge on
 *  the order with them, less the charge without. Not the percent of the new
 *  dishes alone, which can be a qəpik off what the bill will then say. */
export function addedCharge(
  o: { items: { menuItem: { price: number }; quantity: number }[]; serviceChargePercent?: number },
  cart: { menuItem: { price: number }; quantity: number }[],
): number {
  return round(orderServiceCharge({ ...o, items: [...o.items, ...cart] }) - orderServiceCharge(o));
}

/** orders.service_charge_percent for an insert, present only when there is one,
 *  so an order without it sends exactly the columns it always did. */
export function serviceChargeColumn(o: { serviceChargePercent?: number }): { service_charge_percent?: number } {
  return o.serviceChargePercent && o.serviceChargePercent > 0 ? { service_charge_percent: Number(o.serviceChargePercent) } : {};
}

/** Why the form cannot be saved, or null. */
export function serviceChargeProblem(sc: ServiceCharge): string | null {
  if (!Number.isFinite(sc.percent) || sc.percent < 0) return 'Faiz düzgün deyil';
  if (sc.percent > 100) return 'Faiz 100-dən çox ola bilməz';
  if (sc.on && !sc.percent) return 'Faiz yazın';
  if (sc.on && !sc.typeIds.length) return 'Ən azı bir sifariş növü seçin';
  return null;
}

/** companies.service_charge made safe to use; off when the company never set it. */
export function cleanServiceCharge(raw: unknown): ServiceCharge {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return NO_SERVICE_CHARGE;
  const r = raw as Record<string, unknown>;
  const percent = Number(r.percent);
  const ok = Number.isFinite(percent) && percent > 0 && percent <= 100;
  const typeIds = Array.isArray(r.typeIds) ? [...new Set(r.typeIds.filter((t): t is string => typeof t === 'string'))] : [];
  return { on: r.on === true && ok && typeIds.length > 0, percent: ok ? percent : 0, typeIds };
}
