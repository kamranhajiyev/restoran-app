// What a Mağaza's till does differently (SHOP-MODE.md). One place for the
// rules, so the side menu, the bottom bar, the cart and the lists cannot each
// decide on their own.

import type { CompanyKind } from './company-kind';
import { DEFAULT_ORDER_TYPES, type OrderType } from './order-types';
import { TAB_LABELS, type SellerTab } from './seller-nav';

/** The tab names: a shop sells and keeps sales, not orders. */
export function tabLabel(id: SellerTab, kind: CompanyKind): string {
  if (kind === 'shop' && id === 'new-order') return 'Yeni satış';
  if (kind === 'shop' && id === 'orders') return 'Satışlar';
  return TAB_LABELS[id];
}

/** The order type every shop sale is saved under: the built-in Takeaway, even
 *  when a restaurant that became a shop had switched it off — a shop has no
 *  other way to sell. */
export function shopSaleType(types: OrderType[]): OrderType {
  const own = types.find(t => t.builtIn === 'takeaway');
  return own ? { ...own, on: true } : DEFAULT_ORDER_TYPES.find(t => t.builtIn === 'takeaway')!;
}

/** The Çatdırılma type, when the shop delivers. */
export function shopDeliveryType(types: OrderType[], deliveryOn: boolean): OrderType | null {
  if (!deliveryOn) return null;
  return types.find(t => t.builtIn === 'delivery' && t.on) ?? null;
}

/** A sale paid on the spot: in a shop, not a delivery (the courier pays later)
 *  and not an addition to an order already open. */
export function paysNow(s: { kind: CompanyKind; appending: boolean; delivery: boolean }): boolean {
  return s.kind === 'shop' && !s.appending && !s.delivery;
}

/** Admin's side menu and page titles in a shop. Masalar becomes Onlayn: only
 *  the online menu link and its switches are left there. */
export const SHOP_ADMIN: Partial<Record<string, { label: string; title: string; subtitle?: string }>> = {
  orders: { label: 'Satışlar', title: 'Satışlar', subtitle: 'Bütün satışlar' },
  menu: { label: 'Məhsullar', title: 'Məhsullar' },
  tables: { label: 'Onlayn', title: 'Onlayn', subtitle: 'Onlayn menyu və QR sifariş' },
};

/** How a sale was paid, for a shop's Satışlar list in place of the status:
 *  Nağd, Kart, Nağd + Kart — or Kuryerdə while the courier still has it. */
export function paidHow(o: { status: string; cashAmount?: number; cardAmount?: number; courierDebt?: number }): string | null {
  if (o.status !== 'ödənilib') return null;
  if ((o.courierDebt ?? 0) > 0) return 'Kuryerdə';
  const cash = (o.cashAmount ?? 0) > 0, card = (o.cardAmount ?? 0) > 0;
  return cash && card ? 'Nağd + Kart' : card ? 'Kart' : 'Nağd';
}

/** Till permissions a shop never meets: it prints no bill before payment. */
export const SHOP_HIDDEN_ACTIONS: readonly string[] = ['remove_after_bill', 'add_after_bill'];
