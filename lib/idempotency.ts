// Applying a queued till write exactly once.
//
// An offline till holds its writes until the line returns, then sends them. If
// the reply is lost on the way back — a dropout mid-request is exactly the
// weather this feature exists for — the entry is still in the till's queue and
// gets sent again. This makes the second send harmless.
//
// The claim is the insert itself: the primary key on applied_mutations means
// only one request can win, even if two arrive at the same moment.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export function idempotencyKey(req: NextRequest): string | null {
  return req.headers.get('Idempotency-Key');
}

type Claim =
  | { applied: true; result: unknown }   // already done — replay the old answer
  | { applied: false; commit: (result: unknown) => Promise<void> };

/**
 * Claim the right to perform this write.
 *
 * Callers without a key (an ordinary online till on an older build) get a claim
 * that always proceeds and records nothing, so nothing changes for them.
 */
export async function claim(
  db: SupabaseClient,
  key: string | null,
  companyId: string,
  route: string,
): Promise<Claim> {
  if (!key) {
    return { applied: false, commit: async () => {} };
  }

  const { error } = await db
    .from('applied_mutations')
    .insert({ key, company_id: companyId, route });

  if (!error) {
    // We hold the key. Record the answer once we have one, so a retry can be
    // told what happened rather than doing it again.
    return {
      applied: false,
      commit: async (result: unknown) => {
        await db.from('applied_mutations').update({ result }).eq('key', key);
      },
    };
  }

  // Anything other than "someone got here first" is a real failure, and must not
  // be mistaken for a completed write.
  if (!/duplicate key|unique constraint/i.test(error.message)) {
    throw new Error(`idempotency claim failed: ${error.message}`);
  }

  const { data } = await db
    .from('applied_mutations')
    .select('result')
    .eq('key', key)
    .maybeSingle();

  return { applied: true, result: data?.result ?? { ok: true } };
}
