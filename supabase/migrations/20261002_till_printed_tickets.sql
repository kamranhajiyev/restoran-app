-- The desktop till prints its own kitchen tickets now, straight to the LAN
-- printer, the moment "Sifariş ver" is pressed. Going through print_jobs first
-- cost 5-10 seconds a ticket: the order had to reach Supabase, the trigger had
-- to fire, and the till had to hear about it and claim it back.
--
-- The job row is still written, because everything after it depends on one
-- existing: the cancel, ghost and move triggers only send a slip to a station
-- that already holds a 'new' or 'append' ticket for the order. It is written
-- already printed, so nobody claims it a second time.
--
-- printed_station_id names the station the till actually printed to, rather
-- than being a plain flag. If the till and the server ever resolve a dish to
-- different stations, the server's station has not had the ticket, and it gets
-- one the usual way — a duplicate in the wrong place beats a dish nobody cooks.

alter table public.order_items
  add column if not exists printed_station_id uuid;

create or replace function public.enqueue_print_jobs_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload, status, printed_at)
  select o.company_id, st.id, o.id, k.kind,
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', n.menu_item_name, 'qty', n.quantity, 'modifiers', n.modifiers
         ) order by n.menu_item_name), k.kind),
         case when p.printed then 'printed' else 'pending' end,
         case when p.printed then now() end
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
    cross join lateral (select coalesce(n.printed_station_id = st.id, false) as printed) p
   -- A row inserted already-removed is the ghost half of a partial removal.
   -- It is a cancellation, not new work — enqueue_print_jobs_ghost handles it.
   where n.removed_at is null
     and not n.no_print
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name, k.kind, p.printed;
  return null;
end $function$;
