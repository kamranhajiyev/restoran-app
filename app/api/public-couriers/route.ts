import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { refuseTillRead } from '@/lib/till-read-auth';
import { courierBalances, courierPending } from '@/lib/courier-pending';
import { readAll } from '@/lib/read-all';

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
  const refused = await refuseTillRead(req, companyId);
  if (refused) return refused;

  const db = createServerClient();
  const [couriers, orders, payments] = await Promise.all([
    db.from('couriers').select('id, name, phone, active, staff_id, created_at, deleted_at')
      .eq('company_id', companyId).order('created_at'),
    // 'ödənilib' only: a returned order stops owing the moment it is cancelled.
    readAll(async (a, b) => db.from('orders').select('id, order_number, created_at, courier_id, courier_debt, courier_cash, courier_card')
      .eq('company_id', companyId).eq('status', 'ödənilib').not('courier_id', 'is', null).order('id').range(a, b)),
    readAll(async (a, b) => db.from('courier_payments').select('courier_id, amount')
      .eq('company_id', companyId).order('id').range(a, b)),
  ]);

  if (couriers.error) return Response.json({ couriers: [] });
  // A 500, not half the money: deliveries without payments (or the other way)
  // would show every rider's debt wrong, and the exe would keep it as its
  // snapshot. On an error the till keeps the list it has (lib/keep-on-fail).
  if (!orders || !payments) return Response.json({ error: 'read failed' }, { status: 500 });

  const balance = courierBalances(orders, payments);
  const pending = courierPending(orders);

  return Response.json({
    couriers: (couriers.data ?? []).map(c => ({
      id: c.id,
      name: c.name,
      phone: c.phone ?? undefined,
      active: c.active,
      staffId: c.staff_id ?? undefined,
      createdAt: c.created_at,
      deletedAt: c.deleted_at ?? undefined,
      outstanding: balance[c.id] ?? 0,
      pending: pending[c.id] ?? [],
    })),
  });
}
