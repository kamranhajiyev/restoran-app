// A courier order closed on "Kuryer yığacaq": the guest's receipt shows the
// amount as YEKUN, without ÖDƏNİLMƏYİB or "Kuryer yığacaq" (2026-11-23).
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const order = {
  id: 'o1', orderNumber: 12, tableNumber: 0, courierId: 'c1',
  items: [{ menuItem: { id: 'm1', name: 'Burger', price: 12.5 }, quantity: 2 }],
  status: 'ödənilib', createdAt: '2026-11-23T10:00:00Z', sellerName: 'Natiq',
  cashAmount: 0, cardAmount: 0, courierDebt: 25,
} as unknown as Order;

describe('the courier receipt', () => {
  it('shows the amount the rider collects as YEKUN', async () => {
    const { receiptLines } = await import('@/lib/printer');
    const texts = receiptLines(order, 'Test Restoran').map(l => l.text);
    expect(texts.some(t => t.startsWith('YEKUN:') && t.includes('25.00'))).toBe(true);
  });

  it('has no ÖDƏNİLMƏYİB and no "Kuryer yığacaq"', async () => {
    const { receiptLines } = await import('@/lib/printer');
    const all = JSON.stringify(receiptLines(order, 'Test Restoran'));
    expect(all).not.toMatch(/ÖDƏNİLMƏYİB/);
    expect(all).not.toMatch(/yığacaq/i);
  });
});
