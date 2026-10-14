-- A Məhsul takes only itself from the warehouse, 1 per sale.
--
-- Test Restoran, 2026-10-14: "Ayran 200ml" was missing from Anbar → Qalıqlar.
-- Since July it had carried a recipe of 10 × Cappy, so every ayran sold took
-- ten Cappy and the ayran itself was never counted. A product with any recipe
-- left was also never given its own stock row (sync_product_stock returned),
-- and renaming it would have renamed the first row it found — Cappy's.
--
-- A product's only recipe lines are now its own stock rows (one, or one per
-- variant), at 1 each:
--   * sync_product_stock removes every other line, so a dish turned into a
--     product loses its recipe and gets its own row;
--   * a recipe line written on a product is refused unless it is its own row;
--   * every product is synced once below, which fixes the ones already wrong.
--
-- A product's own row: a 'product' stock item that no other menu item uses,
-- or, when another one does, that carries this product's name (Cappy's row is
-- Cappy's, not Ayran 200ml's). Only recipe lines are removed: the stock item,
-- its balance and its history stay with whoever else uses it.

create or replace function public.product_owns_stock(p_menu_item_id uuid, p_stock_item_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select exists (
    select 1
    from stock_items si
    join menu_items m on m.id = p_menu_item_id
    where si.id = p_stock_item_id
      and si.type = 'product'
      and (
        not exists (
          select 1 from recipe_lines o
          where o.stock_item_id = si.id and o.menu_item_id <> p_menu_item_id
        )
        or si.name = m.name
        or si.name like m.name || ' %'
      )
  );
$function$;

create or replace function public.sync_product_stock(p_menu_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid  uuid;
  wh   uuid;
  nm   text;
  knd  text;
  vars jsonb;
  v    jsonb;
  sid  uuid;
  vnm  text;
  has_vars boolean;
  stale record;
begin
  select company_id, name, kind, variants
    into cid, nm, knd, vars
  from menu_items where id = p_menu_item_id;
  if cid is null then return; end if;
  if knd is distinct from 'product' then return; end if;

  select sales_warehouse_id into wh from companies where id = cid;

  has_vars := vars is not null and jsonb_typeof(vars) = 'array' and jsonb_array_length(vars) > 0;

  -- A product has no recipe: drop every line that is not its own row, and
  -- make its own rows take 1.
  delete from recipe_lines
  where menu_item_id = p_menu_item_id
    and not product_owns_stock(p_menu_item_id, stock_item_id);
  update recipe_lines set qty = 1
  where menu_item_id = p_menu_item_id and qty <> 1;

  -- Prune: retire product self-lines that no longer match the menu item's shape.
  for stale in
    select rl.id as line_id, rl.stock_item_id
    from recipe_lines rl
    join stock_items si on si.id = rl.stock_item_id
    where rl.menu_item_id = p_menu_item_id
      and rl.company_id = cid
      and si.type = 'product'
      and case
            when has_vars then
              rl.variant_id is null
              or not exists (
                select 1 from jsonb_array_elements(vars) e where e->>'id' = rl.variant_id
              )
            else rl.variant_id is not null
          end
  loop
    if exists (
      select 1 from recipe_lines
      where stock_item_id = stale.stock_item_id and menu_item_id <> p_menu_item_id
    ) then
      delete from recipe_lines where id = stale.line_id;
      continue;
    end if;

    delete from recipe_lines where id = stale.line_id;

    if exists (select 1 from stock_movements where stock_item_id = stale.stock_item_id)
       or exists (select 1 from stock_balances where stock_item_id = stale.stock_item_id and qty <> 0)
    then
      update stock_items set trashed_at = now()
      where id = stale.stock_item_id and trashed_at is null;
    else
      delete from stock_balances where stock_item_id = stale.stock_item_id;
      delete from stock_items where id = stale.stock_item_id;
    end if;
  end loop;

  if has_vars then
    for v in select * from jsonb_array_elements(vars) loop
      vnm := nm || ' ' || coalesce(v->>'name','');
      select stock_item_id into sid
      from recipe_lines
      where menu_item_id = p_menu_item_id and company_id = cid
        and variant_id is not distinct from (v->>'id')
      limit 1;

      if sid is null then
        if wh is null then continue; end if;
        insert into stock_items (company_id, name, unit, type)
        values (cid, vnm, 'ədəd', 'product')
        returning id into sid;
        insert into recipe_lines (company_id, menu_item_id, stock_item_id, qty, variant_id)
        values (cid, p_menu_item_id, sid, 1, v->>'id');
        insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
        values (wh, sid, cid, 0)
        on conflict (warehouse_id, stock_item_id) do nothing;
      else
        update stock_items set name = vnm, trashed_at = null
        where id = sid and (name is distinct from vnm or trashed_at is not null);
      end if;
    end loop;
  else
    select stock_item_id into sid
    from recipe_lines
    where menu_item_id = p_menu_item_id and company_id = cid and variant_id is null
    limit 1;

    if sid is null then
      if wh is null then return; end if;
      insert into stock_items (company_id, name, unit, type)
      values (cid, nm, 'ədəd', 'product')
      returning id into sid;
      insert into recipe_lines (company_id, menu_item_id, stock_item_id, qty)
      values (cid, p_menu_item_id, sid, 1);
      insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
      values (wh, sid, cid, 0)
      on conflict (warehouse_id, stock_item_id) do nothing;
    else
      update stock_items set name = nm, trashed_at = null
      where id = sid and (name is distinct from nm or trashed_at is not null);
    end if;
  end if;
exception when others then
  -- A sync failure must never block a menu save.
  return;
end
$function$;

-- Nothing writes a recipe onto a product: not the admin form, an old exe, or
-- a restore from the trash.
create or replace function public.recipe_line_product_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (select 1 from menu_items where id = new.menu_item_id and kind = 'product')
     and (new.qty <> 1 or not product_owns_stock(new.menu_item_id, new.stock_item_id)) then
    raise exception 'product_takes_itself: a Məhsul has no recipe' using errcode = '23514';
  end if;
  return new;
end
$function$;

drop trigger if exists trg_recipe_line_product_guard on public.recipe_lines;
create trigger trg_recipe_line_product_guard
  before insert or update on public.recipe_lines
  for each row execute function public.recipe_line_product_guard();

revoke all on function public.product_owns_stock(uuid, uuid) from public, anon, authenticated;
revoke all on function public.recipe_line_product_guard() from public, anon, authenticated;

-- The products already wrong (Ayran 200ml on testing).
select public.sync_product_stock(id) from public.menu_items where kind = 'product';
