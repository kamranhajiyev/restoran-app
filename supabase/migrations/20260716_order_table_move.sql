-- An open order can move to another table: a party changes seats, or the order was
-- rung up on the wrong one. Only `orders.table_id` changes — the order number, the
-- items and the kitchen's place in the queue all stay put. Table occupancy is never
-- stored (both floor plans derive "busy" by scanning open orders), so the old table
-- frees itself and the new one lights up with no other write.
--
-- The danger is the kitchen. A ticket freezes the table into its payload at print
-- time, so the slips already hanging at the stations still name the old table.
-- Moving an order silently would send the food where the party no longer is — the
-- exact mistake the move is meant to undo.

-- 'move' is a kind of ticket. Without this the trigger below fails the check
-- constraint and takes the whole move down with it.
alter table public.print_jobs drop constraint if exists print_jobs_kind_check;
alter table public.print_jobs add constraint print_jobs_kind_check
  check (kind = any (array['new'::text, 'append'::text, 'cancel'::text, 'move'::text]));

-- The notice slip. Modelled on enqueue_print_jobs_order_cancel, with one
-- difference: rather than that function's global exists(...) check, print_jobs is
-- joined per station, so only stations actually holding a ticket for this order are
-- told. A station that never saw the order has nothing to correct.
--
-- `fromTable` is merged in after build_ticket: the old table is the whole point of
-- the slip, and it's the one thing the order row no longer knows.
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
    join public.print_jobs pj
      on pj.order_id = new.id and pj.station_id = st.id and pj.kind in ('new','append')
   where oi.order_id = new.id
     and oi.removed_at is null
   group by st.id, st.name;
  return null;
end $function$;

drop trigger if exists orders_enqueue_table_move on public.orders;
create trigger orders_enqueue_table_move
  after update of table_id on public.orders
  for each row
  when (new.table_id is distinct from old.table_id)
  execute function public.enqueue_print_jobs_table_move();
