// What happened to a kitchen ticket a linked till claimed through
// /api/claim-print-jobs: printed, back in the queue, or given up on. The same
// writes lib/desktopPrint.ts makes under a session, gated on the link's token
// and on the ticket belonging to that company.

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';

type Outcome =
  | { result: 'printed' }
  | { result: 'release' }
  | { result: 'failed'; attempts: number; error: string; giveUp: boolean };

export async function POST(req: NextRequest) {
  const { companyId, token, id, outcome } = (await req.json()) as {
    companyId?: string;
    token?: string;
    id?: string;
    outcome?: Outcome;
  };
  if (!companyId || !id || !outcome) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) {
    return Response.json({ ok: false, error: 'revoked' }, { status: 403 });
  }

  const patch =
    outcome.result === 'printed'
      ? { status: 'printed', printed_at: new Date().toISOString(), error: null }
      : outcome.result === 'release'
        ? { status: 'pending', claimed_at: null }
        : {
            status: outcome.giveUp ? 'failed' : 'pending',
            claimed_at: null,
            attempts: Number(outcome.attempts) || 0,
            error: String(outcome.error ?? '').slice(0, 500),
          };

  const db = createServerClient();
  const { error } = await db.from('print_jobs')
    .update(patch)
    .eq('id', id)
    .eq('company_id', companyId);
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  return Response.json({ ok: true });
}
