-- Per-station kitchen tickets.
--
-- The app never talks to a printer. It writes a ticket per station into
-- print_jobs, and a consumer on the restaurant's own network (agent/) sends it
-- to that station's printer IP. The register's USB receipt printer is separate
-- and untouched.
--
-- The jobs are created by a TRIGGER, not by application code, because items
-- reach order_items through four different paths — addOrder() in lib/store.ts,
-- /api/add-order-items, /api/update-order-item-qty (deletes at qty 0) and
-- /api/remove-order-item. A trigger covers all four at once and cannot be
-- forgotten when a fifth is added.

create table if not exists public.print_jobs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  station_id  uuid references public.stations(id) on delete cascade,
  order_id    text not null references public.orders(id) on delete cascade,   -- orders.id is text
  kind        text not null check (kind in ('new','append','cancel')),
  payload     jsonb not null,
  status      text not null default 'pending' check (status in ('pending','printed','failed')),
  attempts    int  not null default 0,
  error       text,
  created_at  timestamptz not null default now(),
  printed_at  timestamptz
);

create index if not exists print_jobs_queue_idx on public.print_jobs (company_id, status, created_at);
create index if not exists print_jobs_order_idx on public.print_jobs (order_id);

alter table public.print_jobs enable row level security;
drop policy if exists print_jobs_all on public.print_jobs;
create policy print_jobs_all on public.print_jobs for all
  using      ((company_id = get_my_company_id()) or is_superadmin())
  with check ((company_id = get_my_company_id()) or is_superadmin());

-- The ticket is frozen at enqueue time: a reprint 20 minutes later must show
-- what was ordered *then*, not what the order looks like now.
create or replace function public.build_ticket(
  o public.orders, station_name text, item_rows jsonb, job_kind text
) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'kind',        job_kind,
    'station',     station_name,
    'orderNumber', o.order_number,
    'table',       o.table_id,
    'waiter',      o.waiter_name,
    'note',        o.note,
    'at',          to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'items',       item_rows
  );
$$;

-- ── New / appended items ────────────────────────────────────────────────────
-- Statement-level with a transition table, so one INSERT of five items produces
-- one ticket per station — not five tickets.
create or replace function public.enqueue_print_jobs_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.print_jobs (company_id, station_id, order_id, kind, payload)
  select o.company_id, st.id, o.id, k.kind,
         public.build_ticket(o, st.name, jsonb_agg(jsonb_build_object(
           'name', n.menu_item_name, 'qty', n.quantity, 'modifiers', n.modifiers
         ) order by n.menu_item_name), k.kind)
    from new_rows n
    join public.orders o on o.id = n.order_id
    left join public.menu_items mi on mi.id::text = n.menu_item_id
    -- An item with no sex goes to the company's default (first) station rather
    -- than nowhere: a newly-added dish must never silently fail to print.
    -- No stations at all = the feature is unused, and this join yields nothing.
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = o.company_id
            order by s2.position, s2.created_at limit 1))
    cross join lateral (select case when exists (
           select 1 from public.print_jobs pj
            where pj.order_id = o.id and pj.kind in ('new','append')
         ) then 'append' else 'new' end as kind) k
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name, k.kind;
  return null;
end $$;

drop trigger if exists order_items_enqueue_print on public.order_items;
create trigger order_items_enqueue_print
  after insert on public.order_items
  referencing new table as new_rows
  for each statement execute function public.enqueue_print_jobs_insert();

-- ── Removed items ───────────────────────────────────────────────────────────
create or replace function public.enqueue_print_jobs_delete()
returns trigger language plpgsql security definer set search_path = public as $$
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
   -- Nothing was ever sent to the kitchen, so there is nothing to cancel.
   where exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $$;

drop trigger if exists order_items_enqueue_cancel on public.order_items;
create trigger order_items_enqueue_cancel
  after delete on public.order_items
  referencing old table as old_rows
  for each statement execute function public.enqueue_print_jobs_delete();

-- ── Whole order cancelled ───────────────────────────────────────────────────
-- cancelOrder() only flips the status; the items stay. Without this the kitchen
-- would keep cooking a cancelled order.
create or replace function public.enqueue_print_jobs_order_cancel()
returns trigger language plpgsql security definer set search_path = public as $$
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
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = new.id and pj.kind in ('new','append'))
   group by st.id, st.name;
  return null;
end $$;

drop trigger if exists orders_enqueue_cancel on public.orders;
create trigger orders_enqueue_cancel
  after update of status on public.orders
  for each row
  when (new.status in ('ləğv edildi','silinib') and old.status not in ('ləğv edildi','silinib'))
  execute function public.enqueue_print_jobs_order_cancel();
