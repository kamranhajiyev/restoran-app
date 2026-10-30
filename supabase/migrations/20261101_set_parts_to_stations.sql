-- A set's parts go to their own sexes (2026-10-29).
--
-- A set was one line at one sex: "Set 1 × 1" printed in the kitchen, and the
-- bar never heard about the ayran inside it. Now each part goes to the sex that
-- makes it, named with its size and its set:
--
-- Set 1 × 2 = Plov qulyaj + Ayran × 2
--   Mətbəx → Plov · qulyaj (Set 1) × 2
--   Bar    → Ayran (Set 1) × 4
--
-- prep_lines() is that rule, once, and every ticket below reads it instead of
-- menu_items.station_id. lib/stations.ts prepLines() is the same rule for the
-- till's own printing and the sex screens; the two must agree. A set whose
-- parts were all deleted since goes whole to its own sex, as before.
--
-- A till that prints a set itself prints at several sexes, and one
-- printed_station_id cannot say so; printed_station_ids lists them all, and a
-- sex in it gets its job recorded printed instead of queued.

alter table public.order_items
  add column if not exists printed_station_ids uuid[];

create or replace function public.prep_lines(
  p_company uuid, p_menu_item_id text, p_name text, p_qty integer, p_modifiers text
) returns table (station_id uuid, name text, qty integer, modifiers text)
language sql stable security definer set search_path to 'public'
as $function$
  with first_station as (
    select s.id from stations s
     where s.company_id = p_company
     order by s.position, s.created_at limit 1
  ), mi as (
    select m.station_id, m.set_items from menu_items m where m.id::text = p_menu_item_id
  ), parts as (
    select coalesce(pm.station_id, (select id from first_station)) as station_id,
           pm.name || coalesce(' · ' || v.name, '') || ' (' || p_name || ')' as name,
           p_qty * greatest(1, coalesce(round((p.part->>'qty')::numeric)::int, 1)) as qty
      from mi
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(mi.set_items) = 'array' then mi.set_items else '[]'::jsonb end) as p(part)
      join menu_items pm on pm.id::text = p.part->>'id'
      left join lateral (
        select x->>'name' as name
          from jsonb_array_elements(
            case when jsonb_typeof(pm.variants) = 'array' then pm.variants else '[]'::jsonb end) x
         where x->>'id' = p.part->>'variantId'
         limit 1) v on true
  )
  select parts.station_id, parts.name, parts.qty, p_modifiers
    from parts where parts.station_id is not null
  union all
  -- A dish, or a set with nothing left inside: the line itself at its own sex.
  -- A dish deleted since still goes to the first sex, as the triggers always did.
  select coalesce((select mi.station_id from mi), (select id from first_station)), p_name, p_qty, p_modifiers
   where not exists (select 1 from parts where parts.station_id is not null);
$function$;

-- Only the ticket triggers below call it, never a browser.
revoke execute on function public.prep_lines(uuid, text, text, integer, text) from public, anon, authenticated;

create or replace function public.enqueue_print_jobs_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload, status, printed_at)
  select o.company_id, st.id, o.id, k.kind,
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), k.kind),
         case when p.printed then 'printed' else 'pending' end,
         case when p.printed then now() end
    from new_rows n
    join public.orders o on o.id = n.order_id
    cross join lateral public.prep_lines(o.company_id, n.menu_item_id, n.menu_item_name, n.quantity, n.modifiers) pl
    join public.stations st on st.id = pl.station_id
    cross join lateral (select case when exists (
           select 1 from public.print_jobs pj
            where pj.order_id = o.id and pj.kind in ('new','append')
         ) then 'append' else 'new' end as kind) k
    cross join lateral (select coalesce(n.printed_station_id = st.id, false)
                            or st.id = any(coalesce(n.printed_station_ids, '{}')) as printed) p
   -- A row inserted already-removed is the ghost half of a partial removal.
   -- It is a cancellation, not new work — enqueue_print_jobs_ghost handles it.
   where n.removed_at is null
     and not n.no_print
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name, k.kind, p.printed;
  return null;
end $function$;

create or replace function public.enqueue_print_jobs_ghost()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- remove_order_items() queues its own, single slip for the batch.
  if current_setting('app.batch_removal', true) = 'on' then return null; end if;

  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, 'cancel',
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), 'cancel')
    from new_rows n
    join public.orders o on o.id = n.order_id
    cross join lateral public.prep_lines(o.company_id, n.menu_item_id, n.menu_item_name, n.quantity, n.modifiers) pl
    join public.stations st on st.id = pl.station_id
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
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), 'cancel')
    from new_rows n
    join old_rows prev on prev.id = n.id
    join public.orders o on o.id = n.order_id
    cross join lateral public.prep_lines(o.company_id, n.menu_item_id, n.menu_item_name, n.quantity, n.modifiers) pl
    join public.stations st on st.id = pl.station_id
   where prev.removed_at is null and n.removed_at is not null
     and not n.no_print
     -- Nothing was ever sent to the kitchen, so there is nothing to cancel.
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $function$;

create or replace function public.enqueue_print_jobs_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, 'cancel',
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), 'cancel')
    from old_rows d
    -- If the whole order row was deleted, this join finds nothing and no
    -- cancellation slip is queued — correct: the order no longer exists.
    join public.orders o on o.id = d.order_id
    cross join lateral public.prep_lines(o.company_id, d.menu_item_id, d.menu_item_name, d.quantity, d.modifiers) pl
    join public.stations st on st.id = pl.station_id
   where not d.no_print
     -- Nothing was ever sent to the kitchen, so there is nothing to cancel.
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $function$;

create or replace function public.enqueue_print_jobs_order_cancel()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select new.company_id, st.id, new.id, 'cancel',
         public.build_ticket(new, st.name, jsonb_agg(jsonb_build_object(
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), 'cancel')
    from public.order_items oi
    cross join lateral public.prep_lines(new.company_id, oi.menu_item_id, oi.menu_item_name, oi.quantity, oi.modifiers) pl
    join public.stations st on st.id = pl.station_id
   where oi.order_id = new.id
     and oi.removed_at is null
     and not oi.no_print
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = new.id and pj.kind in ('new','append'))
   group by st.id, st.name;
  return null;
end $function$;

create or replace function public.enqueue_print_jobs_table_move()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select new.company_id, st.id, new.id, 'move',
         public.build_ticket(new, st.name, jsonb_agg(jsonb_build_object(
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), 'move')
           || jsonb_build_object('fromTable', old.table_id)
    from public.order_items oi
    cross join lateral public.prep_lines(new.company_id, oi.menu_item_id, oi.menu_item_name, oi.quantity, oi.modifiers) pl
    join public.stations st on st.id = pl.station_id
   where oi.order_id = new.id
     and oi.removed_at is null
     and not oi.no_print
     -- Only stations that actually hold a ticket for this order need the notice.
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = new.id and pj.station_id = st.id and pj.kind in ('new','append'))
   group by st.id, st.name;
  return null;
end $function$;

-- Unchanged from 20261001_remove_order_items_batch.sql but for the slip at the
-- end, which now splits sets the same way.
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
           'name', pl.name, 'qty', pl.qty, 'modifiers', pl.modifiers
         ) order by pl.name), 'cancel')
    from jsonb_to_recordset(removed)
      as r(name text, qty int, modifiers text, "menuItemId" text, "noPrint" boolean)
    cross join lateral prep_lines(ord.company_id, r."menuItemId", r.name, r.qty, r.modifiers) pl
    join stations st on st.id = pl.station_id
   where not coalesce(r."noPrint", false)
     and exists (select 1 from print_jobs pj
                  where pj.order_id = ord.id and pj.kind in ('new','append'))
   group by st.id, st.name;
end $function$;

revoke all on function public.remove_order_items(text, jsonb, text, uuid) from public, anon;
grant execute on function public.remove_order_items(text, jsonb, text, uuid) to authenticated, service_role;
