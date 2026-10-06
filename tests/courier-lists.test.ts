// Test Restoran, 2026-10-06: Kuryer 3 was deactivated. The new-order picker
// dropped it, the seller's Kuryerlər tab still listed it; and deleting it was
// refused because it had orders.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { courierDeleteBlock, listedCouriers, pickableCouriers, settleableCouriers } from '@/lib/couriers';

const k1 = { id: '1', active: true, outstanding: 0 };
const k2 = { id: '2', active: true, outstanding: 12 };
const k3off = { id: '3', active: false, outstanding: 0 };
const k4offOwes = { id: '4', active: false, outstanding: 8 };
const k5gone = { id: '5', active: false, deletedAt: '2026-10-07T10:00:00Z', outstanding: 0 };
const all = [k1, k2, k3off, k4offOwes, k5gone];
const ids = (l: { id: string }[]) => l.map(c => c.id);

describe('which couriers each screen lists', () => {
  it('the new-order picker: active ones only', () => {
    expect(ids(pickableCouriers(all))).toEqual(['1', '2']);
  });

  it("the seller's Kuryerlər tab: no deactivated courier, unless it still holds money", () => {
    expect(ids(settleableCouriers(all))).toEqual(['1', '2', '4']);
  });

  it('a deleted courier whose order came back and owes again shows up to be settled', () => {
    expect(ids(settleableCouriers([{ ...k5gone, outstanding: 5 }]))).toEqual(['5']);
  });

  it('the admin list: deactivated shown, deleted not', () => {
    expect(ids(listedCouriers(all))).toEqual(['1', '2', '3', '4']);
  });
});

describe('deleting a courier', () => {
  it('is allowed once nothing is owed either way', () => {
    expect(courierDeleteBlock(0)).toBeNull();
    expect(courierDeleteBlock(12)).toMatch(/12\.00 ₼ borcu var/);
    expect(courierDeleteBlock(-3)).toMatch(/3\.00 ₼ qaytarılmalıdır/);
  });

  it('falls back to marking it deleted instead of refusing', () => {
    const store = readFileSync('lib/store.ts', 'utf8');
    expect(store).toMatch(/update\(\{ deleted_at: new Date\(\)\.toISOString\(\), active: false \}\)/);
    expect(readFileSync('components/CourierPanel.tsx', 'utf8')).not.toMatch(/Əvəzinə deaktiv edin/);
  });
});

describe('no screen filters couriers on its own', () => {
  it('seller, admin and the till read all use lib/couriers', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    const panel = readFileSync('components/CourierPanel.tsx', 'utf8');
    expect(seller).toMatch(/pickableCouriers\(couriers\)/);
    expect(seller).toMatch(/\[\.\.\.settleCouriers\]/);
    expect(seller).not.toMatch(/couriers\.filter\(c => c\.active\)/);
    expect(seller).not.toMatch(/\[\.\.\.couriers\]\s*\n\s*\.sort/);
    expect(panel).toMatch(/const shown = listedCouriers\(couriers\)/);
    // The terminal and the exe get the flag from the server, or they could not filter.
    expect(readFileSync('app/api/public-couriers/route.ts', 'utf8')).toMatch(/deletedAt: c\.deleted_at/);
  });
});
