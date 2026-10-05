// The check every /api/public-* read makes before answering. See
// lib/till-read-token.ts for why the reads need it at all.

import { verifySellerToken } from '@/lib/supabase-server';
import { TILL_TOKEN_HEADER } from '@/lib/till-read-token';

// A till reads a dozen routes in one sync, and the signal makes it read more
// often; asking the database each time would add a query to every read. A
// minute is how long a revoked link can go on reading — its writes are refused
// at once, as before.
const TRUST_MS = 60_000;
const trusted = new Map<string, number>();

// The lock. False while some tills still run an exe that sends no token; set
// it to true once every till has the new exe, and a read without a token is
// refused.
export const READS_NEED_TOKEN = false;

async function tokenGood(companyId: string, token: string, now: number): Promise<boolean> {
  const key = `${companyId}:${token}`;
  if ((trusted.get(key) ?? 0) > now) return true;
  const ok = !!(await verifySellerToken(companyId, token));
  if (ok) trusted.set(key, now + TRUST_MS);
  else trusted.delete(key);
  return ok;
}

/**
 * Null when the read may go ahead, otherwise the answer to send instead.
 *
 * A wrong token is always refused. A missing one is refused only once
 * READS_NEED_TOKEN is true: exes built before this change send none, and
 * cutting them off would stop their menu and orders updating.
 */
export async function refuseTillRead(
  req: Request,
  companyId: string,
  now = Date.now(),
  needToken = READS_NEED_TOKEN,
): Promise<Response | null> {
  const token = req.headers.get(TILL_TOKEN_HEADER);
  if (!token) {
    if (needToken) return Response.json({ error: 'token' }, { status: 401 });
    return null;
  }
  if (await tokenGood(companyId, token, now)) return null;
  return Response.json({ error: 'revoked' }, { status: 403 });
}
