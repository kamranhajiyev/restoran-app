// How an order is shown and totalled on the till. Moved out of
// app/seller/page.tsx unchanged.

import type { Order, OrderStatus } from '@/types';
import { orderServiceCharge } from '@/lib/service-charge';

// One set for the till and admin alike. Fixed colours, never the brand's: with a
// dark brand "gözləyir" came out the same grey-black as everything else. Each
// differs in lightness too, and full green — the one that needs a waiter — is
// kept for "hazırdır".
export const STATUS_COLORS: Record<OrderStatus, string> = {
  'gözləyir':  'bg-white text-stone-700 ring-1 ring-inset ring-stone-300',
  'hazırlanır':'bg-blue-100 text-blue-800',
  'hazırdır':  'bg-green-600 text-white',
  'ödənilib':  'bg-stone-100 text-stone-500',
  'ləğv edildi': 'bg-red-50 text-red-700',
  'silinib':   'bg-red-50 text-red-700',
};
// The same states as a dot on the floor plan.
export const STATUS_DOTS: Partial<Record<OrderStatus, string>> = {
  'gözləyir':  'bg-stone-400',
  'hazırlanır':'bg-blue-500',
  'hazırdır':  'bg-green-600',
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

// How long a table has been waiting, as a colour: orange after 15 minutes, red
// after 30, so a forgotten table stands out on a long list.
export type WaitLevel = 'ok' | 'late' | 'very-late';
export function waitLevel(iso: string, now = Date.now()): WaitLevel {
  const mins = (now - new Date(iso).getTime()) / 60000;
  return mins >= 30 ? 'very-late' : mins >= 15 ? 'late' : 'ok';
}
export const WAIT_COLORS: Record<WaitLevel, string> = {
  'ok':        'text-stone-500',
  'late':      'text-orange-600 font-semibold',
  'very-late': 'text-red-600 font-semibold',
};

// Money is summed in floats, so 3.20×2 + 0.60×2 comes out as 7.6000000000000005
// and a cashier typing 7.6 is told they are short by 0.00 and cannot close the
// bill. Every amount the payment sheet compares goes through this first.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// The dishes, plus the Xidmət haqqı (lib/service-charge), less a discount.
export function orderTotal(order: Order): number {
  const gross = order.items.reduce((s, oi) => s + oi.menuItem.price * oi.quantity, 0);
  return round2(gross + orderServiceCharge(order) - (order.discountAmount ?? 0));
}
