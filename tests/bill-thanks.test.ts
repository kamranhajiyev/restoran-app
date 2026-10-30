// The first paper the guest gets is the HESAB the waiter brings to the table.
// The restaurant wants the thank-you on it too, not only on the paid receipt
// (customer request, 2026-10-28).

import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

const order = {
  id: 'o1',
  orderNumber: 7,
  tableNumber: 3,
  items: [{ menuItem: { id: 'm1', name: 'Çay', price: 2 }, quantity: 2 }],
  status: 'pending',
  createdAt: '2026-10-28T12:00:00Z',
  sellerName: 'Natiq',
} as unknown as Order;

describe('the HESAB bill', () => {
  it('ends with Təşəkkürlər!', async () => {
    const { billLines } = await import('@/lib/printer');
    const lines = billLines(order, 'Test Restoran', 'Masa 3');
    expect(lines[lines.length - 1].text).toBe('Təşəkkürlər!');
  });

  it('is still a HESAB, not a receipt', async () => {
    const { billLines } = await import('@/lib/printer');
    const texts = billLines(order, 'Test Restoran', 'Masa 3').map((l) => l.text);
    expect(texts).toContain('HESAB');
    expect(texts.some((t) => t.startsWith('ÖDƏNİLƏCƏK:'))).toBe(true);
  });
});
