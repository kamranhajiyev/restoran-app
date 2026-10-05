-- "Something new" for the tills, pushed instead of polled.
--
-- The exe asked the site every 4 s for kitchen tickets, every 10 s for
-- readiness, every 20 s for new orders — ~34,000 requests a day per till, nearly
-- all answered "nothing". Now the database says when there is something, on one
-- broadcast topic per restaurant, and the tills fetch only then. Their timers
-- stay as a slow safety net for a dropped socket.
--
-- Public topic ('till:<company_id>'), because a till set up from a terminal link
-- has no Supabase session and cannot join a private one. The message carries
-- the kind of change and nothing else — no order, no amount — so listening in
-- tells a stranger only that a restaurant is busy. A forged message only makes
-- a till fetch early: everything it fetches still goes through the guarded
-- routes.
--
-- Statement-level: one order with eight dishes is one message, not nine.

create or replace function public.till_signal(p_company uuid, p_kind text)
returns void
language plpgsql
security definer
set search_path = public, realtime
as $$
begin
  if p_company is null then return; end if;
  perform realtime.send('{}'::jsonb, p_kind, 'till:' || p_company::text, false);
exception when others then
  -- A notice that did not go out must never cost the order, the payment or the
  -- ticket that caused it — the tills' slow timer picks the change up anyway.
  -- Raised, not swallowed silently, so it shows in the Postgres log.
  raise warning '[till_signal] % for %: %', p_kind, p_company, sqlerrm;
end;
$$;

revoke all on function public.till_signal(uuid, text) from public, anon, authenticated;

-- One trigger function per source table; each reads its transition table.

create or replace function public.till_signal_print_jobs()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from new_rows loop perform public.till_signal(c, 'print'); end loop;
  return null;
end; $$;

create or replace function public.till_signal_orders()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from new_rows loop perform public.till_signal(c, 'orders'); end loop;
  return null;
end; $$;

create or replace function public.till_signal_order_items()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in
    select distinct o.company_id from changed_rows r join public.orders o on o.id = r.order_id
  loop perform public.till_signal(c, 'orders'); end loop;
  return null;
end; $$;

create or replace function public.till_signal_ready()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from changed_rows loop perform public.till_signal(c, 'ready'); end loop;
  return null;
end; $$;

create or replace function public.till_signal_shift()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from new_rows loop perform public.till_signal(c, 'shift'); end loop;
  return null;
end; $$;

-- A trigger with transition tables may only have one event, hence the pairs.

drop trigger if exists till_signal_print_jobs_ins on public.print_jobs;
create trigger till_signal_print_jobs_ins after insert on public.print_jobs
  referencing new table as new_rows for each statement execute function public.till_signal_print_jobs();

drop trigger if exists till_signal_orders_ins on public.orders;
create trigger till_signal_orders_ins after insert on public.orders
  referencing new table as new_rows for each statement execute function public.till_signal_orders();
drop trigger if exists till_signal_orders_upd on public.orders;
create trigger till_signal_orders_upd after update on public.orders
  referencing new table as new_rows for each statement execute function public.till_signal_orders();

drop trigger if exists till_signal_order_items_ins on public.order_items;
create trigger till_signal_order_items_ins after insert on public.order_items
  referencing new table as changed_rows for each statement execute function public.till_signal_order_items();
drop trigger if exists till_signal_order_items_upd on public.order_items;
create trigger till_signal_order_items_upd after update on public.order_items
  referencing new table as changed_rows for each statement execute function public.till_signal_order_items();
drop trigger if exists till_signal_order_items_del on public.order_items;
create trigger till_signal_order_items_del after delete on public.order_items
  referencing old table as changed_rows for each statement execute function public.till_signal_order_items();

drop trigger if exists till_signal_ready_ins on public.order_station_ready;
create trigger till_signal_ready_ins after insert on public.order_station_ready
  referencing new table as changed_rows for each statement execute function public.till_signal_ready();
drop trigger if exists till_signal_ready_del on public.order_station_ready;
create trigger till_signal_ready_del after delete on public.order_station_ready
  referencing old table as changed_rows for each statement execute function public.till_signal_ready();

drop trigger if exists till_signal_shift_ins on public.cash_shifts;
create trigger till_signal_shift_ins after insert on public.cash_shifts
  referencing new table as new_rows for each statement execute function public.till_signal_shift();
drop trigger if exists till_signal_shift_upd on public.cash_shifts;
create trigger till_signal_shift_upd after update on public.cash_shifts
  referencing new table as new_rows for each statement execute function public.till_signal_shift();

-- ── 'menu': what the owner sets up, and the couriers' books ──────────────────
--
-- The exe re-downloaded the menu, tables, staff, couriers and settings every
-- five minutes whether or not anything had changed. With these it fetches them
-- only after this signal (lib/till-sync.ts planPull), plus a full sweep every
-- half hour in case a message was lost.

create or replace function public.till_signal_menu()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from changed_rows loop perform public.till_signal(c, 'menu'); end loop;
  return null;
end; $$;

-- Rows that reach their company only through their modifier set.
create or replace function public.till_signal_menu_by_group()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in
    select distinct g.company_id from changed_rows r join public.modifier_groups g on g.id = r.group_id
  loop perform public.till_signal(c, 'menu'); end loop;
  return null;
end; $$;

-- The owner's switches (Kassa, tables, receipt) live on the company row itself.
create or replace function public.till_signal_company()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct id from changed_rows loop perform public.till_signal(c, 'menu'); end loop;
  return null;
end; $$;

-- A courier settling up changes a balance the till shows: same as an order.
create or replace function public.till_signal_courier_payments()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid;
begin
  for c in select distinct company_id from changed_rows loop perform public.till_signal(c, 'orders'); end loop;
  return null;
end; $$;

do $$
declare
  t record;
  ev text;
begin
  for t in
    select * from (values
      ('menu_items', 'till_signal_menu'),
      ('categories', 'till_signal_menu'),
      ('modifier_groups', 'till_signal_menu'),
      ('stations', 'till_signal_menu'),
      ('restaurant_tables', 'till_signal_menu'),
      ('halls', 'till_signal_menu'),
      ('staff', 'till_signal_menu'),
      ('couriers', 'till_signal_menu'),
      ('modifier_options', 'till_signal_menu_by_group'),
      ('menu_item_modifier_groups', 'till_signal_menu_by_group'),
      ('courier_payments', 'till_signal_courier_payments')
    ) as v(tbl, fn)
  loop
    foreach ev in array array['insert', 'update', 'delete'] loop
      execute format('drop trigger if exists %I on public.%I', 'till_signal_' || t.tbl || '_' || left(ev, 3), t.tbl);
      execute format(
        'create trigger %I after %s on public.%I referencing %s table as changed_rows for each statement execute function public.%I()',
        'till_signal_' || t.tbl || '_' || left(ev, 3), ev, t.tbl,
        case when ev = 'delete' then 'old' else 'new' end, t.fn);
    end loop;
  end loop;
end $$;

drop trigger if exists till_signal_companies_upd on public.companies;
create trigger till_signal_companies_upd after update on public.companies
  referencing new table as changed_rows for each statement execute function public.till_signal_company();
