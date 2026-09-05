import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';

// Public: the courier list plus what each one is holding, for the seller
// terminal, which has no Supabase auth session of its own.
//
// The balance is computed here rather than left to the caller because the till
// keeps only a window of recent orders — a debt older than that window has
// nothing local to derive it from. See getCouriers in electron/till-repo.ts for
// how the till carries this number forward through an outage.
export async function GET(req: NextRequest) {
  const companyId = req.nextUrl.searchParams.get('companyId');
  if (!companyId) return Response.json({ error: 'missing companyId' }, { status: 400 });

  const db = createServerClient();
  const [couriers, orders, payments] = await Promise.all([
    db.from('couriers').select('id, name, phone, active, staff_id, created_at')
      .eq('company_id', companyId).order('created_at'),
    // 'ödənilib' only: a returned order stops owing the moment it is cancelled.
    db.from('orders').select('courier_id, courier_debt')
      .eq('company_id', companyId).eq('status', 'ödənilib').not('courier_id', 'is', null),
    db.from('courier_payments').select('courier_id, amount').eq('company_id', companyId),
  ]);

  if (couriers.error) return Response.json({ couriers: [] });

  const balance: Record<string, number> = {};
  for (const o of orders.data ?? []) {
    if (!o.courier_id) continue;
    balance[o.courier_id] = (balance[o.courier_id] ?? 0) + Number(o.courier_debt ?? 0);
  }
  for (const p of payments.data ?? []) {
    if (!p.courier_id) continue;
    balance[p.courier_id] = (balance[p.courier_id] ?? 0) - Number(p.amount ?? 0);
  }

  return Response.json({
    couriers: (couriers.data ?? []).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? undefined,
      active: c.active,
      staffId: c.staff_id ?? undefined,
      createdAt: c.created_at,
      outstanding: balance[c.id] ?? 0,
    })),
  });
}
