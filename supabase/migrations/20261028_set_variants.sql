-- A set names which size of a product is inside it, and a dish with sizes
-- takes its recipe (2026-10-17).
--
-- A set part was { id, qty }: "Fanta" with no size. A product with sizes keeps
-- one stock line per size, so a set holding it took nothing from stock. A part
-- can now say { id, qty, variantId } ("Fanta · 0.5L"), and that size's line is
-- taken.
--
-- Found on the way: a Yemək with sizes (Plov qulyaj, Plov katlet) has one
-- recipe for the whole dish, saved with no size (the menu form has no recipe
-- per size). A sale names its size, found no line for it, and took nothing,
-- sold alone or inside a set. Now a size with no lines of its own takes the
-- dish's recipe.
--
-- Fanta 0.5L      → its own line, as before.
-- Plov qulyaj     → the Plov recipe (was nothing).
-- Fanta, no size  → nothing, as before (a part from before this; the menu
--                   list says "variant seçilməyib").
--
-- Only order_stock_lines changes: take_order_stock still writes the movements
-- and the balances from its rows (20261014_set_stock.sql).

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
    select (p->>'id')::uuid, nullif(p->>'variantId', ''), s.n * (p->>'qty')::numeric
    from sold s cross join lateral jsonb_array_elements(s.parts) p
    where s.parts is not null
  )
  select rl.stock_item_id, rl.qty * u.n
  from units u
  join recipe_lines rl on rl.menu_item_id = u.menu_item_id
    and rl.company_id = p_company_id
    and (
      -- The size's own lines, or the dish's when there is no size.
      nullif(rl.variant_id, '') is not distinct from u.variant_id
      -- A size with no lines of its own takes the dish's recipe.
      or (nullif(rl.variant_id, '') is null
          and u.variant_id is not null
          and not exists (
            select 1 from recipe_lines own
            where own.menu_item_id = u.menu_item_id
              and own.company_id = p_company_id
              and nullif(own.variant_id, '') = u.variant_id))
    );
$function$;

-- Only ever called from inside the database (take_order_stock), never by a browser.
revoke execute on function public.order_stock_lines(text, uuid) from public, anon, authenticated;
