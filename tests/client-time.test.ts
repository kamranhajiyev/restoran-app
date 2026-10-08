// 2026-10-08: a sale paid offline at 23:50 reached the server after midnight
// and was stamped with the server's clock — the next shift, the next day. The
// till sends when it happened; the server keeps that unless it is unbelievable.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { clientTime } from '@/lib/client-time';

const now = new Date('2026-10-09T00:10:00Z');

describe('the time a till sends', () => {
  it('is kept when it is believable', () => {
    expect(clientTime('2026-10-08T23:50:00Z', now)).toBe('2026-10-08T23:50:00.000Z');
  });

  it('falls back to now when missing, broken, in the future or a week old', () => {
    for (const bad of [undefined, null, 42, 'garbage', '2026-10-09T01:00:00Z', '2026-09-30T00:00:00Z']) {
      expect(clientTime(bad, now)).toBe(now.toISOString());
    }
  });
});

describe('the routes', () => {
  it('stamp payments and shift closes with the till time', () => {
    expect(readFileSync('app/api/update-order-status/route.ts', 'utf8')).toMatch(/paid_at = clientTime\(paidAt\)/);
    expect(readFileSync('app/api/close-shift/route.ts', 'utf8')).toMatch(/closed_at: clientTime\(closedAt\)/);
  });

  it('get that time from the till', () => {
    const seller = readFileSync('app/seller/page.tsx', 'utf8');
    expect(seller).toMatch(/courierDebt, paidAt, companyId/);
    expect(seller).toMatch(/closedAt: new Date\(\)\.toISOString\(\)/);
  });
});
