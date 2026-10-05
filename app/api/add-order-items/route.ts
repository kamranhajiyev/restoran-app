import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';
import { printedStationColumn, printedStationList } from '@/lib/stations';
import type { SelectedModifier } from '@/types';
import { refusal } from '@/lib/order-rules';

interface IncomingItem {
  // The desktop till names its own lines so it can edit them during an outage;
  // honouring the id here is what makes those edits still mean something when
  // the append finally replays. Absent from every other caller, where the
  // column default mints one.
  id?: string;
  // price already includes every selected modifier — the client folds them in.
  menuItem: { id: string | number; name: string; price: number };
  quantity: number;
  modifiers?: string;
  modifiersDetail?: SelectedModifier[];
  variantId?: string;
  noPrint?: boolean;
  printedStationId?: string;
}

export async function POST(req: NextRequest) {
  const { orderId, items, companyId, note, token, noteTicket } = (await req.json()) as {
    orderId?: string;
    items?: IncomingItem[];
    companyId?: string;
    note?: string;
    token?: string;
    // Set when the note was the whole edit: the kitchen gets a QEYD slip.
    // `printed` lists the stations the desktop till already printed it at.
    noteTicket?: { printed?: string[] };
  };
  // No items is allowed only when the note is the point of the call: the edit
  // screen saves a changed note before its removals, so the LƏĞV slip the
  // removal trigger prints carries the new note rather than the old one.
  if (!orderId || !companyId || !Array.isArray(items) || (items.length === 0 && typeof note !== 'string')) {
    return Response.json({ ok: false }, { status: 400 });
  }
  if (!(await verifySellerToken(companyId, token ?? ''))) return Response.json({ ok: false, error: 'revoked' }, { status: 403 });

  const db = createServerClient();

  // Replaying a queued append would put the same dishes on the bill twice.
  const held = await claim(db, idempotencyKey(req), companyId, 'add-order-items');
  if (held.applied) return Response.json(held.result);

  // Only allow appending to an order that belongs to this company and is still open.
  const { data: order, error: orderErr } = await db
    .from('orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('company_id', companyId)
    .single();
  if (orderErr || !order) return Response.json({ ok: false }, { status: 404 });
  if (refusal('edit', order)) {
    return Response.json({ ok: false, error: 'closed' }, { status: 409 });
  }

  const rows = items.map(oi => ({
    ...(oi.id ? { id: String(oi.id) } : {}),
    order_id: orderId,
    menu_item_id: String(oi.menuItem.id),
    menu_item_name: String(oi.menuItem.name),
    menu_item_price: Number(oi.menuItem.price),
    quantity: Number(oi.quantity),
    modifiers: oi.modifiers ?? null,
    modifiers_detail: oi.modifiersDetail ?? null,
    variant_id: oi.variantId ?? null,
    no_print: oi.noPrint ?? false,
    // Already printed by the desktop till: the trigger records it, it does not queue it.
    printed_station_id: printedStationColumn(oi.printedStationId),
  }));

  if (rows.length > 0) {
    const { error } = await db.from('order_items').insert(rows);
    if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  }

  if (note !== undefined) {
    const { error: noteError } = await db.from('orders').update({ note: note || null }).eq('id', orderId).eq('company_id', companyId);
    if (noteError) return Response.json({ ok: false, error: noteError.message }, { status: 500 });
  }

  // After the note is saved: the slip is built from the order row.
  if (noteTicket && rows.length === 0) {
    const { error: ticketError } = await db.rpc('enqueue_note_ticket', {
      p_order_id: orderId, p_printed: printedStationList(noteTicket.printed),
    });
    if (ticketError) return Response.json({ ok: false, error: ticketError.message }, { status: 500 });
  }
  await held.commit({ ok: true });
  return Response.json({ ok: true });
}
