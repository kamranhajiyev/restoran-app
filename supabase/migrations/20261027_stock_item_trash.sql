-- An inqrediyent deleted in Anbar goes to the Zibil qutusu, not out of the
-- database.
--
-- Natiq, Test Restoran, 2026-10-16: Anbar's delete was a real delete, so the
-- database refused it for anything ever bought, sold or counted ("hərəkəti
-- var"), and when it did go it would have taken its history with it: a
-- receipt keeps its saved total, so it would stop adding up, and past sales
-- would lose what they cost.
--
-- trash_stock_item decides, in one place:
--   * in a recipe, or a Məhsul's own row: refused, with the dishes named;
--   * never used (no movement, no stock): deleted for good;
--   * stock left and not confirmed: refused, so the screen asks first;
--   * otherwise: trashed (hidden from Anbar and the recipe pickers, history
--     kept), with a row in the Zibil qutusu to restore it from.
-- Removing it from the Zibil qutusu only removes that row: the item stays in
-- the database, trashed, because its history still points at it.

create or replace function public.trash_stock_item(p_stock_item_id uuid, p_confirm boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid    uuid;
  si     record;
  dishes text[];
  left_qty numeric;
  has_left boolean;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;

  select id, name, unit, type into si
  from stock_items
  where id = p_stock_item_id and company_id = cid and trashed_at is null;
  if si.id is null then return jsonb_build_object('result', 'gone'); end if;

  select array_agg(distinct m.name order by m.name) into dishes
  from recipe_lines rl join menu_items m on m.id = rl.menu_item_id
  where rl.stock_item_id = si.id;
  if dishes is not null then
    return jsonb_build_object('result', 'in_recipe', 'dishes', to_jsonb(dishes), 'product', si.type = 'product');
  end if;

  -- Any warehouse not at 0 counts, even when they add up to 0 (+5 here, -5 there).
  select coalesce(sum(qty), 0), coalesce(bool_or(qty <> 0), false) into left_qty, has_left
  from stock_balances where stock_item_id = si.id;

  if not has_left and not exists (select 1 from stock_movements where stock_item_id = si.id) then
    delete from stock_balances where stock_item_id = si.id;
    delete from stock_items where id = si.id;
    return jsonb_build_object('result', 'deleted');
  end if;

  if has_left and not p_confirm then
    return jsonb_build_object('result', 'has_stock', 'qty', left_qty, 'unit', si.unit);
  end if;

  update stock_items set trashed_at = now() where id = si.id;
  insert into trash_items (type, data, company_id)
  values ('stock_item', jsonb_build_object('id', si.id, 'name', si.name, 'unit', si.unit, 'qty', left_qty), cid);
  return jsonb_build_object('result', 'trashed');
end
$function$;

-- Back from the Zibil qutusu: visible in Anbar again, with the balance it had.
create or replace function public.restore_stock_item(p_stock_item_id uuid)
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

  update stock_items set trashed_at = null
  where id = p_stock_item_id and company_id = cid;
  delete from trash_items
  where company_id = cid and type = 'stock_item' and data->>'id' = p_stock_item_id::text;
end
$function$;

revoke all on function public.trash_stock_item(uuid, boolean) from public, anon;
revoke all on function public.restore_stock_item(uuid) from public, anon;
grant execute on function public.trash_stock_item(uuid, boolean) to authenticated;
grant execute on function public.restore_stock_item(uuid) to authenticated;
