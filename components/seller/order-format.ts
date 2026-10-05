// How an order is shown and totalled on the till. Moved out of
// app/seller/page.tsx unchanged.

import type { Order, OrderStatus } from '@/types';

export const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-primary-100 text-primary-700',
  'hazırlanır':'bg-blue-100 text-blue-700',
  'hazırdır':  'bg-green-100 text-green-700',
  'ödənilib':  'bg-stone-100 text-stone-600',
  'ləğv edildi': 'bg-red-100 text-red-600',
  'silinib':   'bg-red-100 text-red-600',
};
export const STATUS_LABELS: Record<OrderStatus, string> = {
  'gözləyir':   'gözləyir',
  'hazırlanır': 'hazırlanır',
  'hazırdır':   'hazırdır',
  'ödənilib':   'ödənilib',
  'ləğv edildi':'ödənişsiz bağlandı',
  'silinib':    'silinib',
};

export function elapsed(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `${mins} dəq`;
  return `${Math.floor(mins / 60)} saat`;
}

// Money is summed in floats, so 3.20×2 + 0.60×2 comes out as 7.6000000000000005
// and a cashier typing 7.6 is told they are short by 0.00 and cannot close the
// bill. Every amount the payment sheet compares goes through this first.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function orderTotal(order: Order): number {
  const gross = order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
  return round2(gross - (order.discountAmount ?? 0));
}
