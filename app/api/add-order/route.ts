// Creating an order, the same way every other write is made.
//
// This route is late. Every other thing a terminal does — appending a dish,
// changing a quantity, paying, cancelling, moving a table, opening a shift —
// has gone through a token-gated route on the server since the terminal link
// existed. Creating the order itself was the exception: it went straight to
// Supabase from the page, under the anon key baked into the build, and so was
// the one write whose success depended on that key being right and on RLS
// letting an unauthenticated terminal insert.
//
// On a developer's machine both are true and nothing looks wrong. On a till
// built by CI they need not be, and then the sale is refused, the queue drops
// it, and every write behind it — the payment above all — arrives at a server
// that has never heard of the order and answers ok:false. Which is exactly what
// happened: three payments applied against nothing, and a green badge.
//
// So order creation joins the others. No key on the client, no RLS on the path,
// and one idempotency claim so a replayed sale is not a second sale.

import { NextRequest } from 'next/server';
import { createServerClient, verifySellerToken } from '@/lib/supabase-server';
import { claim, idempotencyKey } from '@/lib/idempotency';
import type { Order } from '@/types';

export async function POST(req: NextRequest) {
  const { order, companyId, token, keepOrderNumber } = (await req.json()) as {
    order?: Order;
    companyId?: string;
    token?: string;
    keepOrderNumber?: boolean;
  };
  if (!order?.id || !companyId) return Response.json({ ok: false }, { status: 400 });
  if (!(await verifySellerToken(companyId, token ?? ''))) {
    return Response.json({ ok: false, error: 'revoked' }, { status: 403 });
  }

  const db = createServerClient();

  // Repeatable: the order carries the till's own id and the insert below forgives
  // a duplicate key, and every line carries an id the till minted, so the upsert
  // lands the same rows a second time rather than a second set of them. That is
  // what lets a half-finished attempt be done properly instead of answered with
  // a success it never earned — see lib/idempotency.ts.
  const held = await claim(db, idempotencyKey(req), companyId, 'add-order', { repeatable: true });
  if (held.applied) return Response.json(held.result);

  const insertOrder = (keepNumber: boolean) => db.from('orders').insert({
    id: order.id,
    // Absent on every other path, where the assign_order_number trigger fills it
    // in. Supplied, the trigger keeps it and moves the counter past it — the
    // desktop till numbered this order from its own database and has already
    // printed the number on a bill.
    ...(keepNumber && order.orderNumber ? { order_number: order.orderNumber } : {}),
    // Travels with the number it qualifies, and only then: an order the server
    // numbered belongs to no till and must stay null.
    ...(keepNumber && order.tillNumber ? { till_number: order.tillNumber } : {}),
    table_id: order.tableNumber === 0 ? null : order.tableNumber,
    waiter_name: order.sellerName,
    staff_id: order.staffId ?? null,
    courier_id: order.courierId ?? null,
    online: order.online ?? false,
    status: order.status,
    note: order.note ?? null,
    created_at: order.createdAt,
    company_id: companyId,
  });

  let { error: orderError } = await insertOrder(!!keepOrderNumber);

  // The till's number was already taken — another device handed out the same
  // one while this till could not see it (orders_company_order_number_unique).
  // This is a new order, not a replay, and it said "duplicate key" too: taken for
  // one, it skipped the insert and failed on the lines of an order that did not
  // exist, and the till kept it at the head of its queue for good — Test
  // Restoran, №3436, 2026-09-19, with every sale after it stuck behind. Let the
  // server number it instead; a relabelled order beats one that never arrives.
  if (orderError && /order_number/i.test(orderError.message)) {
    ({ error: orderError } = await insertOrder(false));
  }

  // The till's own id is the primary key, so a replay that already landed trips
  // this — the same answer as success, and the queue must be allowed to move on.
  if (orderError && !/duplicate key|already exists/i.test(orderError.message)) {
    // Hand the key back before answering. Holding it would leave the next
    // attempt at this order being told it had already been applied.
    await held.release();
    return Response.json({ ok: false, error: orderError.message }, { status: 500 });
  }

  const items = order.items ?? [];
  if (items.length > 0) {
    const rows = items.map(oi => ({
      // The till named its own lines before Supabase heard of them, and has been
      // referring to them by those names since — "remove one Cola" carries the
      // id it minted. Server-generated ids here would orphan every such edit.
      ...(oi.id ? { id: String(oi.id) } : {}),
      order_id: order.id,
      menu_item_id: String(oi.menuItem.id),
      menu_item_name: String(oi.menuItem.name),
      // Already includes every selected modifier's price.
      menu_item_price: Number(oi.menuItem.price),
      quantity: Number(oi.quantity),
      modifiers: oi.modifiers ?? null,
      modifiers_detail: oi.modifiersDetail ?? null,
      variant_id: oi.variantId ?? null,
    }));
    const { error: itemsError } = await db.from('order_items').upsert(rows, { onConflict: 'id' });
    if (itemsError) {
      await held.release();
      return Response.json({ ok: false, error: itemsError.message }, { status: 500 });
    }
  }

  const result = { ok: true };
  await held.commit(result);
  return Response.json(result);
}
