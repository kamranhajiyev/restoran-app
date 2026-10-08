// 2026-10-08: two database functions checked the company only for a signed-in
// caller, so the public anon key could add courier payments to, and cancel
// deliveries in, any restaurant. The PIN check was open too, with a lockout
// keyed on a device id the caller picks.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('functions the public key must not call', () => {
  const sql = readFileSync('supabase/migrations/20261008_close_public_rpcs.sql', 'utf8');

  it('are revoked from public and anon, not just anon', () => {
    for (const fn of ['add_courier_payment', 'cancel_courier_order', 'verify_staff_pin_for_company']) {
      expect(sql).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^)]*\\) from public, anon`));
    }
  });
});
