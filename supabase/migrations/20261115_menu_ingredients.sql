-- Yeməyin tərkibi: what a dish is made of, typed by the owner in admin and shown
-- only to guests on the QR / online menu (restaurant mode). One text per dish;
-- its sizes share it. Plain text for people, not stock (that is Resept).
alter table public.menu_items add column if not exists ingredients text;

alter table public.menu_items drop constraint if exists menu_items_ingredients_len;
alter table public.menu_items add constraint menu_items_ingredients_len
  check (ingredients is null or char_length(ingredients) <= 500);

-- The QR menu reads its dishes through get_public_menu_items; it now returns the
-- text too. A new return column means drop and create, so the grants below are
-- set again exactly as 20261009_close_anon_doors.sql left them.
drop function if exists public.get_public_menu_items(uuid);

create function public.get_public_menu_items(p_company_id uuid)
 returns table(id uuid, name text, price numeric, category text, available boolean, qr_visible boolean, variants jsonb, cost_price numeric, image text, cooking_station text, pos integer, ingredients text)
 language sql
 security definer
 set search_path to 'public'
as $function$
  -- cost_price stays null: guests never see what the dish costs (20261008_hide_cost_price.sql).
  select id, name, price, category, available, qr_visible, variants, null::numeric, image, cooking_station, "position", ingredients
  from menu_items where company_id = p_company_id order by "position";
$function$;

revoke execute on function public.get_public_menu_items(uuid) from public;
grant execute on function public.get_public_menu_items(uuid) to authenticated, service_role;
-- anon: the QR menu lists its dishes (same door as 20261009_close_anon_doors.sql).
grant execute on function public.get_public_menu_items(uuid) to anon;
