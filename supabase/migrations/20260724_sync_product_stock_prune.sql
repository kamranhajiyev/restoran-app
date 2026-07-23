-- Product stock sync: also retire rows that no longer belong.
--
-- sync_product_stock (trigger trg_sync_product_stock on menu_items) used to only add and
-- rename. Nothing ever removed a recipe_lines row once the product's shape changed, so:
--   * saving a product and *then* adding variants left the variant-less row behind
--     ("Su" next to "Su Qazlı" / "Su Qazsız" in Qalıqlar) — the reported bug,
--   * deleting a variant left its stock item in Qalıqlar forever,
--   * removing all variants left the stale variant rows *and* tripped the
--     "already has a recipe" guard, so the plain product row was never recreated and
--     sales stopped deducting.
--
-- The prune below runs before the add/rename pass and retires every product self-line whose
-- variant_id no longer matches the menu item's current variants.

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

  -- ── Prune ───────────────────────────────────────────────────────────────────
  -- Retire this menu item's product self-lines that no longer match its shape: with
  -- variants, every line whose variant_id is not one of the current variant ids (the
  -- variant-less parent line included); without variants, every line that has one.
  -- Only type='product' lines are considered, so a hand-made ingredient recipe is safe.
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
    -- The stock item may double as an ingredient in another menu item's recipe (a soda
    -- inside a cocktail). Unlinking here would break that recipe, so leave it alone.
    if exists (
      select 1 from recipe_lines
      where stock_item_id = stale.stock_item_id and menu_item_id <> p_menu_item_id
    ) then
      continue;
    end if;

    delete from recipe_lines where id = stale.line_id;

    if exists (select 1 from stock_movements where stock_item_id = stale.stock_item_id)
       or exists (select 1 from stock_balances where stock_item_id = stale.stock_item_id and qty <> 0)
    then
      -- Real stock or past movements: hide it so Qalıqlar is clean but history and
      -- Bazarlıqlar stay intact. Same convention as trash_product_stock_on_menu_delete.
      update stock_items set trashed_at = now()
      where id = stale.stock_item_id and trashed_at is null;
    else
      -- Never used: drop it outright. All FKs to stock_items are NO ACTION, so the
      -- balance rows have to go first.
      delete from stock_balances where stock_item_id = stale.stock_item_id;
      delete from stock_items where id = stale.stock_item_id;
    end if;
  end loop;

  -- ── Add / rename ────────────────────────────────────────────────────────────
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
      -- Any recipe left at this point is a hand-made ingredient list — don't add a self
      -- line on top of it. The prune above already cleared stale variant self-lines, so
      -- dropping the last variant correctly falls through and recreates the plain row.
      if exists (select 1 from recipe_lines where menu_item_id = p_menu_item_id and company_id = cid) then
        return;
      end if;
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

-- link_product_stock was a second, add-only implementation of the same rule — the drift
-- between the two is how the duplicates accumulated. It stays as an RPC because the admin
-- form surfaces its errors to the owner, but the logic now lives in one place.
create or replace function public.link_product_stock(p_menu_item_id uuid, p_unit text default 'ədəd'::text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid uuid;
  wh  uuid;
  nm  text;
begin
  select company_id into cid from profiles where id = auth.uid() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;

  select name into nm from menu_items where id = p_menu_item_id and company_id = cid;
  if nm is null then raise exception 'bad_menu_item'; end if;

  select sales_warehouse_id into wh from companies where id = cid;
  if wh is null then raise exception 'no_sales_warehouse'; end if;

  perform sync_product_stock(p_menu_item_id);
end
$function$;
