// Kitchen tickets for a till that has no login — only its terminal link.
//
// claim_print_jobs works out the company from the signed-in user, so a till
// opened with a link and nobody signed in got nothing back, and its sexes never
// printed: the jobs sat in print_jobs with the IP set and nobody to carry them.
// This is the same claim, gated on the link's token instead of a session.
//
// No RPC: claim_print_jobs cannot be told the company, and a migration is the
// wrong risk for this. The update below claims only rows that are still
// pending, so two tills racing for a ticket cannot both win it.

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

const MAX_ATTEMPTS = 5;
// The same window requeue_stale_print_jobs uses: a till that claimed a ticket
// and died mid-print hands it back after this long.
const STALE_MS = 2 * 60_000;
// Only tickets made in the last hour. A till that never printed left hundreds
// behind — Test Restoran had 260 pending back to July on 2026-09-19 — and the
// first till to start collecting would have run them all out onto the pass.
// An hour still covers a till that was closed for a while mid-service.
const MAX_AGE_MS = 60 * 60_000;

export async function POST(req: NextRequest) {
  const { companyId, token, limit } = (await req.json()) as {
    companyId?: string;
    token?: string;
    limit?: number;
  };
  if (!companyId) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) {
    return Response.json({ ok: false, error: 'revoked' }, { status: 403 });
  }

  const db = createServerClient();

  await db.from('print_jobs')
    .update({ status: 'pending', claimed_at: null })
    .eq('company_id', companyId)
    .eq('status', 'printing')
    .lt('claimed_at', new Date(Date.now() - STALE_MS).toISOString());

  const { data: waiting, error: readError } = await db.from('print_jobs')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .gte('created_at', new Date(Date.now() - MAX_AGE_MS).toISOString())
    .order('created_at')
    .limit(Math.min(Math.max(limit ?? 10, 1), 10));
  if (readError) return Response.json({ ok: false, error: readError.message }, { status: 500 });
  if (!waiting?.length) return Response.json({ ok: true, jobs: [] });

  const { data: jobs, error } = await db.from('print_jobs')
    .update({ status: 'printing', claimed_at: new Date().toISOString() })
    .in('id', waiting.map(j => j.id))
    .eq('status', 'pending')
    .select('id, station_id, order_id, kind, payload, attempts, created_at');
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  // The update returns rows in no particular order; tickets must come out in
  // the order they were made.
  const sorted = (jobs ?? []).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
  return Response.json({ ok: true, jobs: sorted });
}
