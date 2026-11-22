import type { Order } from '@/types';

/**
 * The cash the guest handed over. An order keeps only the cash it kept
 * (cashAmount) and the change it gave back, so a receipt that printed
 * "Nağd 40.39 · Qaytarıldı 9.61" made the guest add them up to find their 50
 * (2026-11-20). The paper, the till and the admin show this one number.
 */
export function cashGiven(order: Pick<Order, 'cashAmount' | 'changeAmount'>): number {
  return Math.round(((order.cashAmount ?? 0) + (order.changeAmount ?? 0)) * 100) / 100;
}
