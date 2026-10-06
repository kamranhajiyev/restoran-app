// Which couriers each screen lists. The one place that decides it, so the
// new-order picker, the seller's Kuryerlər tab and the admin list cannot
// disagree — Test Restoran, 2026-10-06: a deactivated courier was gone from the
// picker but still in the seller's Kuryerlər tab.

type C = { active: boolean; deletedAt?: string | null; outstanding?: number };

const holdsMoney = (c: C) => Math.abs(c.outstanding ?? 0) > 0.005;

/** Who a seller can send with an order: active and not deleted. */
export function pickableCouriers<T extends C>(list: T[]): T[] {
  return list.filter(c => c.active && !c.deletedAt);
}

/** The seller's Kuryerlər tab: the pickable ones, plus anyone — deactivated or
 *  deleted — still holding money (or owed it), or that cash could never be
 *  taken off them. */
export function settleableCouriers<T extends C>(list: T[]): T[] {
  return list.filter(c => (c.active && !c.deletedAt) || holdsMoney(c));
}

/** The admin's courier list: everyone not deleted, deactivated included. */
export function listedCouriers<T extends C>(list: T[]): T[] {
  return list.filter(c => !c.deletedAt);
}

/** Why a courier cannot be deleted yet, or null. A deleted courier drops out of
 *  the admin list, so one still holding money would take the debt out of sight. */
export function courierDeleteBlock(outstanding: number): string | null {
  if (outstanding > 0.005) return `Kuryerin ${outstanding.toFixed(2)} ₼ borcu var — əvvəlcə borcu bağlayın.`;
  if (outstanding < -0.005) return `Kuryerə ${Math.abs(outstanding).toFixed(2)} ₼ qaytarılmalıdır — əvvəlcə bunu bağlayın.`;
  return null;
}
