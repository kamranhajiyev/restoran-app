-- Removing several lines at once prints one LƏĞV slip, not one per line.
--
-- "Silinməni əlavə et (3)" used to send three requests — one per line — and
-- every one of them was its own statement, so the statement-level triggers on
-- order_items queued three cancel jobs: three slips at the bar for what the
-- waiter did in one press. Test Restoran №3499, 2026-10-01: Fanta, Cola and Su
-- taken off together came out as three tickets two seconds apart.
--
-- remove_order_items() applies the whole batch in one transaction and queues the
-- cancel itself, one job per station, listing every line it took off there. The
-- per-line triggers stand down while it runs (app.batch_removal), or each of its
-- statements would queue a slip of its own on top.
--
-- It is idempotent on purpose: a line already at (or below) its target quantity,
-- or already removed, is skipped, and a ghost row carries the id the till gave
-- it. A replayed batch therefore changes nothing and prints nothing.

create or replace function public.enqueue_print_jobs_ghost()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- remove_order_items() queues its own, single slip for the batch.
  if current_setting('app.batch_removal', true) = 'on' then return null; end if;

  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, 'cancel',
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', n.menu_item_name, 'qty', n.quantity, 'modifiers', n.modifiers
         ) order by n.menu_item_name), 'cancel')
    from new_rows n
    join public.orders o on o.id = n.order_id
    left join public.menu_items mi on mi.id::text = n.menu_item_id
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = o.company_id
            order by s2.position, s2.created_at limit 1))
   where n.removed_at is not null
     and not n.no_print
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $function$;

create or replace function public.enqueue_print_jobs_removed()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- remove_order_items() queues its own, single slip for the batch.
  if current_setting('app.batch_removal', true) = 'on' then return null; end if;

  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, 'cancel',
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', n.menu_item_name, 'qty', n.quantity, 'modifiers', n.modifiers
         ) order by n.menu_item_name), 'cancel')
    from new_rows n
    join old_rows prev on prev.id = n.id
    join public.orders o on o.id = n.order_id
    left join public.menu_items mi on mi.id::text = n.menu_item_id
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = o.company_id
            order by s2.position, s2.created_at limit 1))
   where prev.removed_at is null and n.removed_at is not null
     and not n.no_print
     -- Nothing was ever sent to the kitchen, so there is nothing to cancel.
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $function$;

-- p_lines: [{ "id": <order_items.id>, "quantity": <what the line drops to>, "ghostId": <uuid, optional> }]
-- A quantity of 0 removes the whole line; anything lower than the line's current
-- quantity takes off the difference as a ghost row, exactly as
-- /api/update-order-item-qty does. Increases are ignored — this only removes.
create or replace function public.remove_order_items(
  p_order_id text,
  p_lines    jsonb,
  p_by       text default null,
  p_company  uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ord     public.orders%rowtype;
  cid     uuid;
  who     text := coalesce(nullif(p_by, ''), 'Satıcı');
  ts      timestamptz := now();
  ln      record;
  cur     public.order_items%rowtype;
  removed jsonb := '[]'::jsonb;
begin
  -- The server route calls this with the service key and names the company it
  -- has already checked the terminal token against. Anyone else is scoped to
  -- their own session's company, whatever they pass.
  cid := case when auth.role() = 'service_role' then p_company else get_my_company_id() end;
  if cid is null then raise exception 'not_allowed'; end if;

  select * into ord from orders where id = p_order_id and company_id = cid for update;
  if ord.id is null then raise exception 'not_found'; end if;
  if ord.status in ('ödənilib', 'ləğv edildi', 'silinib') then raise exception 'closed'; end if;

  perform set_config('app.batch_removal', 'on', true);

  for ln in
    select * from jsonb_to_recordset(coalesce(p_lines, '[]'::jsonb))
      as x(id uuid, quantity int, "ghostId" uuid)
  loop
    select * into cur from order_items
     where id = ln.id and order_id = p_order_id and removed_at is null
     for update;
    if cur.id is null then continue; end if;

    if coalesce(ln.quantity, 0) <= 0 then
      update order_items set removed_at = ts, removed_by = who where id = cur.id;
      removed := removed || jsonb_build_object(
        'name', cur.menu_item_name, 'qty', cur.quantity, 'modifiers', cur.modifiers,
        'menuItemId', cur.menu_item_id, 'noPrint', cur.no_print);
    elsif ln.quantity < cur.quantity then
      update order_items set quantity = ln.quantity where id = cur.id;
      insert into order_items (id, order_id, menu_item_id, menu_item_name, menu_item_price,
                               modifiers, modifiers_detail, variant_id, no_print,
                               quantity, removed_at, removed_by)
      values (coalesce(ln."ghostId", gen_random_uuid()), p_order_id, cur.menu_item_id,
              cur.menu_item_name, cur.menu_item_price, cur.modifiers, cur.modifiers_detail,
              cur.variant_id, cur.no_print, cur.quantity - ln.quantity, ts, who)
      on conflict (id) do nothing;
      removed := removed || jsonb_build_object(
        'name', cur.menu_item_name, 'qty', cur.quantity - ln.quantity, 'modifiers', cur.modifiers,
        'menuItemId', cur.menu_item_id, 'noPrint', cur.no_print);
    end if;
    cur := null;
  end loop;

  perform set_config('app.batch_removal', 'off', true);

  -- One slip per station, holding everything taken off there. Same rules as the
  -- triggers: nothing for a line the kitchen never got, nothing for an order the
  -- kitchen never saw.
  insert into print_jobs (company_id, station_id, order_id, kind, payload)
  select ord.company_id, st.id, ord.id, 'cancel',
         build_ticket(ord, st.name, jsonb_agg(jsonb_build_object(
           'name', r.name, 'qty', r.qty, 'modifiers', r.modifiers
         ) order by r.name), 'cancel')
    from jsonb_to_recordset(removed)
      as r(name text, qty int, modifiers text, "menuItemId" text, "noPrint" boolean)
    left join menu_items mi on mi.id::text = r."menuItemId"
    join stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from stations s2
            where s2.company_id = ord.company_id
            order by s2.position, s2.created_at limit 1))
   where not coalesce(r."noPrint", false)
     and exists (select 1 from print_jobs pj
                  where pj.order_id = ord.id and pj.kind in ('new','append'))
   group by st.id, st.name;
end $function$;

revoke all on function public.remove_order_items(text, jsonb, text, uuid) from public, anon;
grant execute on function public.remove_order_items(text, jsonb, text, uuid) to authenticated, service_role;
