-- A Məhsul that becomes a Yemək (or a Set) lets go of its warehouse row.
--
-- Test Restoran, 2026-10-16 (Natiq): Dolma was made a Məhsul, so it got its own
-- row in Anbar; turned back into a Yemək, the row stayed in Qalıqlar, and its
-- 1-per-sale line stayed with it. sync_product_stock only acts on products, so
-- nothing ever undid what it had done.
--
-- Now, when kind leaves 'product':
--   * its own lines go, so a Yemək takes only its recipe;
--   * an own row that is empty and was never used is deleted;
--   * a row with stock or history is left as it is: the admin asks the owner
--     first (product_stock_left) and then trashes it or keeps it as an
--     ingredient (settle_product_stock). Nothing with stock disappears unasked.
-- And when it becomes a Məhsul again, sync_product_stock takes back a row it
-- left behind by name instead of opening a second "Dolma" at 0.

-- ─── letting go ──────────────────────────────────────────────────────────────

create or replace function public.release_product_stock(p_menu_item_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
begin
  for r in
    select rl.id as line_id, rl.stock_item_id
    from recipe_lines rl
    where rl.menu_item_id = p_menu_item_id
      and product_owns_stock(p_menu_item_id, rl.stock_item_id)
  loop
    delete from recipe_lines where id = r.line_id;

    -- Still someone else's (a shared row): theirs to keep.
    if exists (select 1 from recipe_lines where stock_item_id = r.stock_item_id) then
      continue;
    end if;

    if not exists (select 1 from stock_movements where stock_item_id = r.stock_item_id)
       and not exists (select 1 from stock_balances where stock_item_id = r.stock_item_id and qty <> 0)
    then
      begin
        delete from stock_balances where stock_item_id = r.stock_item_id;
        delete from stock_items where id = r.stock_item_id;
      exception when others then
        -- Something still points at it: it stays, the menu save goes on.
        null;
      end;
    end if;
  end loop;
end
$function$;

create or replace function public.trg_release_product_stock()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if old.kind = 'product' and new.kind is distinct from 'product' then
    perform public.release_product_stock(new.id);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_release_product_stock on public.menu_items;
create trigger trg_release_product_stock
  after update of kind on public.menu_items
  for each row execute function public.trg_release_product_stock();

-- ─── what the admin asks about ───────────────────────────────────────────────

-- A product's own rows that would stay behind: they have stock or history.
-- Read before the save, so the owner can say what happens to them.
create or replace function public.product_stock_left(p_menu_item_id uuid)
returns table (stock_item_id uuid, name text, unit text, qty numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;

  return query
  select si.id, si.name, si.unit,
         coalesce((select sum(b.qty) from stock_balances b where b.stock_item_id = si.id), 0)
  from recipe_lines rl
  join menu_items m on m.id = rl.menu_item_id
  join stock_items si on si.id = rl.stock_item_id
  where rl.menu_item_id = p_menu_item_id
    and m.company_id = cid
    and m.kind = 'product'
    and product_owns_stock(p_menu_item_id, si.id)
    and not exists (select 1 from recipe_lines o where o.stock_item_id = si.id and o.menu_item_id <> p_menu_item_id)
    and (exists (select 1 from stock_movements sm where sm.stock_item_id = si.id)
         or exists (select 1 from stock_balances b where b.stock_item_id = si.id and b.qty <> 0))
  order by si.name;
end
$function$;

-- The owner's answer, after the save: keep each row as an ingredient, or send
-- it to the trash (its balance and history stay there). Only rows no menu item
-- uses any more.
create or replace function public.settle_product_stock(p_stock_item_ids uuid[], p_keep boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;

  if p_keep then
    update stock_items si set type = 'ingredient', trashed_at = null
    where si.id = any(p_stock_item_ids) and si.company_id = cid and si.type = 'product'
      and not exists (select 1 from recipe_lines rl where rl.stock_item_id = si.id);
  else
    update stock_items si set trashed_at = now()
    where si.id = any(p_stock_item_ids) and si.company_id = cid and si.type = 'product'
      and si.trashed_at is null
      and not exists (select 1 from recipe_lines rl where rl.stock_item_id = si.id);
  end if;
end
$function$;

revoke all on function public.release_product_stock(uuid) from public, anon, authenticated;
revoke all on function public.trg_release_product_stock() from public, anon, authenticated;
revoke all on function public.product_stock_left(uuid) from public, anon;
revoke all on function public.settle_product_stock(uuid[], boolean) from public, anon;
grant execute on function public.product_stock_left(uuid) to authenticated;
grant execute on function public.settle_product_stock(uuid[], boolean) to authenticated;

-- ─── becoming a product again ────────────────────────────────────────────────

-- A row of this name that no menu item uses: the one a product left behind.
-- Not one in the trash: the owner sent that away, and an old deleted "Su"
-- must not hand its balance to a new one.
create or replace function public.free_product_stock(p_company_id uuid, p_name text)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select si.id
  from stock_items si
  where si.company_id = p_company_id
    and si.type = 'product'
    and si.trashed_at is null
    and si.name = p_name
    and not exists (select 1 from recipe_lines rl where rl.stock_item_id = si.id)
  order by si.created_at desc
  limit 1;
$function$;

revoke all on function public.free_product_stock(uuid, text) from public, anon, authenticated;

-- As in 20261022, except that a product with no row first takes back a free
-- row of its name (free_product_stock) before making a new one.
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
        sid := free_product_stock(cid, vnm);
        if sid is null then
          insert into stock_items (company_id, name, unit, type)
          values (cid, vnm, 'ədəd', 'product')
          returning id into sid;
        end if;
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
      sid := free_product_stock(cid, nm);
      if sid is null then
        insert into stock_items (company_id, name, unit, type)
        values (cid, nm, 'ədəd', 'product')
        returning id into sid;
      end if;
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

-- ─── the ones already left behind ────────────────────────────────────────────

-- A Yemək or Set still holding its old 1-per-sale line: the row named after
-- itself, used by nobody else. Only that line; a recipe that takes another
-- product's row on purpose is left alone.
delete from public.recipe_lines rl
using public.menu_items m, public.stock_items si
where m.id = rl.menu_item_id
  and si.id = rl.stock_item_id
  and m.kind is distinct from 'product'
  and si.type = 'product'
  and (si.name = m.name or si.name like m.name || ' %')
  and not exists (
    select 1 from public.recipe_lines o
    where o.stock_item_id = si.id and o.menu_item_id <> m.id
  );

-- Rows of type 'product' only come from the menu (Anbar makes ingredients), so
-- one no menu item uses was left behind. Empty and never used: deleted, like
-- release_product_stock does (Dolma (saxsıda) on testing). One with stock or
-- history stays for the owner to look at.
delete from public.stock_balances b
using public.stock_items si
where b.stock_item_id = si.id
  and si.type = 'product' and si.trashed_at is null
  and not exists (select 1 from public.recipe_lines rl where rl.stock_item_id = si.id)
  and not exists (select 1 from public.stock_movements sm where sm.stock_item_id = si.id)
  and not exists (select 1 from public.stock_balances b2 where b2.stock_item_id = si.id and b2.qty <> 0);

delete from public.stock_items si
where si.type = 'product' and si.trashed_at is null
  and not exists (select 1 from public.recipe_lines rl where rl.stock_item_id = si.id)
  and not exists (select 1 from public.stock_movements sm where sm.stock_item_id = si.id)
  and not exists (select 1 from public.stock_balances b where b.stock_item_id = si.id);
