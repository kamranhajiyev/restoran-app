-- A set takes the stock of what is inside it (customer request, 2026-10-10).
--
-- "Set 1 (ayran + dolma)" was an ordinary dish: a recipe line could only point
-- at a warehouse item, so the ayran could come off the stock and the dolma,
-- which is cooked from ingredients and has no stock item of its own, could not.
--
-- A set already lists what is inside it (menu_items.set_items,
-- 20261013_set_items.sql). Selling one now takes each part's recipe, times how
-- many of that part the set holds. The set's own recipe lines are not used
-- while it has parts, so a line left from before it became a set (the ayran
-- typed in by hand) is not taken a second time. One level only: a set inside
-- a set is not opened, the same as the Cəmi count (lib/set-items).

-- Növ in the menu form: Məhsul | Yemək | Set.
alter table public.menu_items drop constraint if exists menu_items_kind_check;
alter table public.menu_items add constraint menu_items_kind_check
  check (kind in ('product', 'meal', 'set'));

-- What one order takes from the warehouse, a row per recipe line. The one
-- place that decides it: take_order_stock writes both the movements and the
-- balances from these rows.
create or replace function public.order_stock_lines(p_order_id text, p_company_id uuid)
 returns table (stock_item_id uuid, qty numeric)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with sold as (
    select oi.menu_item_id::uuid as menu_item_id,
           nullif(oi.variant_id, '') as variant_id,
           oi.quantity::numeric as n,
           case when jsonb_typeof(mi.set_items) = 'array' and mi.set_items <> '[]'::jsonb
                then mi.set_items end as parts
    from order_items oi
    left join menu_items mi on mi.id = oi.menu_item_id::uuid and mi.company_id = p_company_id
    where oi.order_id = p_order_id
      and oi.removed_at is null
  ), units as (
    select s.menu_item_id, s.variant_id, s.n from sold s where s.parts is null
    union all
    select (p->>'id')::uuid, null, s.n * (p->>'qty')::numeric
    from sold s cross join lateral jsonb_array_elements(s.parts) p
    where s.parts is not null
  )
  select rl.stock_item_id, rl.qty * u.n
  from units u
  join recipe_lines rl on rl.menu_item_id = u.menu_item_id
    and rl.company_id = p_company_id
    and (nullif(rl.variant_id, '') is not distinct from u.variant_id);
$function$;

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
  select p_company_id, wh, l.stock_item_id, -l.qty, 'sale', p_order_id, p_by
  from order_stock_lines(p_order_id, p_company_id) l;

  insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
  select wh, l.stock_item_id, p_company_id, -sum(l.qty)
  from order_stock_lines(p_order_id, p_company_id) l
  group by l.stock_item_id
  on conflict (warehouse_id, stock_item_id)
    do update set qty = stock_balances.qty + excluded.qty;
end $function$;

-- Both are only ever called from inside the database (the payment trigger and
-- retry_order_stock), never by a browser.
revoke execute on function public.order_stock_lines(text, uuid) from public, anon, authenticated;
revoke execute on function public.take_order_stock(text, uuid, text) from public, anon, authenticated;
