// The seller page's tabs, in order, for both the side menu and the phone's
// bottom bar — one list, so the two can never disagree.
//
// "Yeni sifariş" comes first and is the screen the till opens on: taking an
// order is what staff do most (2026-11-14). The waiting-orders count stays on
// "Sifarişlər".

export type SellerTab = 'new-order' | 'orders' | 'kassa' | 'couriers' | 'history';

export const OPENING_TAB: SellerTab = 'new-order';

export const TAB_LABELS: Record<SellerTab, string> = {
  'new-order': 'Yeni sifariş',
  orders: 'Sifarişlər',
  kassa: 'Kassa',
  couriers: 'Kuryerlər',
  history: 'Tarixçə',
};

/** The tabs this till shows, in order. Kassa and Kuryerlər only where the
 *  owner turned them on. */
export function sellerTabs(s: { kassaShown: boolean; couriersShown: boolean }): SellerTab[] {
  return [
    'new-order',
    'orders',
    ...(s.kassaShown ? ['kassa' as const] : []),
    ...(s.couriersShown ? ['couriers' as const] : []),
    'history',
  ];
}
