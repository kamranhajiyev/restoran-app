-- The "MASA DƏYİŞDİ" slip becomes the owner's choice (2026-10-31).
--
-- Moving an open order to another table printed a notice at every station that
-- already held its ticket, always. Some restaurants don't want the paper: the
-- waiter tells the kitchen, or the food is carried by the same person who moved
-- the party. Off skips only the slip; the order still moves.
--
-- Default true: every restaurant keeps the slip until its owner turns it off.
-- One check inside the trigger covers the browser till, the exe and the APK,
-- since all three print station tickets from print_jobs.

alter table public.companies
  add column if not exists print_table_move boolean not null default true;
-- companies is read column by column (20261008_hide_seller_token.sql).
grant select (print_table_move) on public.companies to authenticated;

-- Owners write companies through functions, like set_service_charge.
create or replace function public.set_print_table_move(enabled boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  update companies set print_table_move = coalesce(enabled, true) where id = cid;
end $function$;

revoke execute on function public.set_print_table_move(boolean) from public, anon;
grant execute on function public.set_print_table_move(boolean) to authenticated, service_role;

-- Unchanged from 20261101_set_parts_to_stations.sql but for the first check.
create or replace function public.enqueue_print_jobs_table_move()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if not coalesce((select c.print_table_move from public.companies c where c.id = new.company_id), true) then
    return null;
  end if;

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
