// Xidmət haqqı: the percent on top of an order (lib/service-charge).

import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { Order } from '@/types';
import {
  addedCharge, chargeFor, cleanServiceCharge, newOrderTypeId, NO_SERVICE_CHARGE, orderServiceCharge, orderTypeId, serviceAmount,
  serviceChargeColumn, serviceChargeProblem,
} from '@/lib/service-charge';
import { orderTotal } from '@/components/seller/order-format';

vi.mock('@/lib/supabase', () => ({ supabase: {} }));

describe('serviceAmount', () => {
  it('is 8 ₼ on a 100 ₼ order at 8%', () => {
    expect(serviceAmount(100, 8)).toBe(8);
  });

  it('rounds to the qəpik', () => {
    // 33.33 × 10% = 3.333 → 3.33; 12.35 × 10% = 1.235 → 1.24
    expect(serviceAmount(33.33, 10)).toBe(3.33);
    expect(serviceAmount(12.35, 10)).toBe(1.24);
  });

  it('is 0 with no percent or an empty order', () => {
    expect(serviceAmount(100, 0)).toBe(0);
    expect(serviceAmount(0, 8)).toBe(0);
  });
});

describe('chargeFor', () => {
  const sc = { on: true, percent: 8, typeIds: ['masa', 'b'] };

  it('charges only the picked order types', () => {
    expect(chargeFor(sc, 'masa')).toBe(8);
    expect(chargeFor(sc, 'b')).toBe(8);
    expect(chargeFor(sc, 'takeaway')).toBe(0);
    expect(chargeFor(sc, undefined)).toBe(0);
  });

  it('charges nothing when switched off', () => {
    expect(chargeFor({ ...sc, on: false }, 'masa')).toBe(0);
  });
});

describe('serviceChargeProblem', () => {
  it('needs a percent and a type when it is on', () => {
    expect(serviceChargeProblem({ on: true, percent: 0, typeIds: ['masa'] })).toBe('Faiz yazın');
    expect(serviceChargeProblem({ on: true, percent: 8, typeIds: [] })).toBe('Ən azı bir sifariş növü seçin');
    expect(serviceChargeProblem({ on: true, percent: 120, typeIds: ['masa'] })).toBe('Faiz 100-dən çox ola bilməz');
    expect(serviceChargeProblem({ on: true, percent: Number('abc'), typeIds: ['masa'] })).toBe('Faiz düzgün deyil');
    expect(serviceChargeProblem({ on: true, percent: 8, typeIds: ['masa'] })).toBeNull();
  });

  it('lets an empty one be saved switched off', () => {
    expect(serviceChargeProblem({ on: false, percent: 0, typeIds: [] })).toBeNull();
  });
});

describe('cleanServiceCharge', () => {
  it('is off when the company never set it', () => {
    expect(cleanServiceCharge(null)).toEqual(NO_SERVICE_CHARGE);
    expect(cleanServiceCharge([])).toEqual(NO_SERVICE_CHARGE);
  });

  it('keeps a good setting', () => {
    expect(cleanServiceCharge({ on: true, percent: 8, typeIds: ['masa', 'masa', 3, 'b'] }))
      .toEqual({ on: true, percent: 8, typeIds: ['masa', 'b'] });
  });

  it('never charges from a broken row', () => {
    expect(cleanServiceCharge({ on: true, percent: 'x', typeIds: ['masa'] }).on).toBe(false);
    expect(cleanServiceCharge({ on: true, percent: 500, typeIds: ['masa'] }).on).toBe(false);
    expect(cleanServiceCharge({ on: true, percent: 8, typeIds: [] }).on).toBe(false);
    expect(cleanServiceCharge({ on: 'yes', percent: 8, typeIds: ['masa'] }).on).toBe(false);
  });
});

describe('which order type an order is', () => {
  it('is the type it remembers, or the built-in it went by', () => {
    expect(orderTypeId({ orderType: 'b', tableNumber: 5 })).toBe('b');
    expect(orderTypeId({ tableNumber: 5 })).toBe('masa');
    expect(orderTypeId({ tableNumber: 0, courierId: 'c1' })).toBe('delivery');
    expect(orderTypeId({ tableNumber: 0 })).toBe('takeaway');
  });

  it('reads the same in the cart as on the saved order', () => {
    expect(newOrderTypeId(null, 'masa')).toBe('masa');
    expect(newOrderTypeId(null, 'kuryer')).toBe('delivery');
    expect(newOrderTypeId(null, null)).toBe('takeaway');
    expect(newOrderTypeId({ id: 'b' }, 'takeaway')).toBe('b');
  });
});

// 100 ₼ of dishes at 8%: every screen and the paper say 108.
const order = {
  id: 'o1',
  orderNumber: 7,
  tableNumber: 3,
  items: [
    { menuItem: { id: 'm1', name: 'Kabab', price: 40 }, quantity: 2 },
    { menuItem: { id: 'm2', name: 'Çay', price: 10 }, quantity: 2 },
  ],
  status: 'gözləyir',
  createdAt: '2026-10-29T12:00:00Z',
  sellerName: 'Natiq',
  serviceChargePercent: 8,
} as unknown as Order;

describe('the order total', () => {
  it('has the charge in it', () => {
    expect(orderServiceCharge(order)).toBe(8);
    expect(orderTotal(order)).toBe(108);
  });

  it('follows dishes added later', () => {
    const more = { ...order, items: [...order.items, { menuItem: { id: 'm3', name: 'Su', price: 50 }, quantity: 1 }] } as Order;
    expect(orderTotal(more)).toBe(162);
  });

  it('takes a discount off after the charge', () => {
    expect(orderTotal({ ...order, discountAmount: 10 })).toBe(98);
  });

  it('is unchanged on an order without one', () => {
    expect(orderTotal({ ...order, serviceChargePercent: undefined })).toBe(100);
  });
});

describe('the paper', () => {
  it('prints the charge on the HESAB', async () => {
    const { billLines } = await import('@/lib/printer');
    const texts = billLines(order, 'Test Restoran', 'Masa 3').map(l => l.text.replace(/\s+/g, ' '));
    expect(texts).toContain('Cəmi: 100.00m');
    expect(texts).toContain('Xidmət haqqı (8%): 8.00m');
    expect(texts).toContain('ÖDƏNİLƏCƏK: 108.00m');
  });

  it('prints it on the paid receipt', async () => {
    const { receiptLines } = await import('@/lib/printer');
    const paid = { ...order, status: 'ödənilib', cashAmount: 108 } as Order;
    const texts = receiptLines(paid, 'Test Restoran', 'Masa 3').map(l => l.text.replace(/\s+/g, ' '));
    expect(texts).toContain('Cəmi: 100.00m');
    expect(texts).toContain('Xidmət haqqı (8%): 8.00m');
    expect(texts).toContain('CƏMİ: 108.00m');
  });

  it('prints no charge line on an order without one', async () => {
    const { billLines } = await import('@/lib/printer');
    const texts = billLines({ ...order, serviceChargePercent: undefined }, 'Test Restoran').map(l => l.text);
    expect(texts.some(t => t.startsWith('Xidmət haqqı'))).toBe(false);
    expect(texts.some(t => t.startsWith('Cəmi'))).toBe(false);
  });
});

describe('what the write paths send', () => {
  it('sends the percent only when there is one', () => {
    expect(serviceChargeColumn({})).toEqual({});
    expect(serviceChargeColumn({ serviceChargePercent: 0 })).toEqual({});
    expect(serviceChargeColumn({ serviceChargePercent: 8 })).toEqual({ service_charge_percent: 8 });
  });

  it('is used by every place that inserts orders, and read back by both readers', () => {
    const read = (f: string) => readFileSync(f, 'utf8');
    for (const f of ['lib/store.ts', 'app/api/add-order/route.ts']) expect(read(f)).toContain('...serviceChargeColumn(order)');
    for (const f of ['lib/store.ts', 'app/api/public-orders/route.ts']) expect(read(f)).toContain('serviceChargePercent: o.service_charge_percent');
    expect(read('app/api/public-settings/route.ts')).toContain('serviceCharge: data.service_charge');
  });
});

describe('what admin shows', () => {
  it('shows the charge apart on each order, counted by the shared function', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).toContain('const service = orderServiceCharge(order);');
    expect(admin).toContain('Xidmət haqqı ({order.serviceChargePercent}%)');
  });
});

describe('the cart says what the bill will say', () => {
  it('rounds a float sum the same way as the saved order', () => {
    // 3.20×2 + 0.60×2 sums to 7.6000000000000005.
    const cart = [{ menuItem: { price: 3.2 }, quantity: 2 }, { menuItem: { price: 0.6 }, quantity: 2 }];
    const sum = cart.reduce((s, c) => s + c.menuItem.price * c.quantity, 0);
    expect(serviceAmount(sum, 12.5)).toBe(orderServiceCharge({ items: cart, serviceChargePercent: 12.5 }));
  });

  it('adds to an open order exactly what its total then moves by', () => {
    // 10.05 at 10% = 1.01 (1.005 up); adding 10.05 more: 20.10 at 10% = 2.01, so +1.00, not +1.01.
    const open = { items: [{ menuItem: { price: 10.05 }, quantity: 1 }], serviceChargePercent: 10 };
    const cart = [{ menuItem: { price: 10.05 }, quantity: 1 }];
    expect(orderServiceCharge(open)).toBe(1.01);
    expect(orderServiceCharge({ ...open, items: [...open.items, ...cart] })).toBe(2.01);
    expect(serviceAmount(10.05, 10)).toBe(1.01); // the new dish alone: a qəpik too much
    expect(addedCharge(open, cart)).toBe(1);
    expect(addedCharge({ ...open, serviceChargePercent: undefined }, cart)).toBe(0);
  });
});

describe('the Excel export', () => {
  it('has the charge in its own column, from the shared function', () => {
    const excel = readFileSync('lib/excel.ts', 'utf8');
    expect(excel).toContain("'Xidmət haqqı (₼)': orderServiceCharge(o),");
  });
});
