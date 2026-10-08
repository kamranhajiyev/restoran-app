-- A sale whose stock could not be taken off is now marked on the order, so the
-- owner sees it in Anbar and can try again (code review, 2026-10-08).
--
-- 20261008_stock_safety.sql made apply_stock_on_payment raise a warning instead
-- of swallowing the error, but a warning lands in the Postgres log, which no
-- owner reads. The payment still goes through; now the order carries why its
-- stock did not move, until a retry succeeds.

alter table public.orders add column if not exists stock_error text;

-- Taking one order's stock off the sales warehouse. Shared by the trigger and
-- the retry below, so both do exactly the same thing. Raises on failure.
-- Order ids are text: the till mints them.
create or replace function public.take_order_stock(p_order_id text, p_company_id uuid, p_by text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare wh uuid;
begin
  select sales_warehouse_id into wh from companies where id = p_company_id;
  if wh is null then return; end if;

  insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by)
  select p_company_id, wh, rl.stock_item_id, -(rl.qty * oi.quantity), 'sale', p_order_id, p_by
  from order_items oi
  join recipe_lines rl on rl.menu_item_id = oi.menu_item_id::uuid
    and rl.company_id = p_company_id
    and (nullif(rl.variant_id,'') is not distinct from nullif(oi.variant_id,''))
  where oi.order_id = p_order_id
    and oi.removed_at is null;

  insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
  select wh, rl.stock_item_id, p_company_id, -sum(rl.qty * oi.quantity)
  from order_items oi
  join recipe_lines rl on rl.menu_item_id = oi.menu_item_id::uuid
    and rl.company_id = p_company_id
    and (nullif(rl.variant_id,'') is not distinct from nullif(oi.variant_id,''))
  where oi.order_id = p_order_id
    and oi.removed_at is null
  group by rl.stock_item_id
  on conflict (warehouse_id, stock_item_id)
    do update set qty = stock_balances.qty + excluded.qty;
end $function$;

create or replace function public.apply_stock_on_payment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if NEW.status = 'ödənilib' and OLD.status is distinct from 'ödənilib' and not NEW.stock_applied then
    begin
      perform take_order_stock(NEW.id, NEW.company_id, NEW.waiter_name);
      NEW.stock_applied := true;
      NEW.stock_error := null;
    exception when others then
      NEW.stock_error := left(sqlerrm, 300);
      raise warning 'stock not applied: order % company %: % (%)', NEW.id, NEW.company_id, sqlerrm, sqlstate;
    end;

  elsif OLD.status = 'ödənilib' and NEW.status in ('ləğv edildi','silinib') then
    -- A sale that never took stock has nothing to give back, and nothing left
    -- to retry.
    NEW.stock_error := null;
    if NEW.stock_applied then
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
        raise warning 'stock not returned: order % company %: % (%)', NEW.id, NEW.company_id, sqlerrm, sqlstate;
      end;
    end if;
  end if;

  return NEW;
end $function$;

-- The owner's "try again". Only for a paid order of their own company that has
-- not taken its stock yet, so pressing it twice takes stock once.
create or replace function public.retry_order_stock(p_order_id text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid; o record; uname text;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  select id, company_id, status, stock_applied into o
    from orders where id = p_order_id and company_id = cid for update;
  if o.id is null then raise exception 'not_found'; end if;
  if o.status <> 'ödənilib' or o.stock_applied then
    update orders set stock_error = null where id = p_order_id;
    return null;
  end if;
  select name into uname from profiles where id = auth.uid();
  begin
    perform take_order_stock(p_order_id, cid, uname);
  exception when others then
    update orders set stock_error = left(sqlerrm, 300) where id = p_order_id;
    return sqlerrm;
  end;
  update orders set stock_applied = true, stock_error = null where id = p_order_id;
  return null;
end $function$;

revoke execute on function public.take_order_stock(text, uuid, text) from public, anon, authenticated;
revoke execute on function public.retry_order_stock(text) from public, anon;
grant execute on function public.retry_order_stock(text) to authenticated, service_role;

-- Found quickly per company: only the few failed sales carry it.
create index if not exists orders_stock_error_idx on public.orders (company_id) where stock_error is not null;
