-- The seller can untick "Mətbəxə çap et" before pressing Sifariş ver — for the
-- drink the waiter pours at the counter, or an order the kitchen already has on
-- paper. The flag lives on the line rather than the order so that an append can
-- go either way independently of what the order was opened with.
--
-- Every trigger below reads it the same way: a line the kitchen never got a
-- ticket for gets no cancel, ghost or move notice either, or the cook would be
-- handed a slip about a dish nobody asked them to make.

alter table public.order_items
  add column if not exists no_print boolean not null default false;

create or replace function public.enqueue_print_jobs_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, k.kind,
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', n.menu_item_name, 'qty', n.quantity, 'modifiers', n.modifiers
         ) order by n.menu_item_name), k.kind)
    from new_rows n
    join public.orders o on o.id = n.order_id
    left join public.menu_items mi on mi.id::text = n.menu_item_id
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = o.company_id
            order by s2.position, s2.created_at limit 1))
    cross join lateral (select case when exists (
           select 1 from public.print_jobs pj
            where pj.order_id = o.id and pj.kind in ('new','append')
         ) then 'append' else 'new' end as kind) k
   -- A row inserted already-removed is the ghost half of a partial removal.
   -- It is a cancellation, not new work — enqueue_print_jobs_ghost handles it.
   where n.removed_at is null
     and not n.no_print
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name, k.kind;
  return null;
end $function$;

create or replace function public.enqueue_print_jobs_ghost()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
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

create or replace function public.enqueue_print_jobs_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, 'cancel',
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', d.menu_item_name, 'qty', d.quantity, 'modifiers', d.modifiers
         ) order by d.menu_item_name), 'cancel')
    from old_rows d
    -- If the whole order row was deleted, this join finds nothing and no
    -- cancellation slip is queued — correct: the order no longer exists.
    join public.orders o on o.id = d.order_id
    left join public.menu_items mi on mi.id::text = d.menu_item_id
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = o.company_id
            order by s2.position, s2.created_at limit 1))
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
           'name', oi.menu_item_name, 'qty', oi.quantity, 'modifiers', oi.modifiers
         ) order by oi.menu_item_name), 'cancel')
    from public.order_items oi
    left join public.menu_items mi on mi.id::text = oi.menu_item_id
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = new.company_id
            order by s2.position, s2.created_at limit 1))
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
           'name', oi.menu_item_name, 'qty', oi.quantity, 'modifiers', oi.modifiers
         ) order by oi.menu_item_name), 'move')
           || jsonb_build_object('fromTable', old.table_id)
    from public.order_items oi
    left join public.menu_items mi on mi.id::text = oi.menu_item_id
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = new.company_id
            order by s2.position, s2.created_at limit 1))
    -- Only stations that actually hold a ticket for this order need the notice.
    join public.print_jobs pj
      on pj.order_id = new.id and pj.station_id = st.id and pj.kind in ('new','append')
   where oi.order_id = new.id
     and oi.removed_at is null
     and not oi.no_print
   group by st.id, st.name;
  return null;
end $function$;
