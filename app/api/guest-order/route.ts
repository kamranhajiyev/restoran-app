// Orders from the QR menu. No login and no till link: the guest is anyone, so
// everything but what they picked is decided here (lib/guest-order).

import { NextRequest } from 'next/server';
import { createServerClient } from '@/lib/supabase-server';
import { guestOrderType, priceGuestLines, type GuestLine, type MenuRow } from '@/lib/guest-order';
import { cleanOrderTypes, orderTypeColumns, orderTypeFields } from '@/lib/order-types';
import { chargeFor, cleanServiceCharge, serviceChargeColumn } from '@/lib/service-charge';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const COMPANY_COLUMNS = 'id, qr_enabled, menu_only, tables_enabled, delivery_enabled, service_charge, order_types';

type CompanyRow = { tables_enabled: boolean | null; delivery_enabled: boolean | null; order_types: unknown };

function typeFor(company: CompanyRow, typeId: unknown, hasTable: boolean) {
  return guestOrderType(cleanOrderTypes(company.order_types), typeof typeId === 'string' ? typeId : null, hasTable, {
    tablesOn: company.tables_enabled !== false, deliveryOn: company.delivery_enabled !== false,
  });
}

// The QR menu asks which type its link is for, to show that type's prices.
// Only the one type goes back: its name and its price change, which the menu
// shows anyway.
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const companyId = q.get('companyId');
  if (!companyId || !UUID.test(companyId)) return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  const { data: company, error } = await createServerClient().from('companies')
    .select(COMPANY_COLUMNS)
    .eq('id', companyId).eq('active', true).is('trashed_at', null).maybeSingle();
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  if (!company) return Response.json({ ok: false, error: 'closed' }, { status: 403 });
  const t = typeFor(company, q.get('type'), !!q.get('table'));
  if ('error' in t) return Response.json({ ok: false, error: t.error }, { status: 400 });
  return Response.json({ ok: true, type: { id: t.id, name: t.name, builtIn: t.builtIn ?? null, change: t.change } });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as {
    id?: string; companyId?: string; tableId?: number | null; type?: string | null; note?: string; lines?: GuestLine[];
  } | null;
  if (!body?.id || !UUID.test(body.id) || !body.companyId || !UUID.test(body.companyId)) {
    return Response.json({ ok: false, error: 'bad_request' }, { status: 400 });
  }
  const db = createServerClient();

  const { data: company, error: companyError } = await db.from('companies')
    .select(COMPANY_COLUMNS)
    .eq('id', body.companyId).eq('active', true).is('trashed_at', null).maybeSingle();
  if (companyError) return Response.json({ ok: false, error: companyError.message }, { status: 500 });
  // Same rule as the menu page: a menu-only shop takes no orders.
  if (!company || !company.qr_enabled || company.menu_only) return Response.json({ ok: false, error: 'closed' }, { status: 403 });

  const tableId = body.tableId ? Number(body.tableId) : null;
  if (tableId) {
    if (!company.tables_enabled) return Response.json({ ok: false, error: 'closed' }, { status: 403 });
    const { data: table } = await db.from('restaurant_tables').select('id')
      .eq('company_id', company.id).eq('id', tableId).maybeSingle();
    if (!table) return Response.json({ ok: false, error: 'bad_table' }, { status: 400 });
  }
  const orderType = typeFor(company, body.type, !!tableId);
  if ('error' in orderType) return Response.json({ ok: false, error: orderType.error }, { status: 400 });

  const ids = [...new Set((body.lines ?? []).map(l => String(l?.menuItemId)))].filter(id => UUID.test(id));
  const { data: menu, error: menuError } = await db.from('menu_items')
    .select('id, name, price, available, qr_visible, variants')
    .eq('company_id', company.id).in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  if (menuError) return Response.json({ ok: false, error: menuError.message }, { status: 500 });
  const lines = priceGuestLines(body.lines ?? [], (menu ?? []) as MenuRow[], orderType.change);
  if ('error' in lines) return Response.json({ ok: false, error: lines.error }, { status: 400 });

  const { error: orderError } = await db.from('orders').insert({
    id: body.id,
    company_id: company.id,
    table_id: tableId,
    online: !tableId,
    waiter_name: 'Müştəri',
    status: 'gözləyir',
    note: String(body.note ?? '').slice(0, 500) || null,
    created_at: new Date().toISOString(),
    // Saved under its type like a till order, so the kitchen ticket and the
    // reports name it.
    ...orderTypeColumns(orderTypeFields(orderType)),
    // Xidmət haqqı like any order of its kind.
    ...serviceChargeColumn({ serviceChargePercent: chargeFor(cleanServiceCharge(company.service_charge), orderType.id) }),
  });
  if (orderError) {
    // Sent twice — the first one landed.
    if (/duplicate key/i.test(orderError.message)) return Response.json({ ok: true });
    return Response.json({ ok: false, error: orderError.message }, { status: 500 });
  }
  const { error: itemsError } = await db.from('order_items').insert(lines.map(l => ({ ...l, order_id: body.id })));
  if (itemsError) {
    // No dishes, no order: an empty one would sit on the till as a ghost.
    await db.from('orders').delete().eq('id', body.id);
    return Response.json({ ok: false, error: itemsError.message }, { status: 500 });
  }
  return Response.json({ ok: true });
}
