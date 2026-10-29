// Kitchen tickets for a till that has no login — only its terminal link.
//
// claim_print_jobs works out the company from the signed-in user, so a till
// opened with a link and nobody signed in got nothing back, and its sexes never
// printed: the jobs sat in print_jobs with the IP set and nobody to carry them.
// This is the same claim, gated on the link's token instead of a session.
//
// The claim itself is lib/print-claim.ts. `stationIds` is a browser till that
// prints only its USB sexes and must leave the rest to the exe.

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claimPending } from '@/lib/print-claim';

export async function POST(req: NextRequest) {
  const { companyId, token, limit, stationIds } = (await req.json()) as {
    companyId?: string;
    token?: string;
    limit?: number;
    stationIds?: unknown;
  };
  if (!companyId) return Response.json({ ok: false }, { status: 400 });
  if (stationIds !== undefined && !(Array.isArray(stationIds) && stationIds.every(id => typeof id === 'string'))) {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) {
    return Response.json({ ok: false, error: 'revoked' }, { status: 403 });
  }

  const db = createServerClient();
  const res = await claimPending(db, companyId, limit ?? 10, stationIds as string[] | undefined);
  if ('error' in res) return Response.json({ ok: false, error: res.error }, { status: 500 });
  return Response.json({ ok: true, jobs: await withDelivery(db, companyId, res.jobs) });
}

type Job = { order_id: string | null; payload: Record<string, unknown> | null };

/**
 * The database's tickets name the table and nothing else, so a delivery —
 * a guest's order from the menu link, or one handed to a rider — printed as
 * "Takeaway" and the food went to the counter (Latte Art, 2026-10-05). Added
 * here, at hand-out, so the tickets need no new trigger.
 */
async function withDelivery<T extends Job>(db: ReturnType<typeof createServerClient>, companyId: string, jobs: T[]): Promise<T[]> {
  const ids = [...new Set(jobs.map(j => j.order_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return jobs;
  const { data: orders } = await db.from('orders')
    .select('id, online, courier_id').eq('company_id', companyId).in('id', ids);
  const courierIds = [...new Set((orders ?? []).map(o => o.courier_id).filter((id): id is string => !!id))];
  const { data: couriers } = courierIds.length
    ? await db.from('couriers').select('id, name').eq('company_id', companyId).in('id', courierIds)
    : { data: [] as { id: string; name: string }[] };
  return jobs.map(j => {
    const o = (orders ?? []).find(r => r.id === j.order_id);
    if (!o || !j.payload) return j;
    const courier = (couriers ?? []).find(c => c.id === o.courier_id)?.name ?? null;
    return { ...j, payload: { ...j.payload, online: o.online === true, courier: j.payload.courier ?? courier } };
  });
}
