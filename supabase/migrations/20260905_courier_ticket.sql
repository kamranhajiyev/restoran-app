-- The kitchen ticket for a courier order said "Takeaway".
--
-- Every ticket this system prints — new, append, cancel, move — is built by
-- build_ticket, and it has only ever known about tables. A courier order carries
-- no table_id, so it fell through to the same null the counter-collect orders
-- use, and the renderers print "Takeaway" for that. The cook plates the food and
-- leaves it under the pass for a guest who is not coming, while the rider stands
-- at the counter waiting for an order that looks, from the kitchen, like it has
-- already been dealt with.
--
-- Adding the name here rather than at each of the four call sites: they all go
-- through this one function, and a fifth kind added later gets it for free.
create or replace function public.build_ticket(o orders, station_name text, item_rows jsonb, job_kind text)
returns jsonb
language sql
stable
as $function$
  select jsonb_build_object(
    'kind',        job_kind,
    'station',     station_name,
    'orderNumber', o.order_number,
    'table',       o.table_id,
    'courier',     (select c.name from public.couriers c where c.id = o.courier_id),
    'waiter',      o.waiter_name,
    'note',        o.note,
    'at',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items',       item_rows
  );
$function$;
