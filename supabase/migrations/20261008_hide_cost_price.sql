-- get_public_menu_items feeds the QR menu, which anyone can open, and it sent
-- each dish's cost price along with its price — what the restaurant pays,
-- shown to every guest and competitor. The column stays in the result so the
-- signature does not change; it is always null now.
create or replace function public.get_public_menu_items(p_company_id uuid)
 returns table(id uuid, name text, price numeric, category text, available boolean, qr_visible boolean, variants jsonb, cost_price numeric, image text, cooking_station text, pos integer)
 language sql
 security definer
 set search_path to 'public'
as $function$
  select id, name, price, category, available, qr_visible, variants, null::numeric, image, cooking_station, "position"
  from menu_items where company_id = p_company_id order by "position";
$function$;
