// 2026-10-08: admin and Excel each had their own order total, unrounded, next
// to the till's rounded one — a screen counting on its own can drift from the
// till. One function, used by all three.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const OWN_TOTAL = /function orderTotal\(|items\.reduce\(\(s, oi\) => s \+ oi\.menuItem\.price \* oi\.quantity, 0\);\s*const total =/;

describe('the order total', () => {
  it('is not worked out again in admin or Excel', () => {
    for (const p of ['app/admin/page.tsx', 'lib/excel.ts']) {
      const src = readFileSync(p, 'utf8');
      expect(src).not.toMatch(OWN_TOTAL);
      expect(src).toMatch(/import \{ orderTotal \} from '@\/components\/seller\/order-format'/);
    }
  });
});
