-- Removed items stop being deleted: they stay on the order, struck through, so the
-- card reads as a history — what was ordered, what was added later and when, and
-- what was taken off, by whom.
--
-- The danger is entirely server-side. A removed row now still EXISTS, so every
-- query that counts order_items has to learn to skip it. Three of them would
-- otherwise cause real damage, and none of them is visible from the TypeScript.

alter table public.order_items
  add column if not exists created_at timestamptz not null default now(),
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by text;

-- Backdate existing rows to their order, so they group as the original batch
-- rather than all appearing to have been added at migration time.
update public.order_items oi
   set created_at = o.created_at
  from public.orders o
 where o.id = oi.order_id and oi.created_at > o.created_at;

create index if not exists order_items_order_created_idx
  on public.order_items (order_id, created_at);

-- ── 1. Stock: never deduct ingredients for food that was never made ─────────
-- Two selects, both previously unfiltered. Until now the row was hard-deleted, so
-- they couldn't see it. Note the exception handler swallows failures whole — get
-- this wrong and the warehouse drains with no error anywhere.
create or replace function public.apply_stock_on_payment()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare wh uuid;
begin
  if NEW.status = 'ödənilib' and OLD.status is distinct from 'ödənilib' and not NEW.stock_applied then
    begin
      select sales_warehouse_id into wh from companies where id = NEW.company_id;
      if wh is not null then
        insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by)
        select NEW.company_id, wh, rl.stock_item_id, -(rl.qty * oi.quantity), 'sale', NEW.id, NEW.waiter_name
        from order_items oi
        join recipe_lines rl on rl.menu_item_id = oi.menu_item_id::uuid
          and rl.company_id = NEW.company_id
          and (nullif(rl.variant_id,'') is not distinct from nullif(oi.variant_id,''))
        where oi.order_id = NEW.id
          and oi.removed_at is null;

        insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
        select wh, rl.stock_item_id, NEW.company_id, -sum(rl.qty * oi.quantity)
        from order_items oi
        join recipe_lines rl on rl.menu_item_id = oi.menu_item_id::uuid
          and rl.company_id = NEW.company_id
          and (nullif(rl.variant_id,'') is not distinct from nullif(oi.variant_id,''))
        where oi.order_id = NEW.id
          and oi.removed_at is null
        group by rl.stock_item_id
        on conflict (warehouse_id, stock_item_id)
          do update set qty = stock_balances.qty + excluded.qty;
      end if;
      NEW.stock_applied := true;
    exception when others then
      NEW.stock_applied := NEW.stock_applied;
    end;

  elsif OLD.status = 'ödənilib' and NEW.status in ('ləğv edildi','silinib') and NEW.stock_applied then
    begin
      insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by)
      select company_id, warehouse_id, stock_item_id, -qty, 'sale_void', NEW.id, NEW.cancelled_by
      from stock_movements where order_id = NEW.id and reason = 'sale';

      insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
      select warehouse_id, stock_item_id, company_id, -sum(qty)
      from stock_movements where order_id = NEW.id and reason = 'sale'
      group by warehouse_id, stock_item_id, company_id
      on conflict (warehouse_id, stock_item_id)
        do update set qty = stock_balances.qty + excluded.qty;

      NEW.stock_applied := false;
    exception when others then
      NEW.stock_applied := NEW.stock_applied;
    end;
  end if;

  return NEW;
end $function$;

-- ── 2. New/append tickets: a ghost row must never print as new work ─────────
-- A partial removal (Cola 2 → 1) inserts a row that is already removed, carrying
-- only the unit taken away. Without this filter the kitchen would be told to make
-- *more* Cola.
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
    join public.stations st
      on st.id = coalesce(mi.station_id, (
           select s2.id from public.stations s2
            where s2.company_id = o.company_id
            order by s2.position, s2.created_at limit 1))
    cross join lateral (select case when exists (
           select 1 from public.print_jobs pj
            where pj.order_id = o.id and pj.kind in ('new','append')
         ) then 'append' else 'new' end as kind) k
   where n.removed_at is null
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name, k.kind;
  return null;
end $$;

-- ── 3. Cancel slips: a removal is now an UPDATE, not a DELETE ───────────────
-- The old AFTER DELETE trigger would simply never fire again, and the kitchen
-- would go on cooking a dish the waiter had taken off the order.
--
-- Full removal: removed_at goes null → not null on the existing row.
-- (`old` is reserved — PL/pgSQL's OLD record — hence the `prev` alias.)
create or replace function public.enqueue_print_jobs_removed()
returns trigger language plpgsql security definer set search_path = public as $$
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
     -- Nothing was ever sent to the kitchen, so there is nothing to cancel.
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $$;

drop trigger if exists order_items_enqueue_cancel on public.order_items;
drop trigger if exists order_items_enqueue_removed on public.order_items;
create trigger order_items_enqueue_removed
  after update on public.order_items
  referencing old table as old_rows new table as new_rows
  for each statement execute function public.enqueue_print_jobs_removed();

-- Partial removal: the ghost row arrives already removed. The kitchen gets
-- "cancel 1 Cola" — only what was actually taken away.
create or replace function public.enqueue_print_jobs_ghost()
returns trigger language plpgsql security definer set search_path = public as $$
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
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = o.id and pj.kind in ('new','append'))
   group by o.company_id, o.id, o.order_number, o.table_id, o.waiter_name, o.note,
            o.created_at, o.status, st.id, st.name;
  return null;
end $$;

drop trigger if exists order_items_enqueue_ghost on public.order_items;
create trigger order_items_enqueue_ghost
  after insert on public.order_items
  referencing new table as new_rows
  for each statement execute function public.enqueue_print_jobs_ghost();

-- ── 4. Whole-order cancel must not relist already-removed items ─────────────
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
     and oi.removed_at is null
     and exists (select 1 from public.print_jobs pj
                  where pj.order_id = new.id and pj.kind in ('new','append'))
   group by st.id, st.name;
  return null;
end $$;
