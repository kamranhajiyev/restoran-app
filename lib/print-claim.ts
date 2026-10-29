// Claiming kitchen tickets without claim_print_jobs: for a till with only its
// terminal link (app/api/claim-print-jobs, server key), and for a browser till
// that collects only its USB sexes' tickets (lib/desktopPrint.ts, its session).
// claim_print_jobs cannot be told either the company or the sexes, and a
// migration is the wrong risk for this.
//
// The update claims only rows that are still pending, so two tills racing for a
// ticket cannot both win it.

import type { SupabaseClient } from '@supabase/supabase-js';

export const MAX_ATTEMPTS = 5;
// The same window requeue_stale_print_jobs uses: a till that claimed a ticket
// and died mid-print hands it back after this long.
const STALE_MS = 2 * 60_000;
// Only tickets made in the last hour. A till that never printed left hundreds
// behind — Test Restoran had 260 pending back to July on 2026-09-19 — and the
// first till to start collecting would have run them all out onto the pass.
// An hour still covers a till that was closed for a while mid-service.
const MAX_AGE_MS = 60 * 60_000;

export interface ClaimedRow {
  id: string;
  station_id: string | null;
  order_id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: string;
}

/**
 * Up to `limit` pending tickets, oldest first, marked as this caller's.
 * `stationIds` keeps to those sexes; a ticket for any other is left alone.
 */
export async function claimPending(
  db: SupabaseClient, companyId: string, limit: number, stationIds?: string[],
): Promise<{ jobs: ClaimedRow[]; status?: number } | { error: string; status?: number }> {
  let stale = db.from('print_jobs')
    .update({ status: 'pending', claimed_at: null })
    .eq('company_id', companyId)
    .eq('status', 'printing')
    .lt('claimed_at', new Date(Date.now() - STALE_MS).toISOString());
  if (stationIds) stale = stale.in('station_id', stationIds);
  await stale;

  let pending = db.from('print_jobs')
    .select('id')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .lt('attempts', MAX_ATTEMPTS)
    .gte('created_at', new Date(Date.now() - MAX_AGE_MS).toISOString());
  if (stationIds) pending = pending.in('station_id', stationIds);
  const { data: waiting, error: readError, status } = await pending
    .order('created_at')
    .limit(Math.min(Math.max(limit, 1), 10));
  if (readError) return { error: readError.message, status };
  if (!waiting?.length) return { jobs: [] };

  const { data: jobs, error } = await db.from('print_jobs')
    .update({ status: 'printing', claimed_at: new Date().toISOString() })
    .in('id', waiting.map(j => j.id as string))
    .eq('status', 'pending')
    .select('id, station_id, order_id, kind, payload, attempts, created_at');
  if (error) return { error: error.message };

  // The update returns rows in no particular order; tickets must come out in
  // the order they were made.
  return { jobs: ((jobs ?? []) as ClaimedRow[]).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at))) };
}
