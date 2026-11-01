// 2026-11-01: how an order's number is written (lib/order-label.ts) had no
// test. Two offline tills can both print 45; "45/2" is the only thing telling
// the two bills apart, and a restaurant with one till must still just see 45.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { orderLabel, orderSearchText } from '@/lib/order-label';

describe('an order number', () => {
  it('reads as just the number from the server or till 1', () => {
    expect(orderLabel({ orderNumber: 45 })).toBe('45');
    expect(orderLabel({ orderNumber: 45, tillNumber: 1 })).toBe('45');
  });

  it('names the till from till 2 on', () => {
    expect(orderLabel({ orderNumber: 45, tillNumber: 2 })).toBe('45/2');
    expect(orderLabel({ orderNumber: 45, tillNumber: 9 })).toBe('45/9');
  });

  it('is found by "45" and by "45/2"', () => {
    expect(orderSearchText({ orderNumber: 45, tillNumber: 2 })).toBe('45 45/2');
    expect(orderSearchText({ orderNumber: 45 })).toBe('45');
  });

  it('is written this way on the till, admin, the kitchen screen and paper', () => {
    for (const file of ['components/seller/OrderRow.tsx', 'app/admin/page.tsx', 'app/station/page.tsx', 'lib/printer.ts']) {
      expect(readFileSync(file, 'utf8'), file).toMatch(/orderLabel\(/);
    }
  });
});
