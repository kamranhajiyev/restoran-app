// "gözləyir" came out grey-black on a till with a dark brand, the same as
// everything around it, and admin kept a copy of its own. One fixed set now,
// used by both, and every state looks different.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STATUS_COLORS } from '@/components/seller/order-format';

describe('order status colours', () => {
  it('never follow the brand colour', () => {
    for (const c of Object.values(STATUS_COLORS)) expect(c).not.toContain('primary');
  });

  it('tell waiting, cooking and ready apart', () => {
    const live = [STATUS_COLORS['gözləyir'], STATUS_COLORS['hazırlanır'], STATUS_COLORS['hazırdır']];
    expect(new Set(live).size).toBe(3);
  });

  it('are one set, not a copy per screen', () => {
    const admin = readFileSync('app/admin/page.tsx', 'utf8');
    expect(admin).not.toMatch(/const STATUS_COLORS/);
    expect(admin).toMatch(/import \{[^}]*STATUS_COLORS[^}]*\} from '@\/components\/seller\/order-format'/);
  });
});
