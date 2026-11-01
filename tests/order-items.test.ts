// 2026-11-01: the step that keeps a removed dish off the bill when an order is
// read back (lib/order-items.ts) had no test. A removed dish leaking into
// `items` over-charges the guest and over-counts every report.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { orderTotal } from '@/components/seller/order-format';
import { splitOrderItems, type OrderItemRow } from '@/lib/order-items';
import type { Order } from '@/types';

const row = (id: string, name: string, price: number | string, quantity: number, removed = false): OrderItemRow => ({
  id, menu_item_id: `m-${id}`, menu_item_name: name, menu_item_price: price as number, quantity,
  removed_at: removed ? '2026-11-01T10:00:00Z' : null, removed_by: removed ? 'Aysel' : null,
});

describe("an order's dishes, read back", () => {
  it('keep removed dishes off the bill, and on the card', () => {
    const { items, removedItems } = splitOrderItems([
      row('1', 'Plov', 6.5, 2),
      row('2', 'Plov', 6.5, 1, true),
      row('3', 'Çay', 1, 2, true),
    ]);
    expect(items.map(i => `${i.quantity} ${i.menuItem.name}`)).toEqual(['2 Plov']);
    expect(removedItems.map(i => `${i.quantity} ${i.menuItem.name} (${i.removedBy})`)).toEqual(['1 Plov (Aysel)', '2 Çay (Aysel)']);
    expect(orderTotal({ items } as Order)).toBe(13);
  });

  it("read the database's price text as money", () => {
    const { items } = splitOrderItems([row('1', 'Plov', '6.50', 3)]);
    expect(items[0].menuItem.price).toBe(6.5);
    expect(orderTotal({ items } as Order)).toBe(19.5);
  });

  it('are none when the read brought nothing', () => {
    expect(splitOrderItems(null)).toEqual({ items: [], removedItems: [] });
  });

  it('are split the same way by the website and the till', () => {
    for (const file of ['lib/store.ts', 'app/api/public-orders/route.ts']) {
      expect(readFileSync(file, 'utf8'), file).toContain('splitOrderItems(');
    }
  });
});
