import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// Which sexes have finished their part, for the tokenless terminal. Without this the
// green never reaches the till most venues actually use — RLS gives a session-less
// client nothing.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ ready: [] }, { status: 400 });

  const db = createServerClient();
  const { data, error } = await db
    .from('order_station_ready')
    .select('order_id, station_id, ready_at, ready_by')
    .eq('company_id', companyId)
    // Bounded like /api/public-orders' 200-row window: an open order is recent, and
    // an unbounded read grows forever on a busy venue.
    .order('ready_at', { ascending: false })
    .limit(500);

  if (error) return Response.json({ ready: [] }, { status: 500 });

  return Response.json({
    ready: (data ?? []).map(r => ({
      orderId: r.order_id,
      stationId: r.station_id,
      readyAt: r.ready_at,
      readyBy: r.ready_by ?? null,
    })),
  });
}
