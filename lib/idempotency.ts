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
  | {
      applied: false;
      commit: (result: unknown) => Promise<void>;
      /** Give the key back, so a retry is not told the write already happened. */
      release: () => Promise<void>;
    };

/**
 * Claim the right to perform this write.
 *
 * Callers without a key (an ordinary online till on an older build) get a claim
 * that always proceeds and records nothing, so nothing changes for them.
 *
 * `repeatable` says this route's writes can run twice without doubling
 * anything — every insert either carries the till's own id or tolerates a
 * duplicate key. Only such a route may re-run a claim whose work never
 * finished. The row is written before the work, so a request that dies halfway
 * leaves the key taken and no answer recorded, and the retry behind it was
 * being told "already done" for a write that had only half happened. That is
 * how an order reached the server with its dishes missing: the till then
 * dropped the entry as sent, and the kitchen was never told at all — Test
 * Restoran, orders 3408 and 3418, 2026-09-14, the only two unfinished claims in
 * the table and the only two orders in it with no items.
 *
 * A route that is not repeatable — anything that moves money — keeps the old
 * answer. Replying "done" to a write that half happened is wrong; applying a
 * payment twice is worse, and telling those two apart needs more than this
 * table has in it.
 */
export async function claim(
  db: SupabaseClient,
  key: string | null,
  companyId: string,
  route: string,
  opts?: { repeatable?: boolean },
): Promise<Claim> {
  if (!key) {
    return { applied: false, commit: async () => {}, release: async () => {} };
  }

  const { error } = await db
    .from('applied_mutations')
    .insert({ key, company_id: companyId, route });

  const held = {
    applied: false as const,
    commit: async (result: unknown) => {
      await db.from('applied_mutations').update({ result }).eq('key', key);
    },
    release: async () => {
      await db.from('applied_mutations').delete().eq('key', key).is('result', null);
    },
  };

  if (!error) {
    // We hold the key. Record the answer once we have one, so a retry can be
    // told what happened rather than doing it again.
    return held;
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

  // No answer recorded against a key that is taken: the request holding it never
  // reached its commit. See the note above — a repeatable route does the work
  // again rather than reporting a success that never happened.
  if (data && data.result === null && opts?.repeatable) return held;

  return { applied: true, result: data?.result ?? { ok: true } };
}
