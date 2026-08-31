-- QR menu visibility, separate from "available".
--
-- Until now one flag (available) hid a product from BOTH the seller's screen and
-- the customer's QR menu. There was no way to keep something sellable at the
-- counter while taking it off the public menu — staff meals, on-request dishes,
-- service charges. qr_visible is that second switch: it is read ONLY by the QR
-- page, never by the POS.
--
-- Default true so every existing row keeps showing exactly where it shows today.

alter table categories add column if not exists qr_visible boolean not null default true;
alter table menu_items add column if not exists qr_visible boolean not null default true;

-- The two public (anon-facing) readers have to carry the new column. Their return
-- type changes, so they must be dropped rather than replaced.
drop function if exists get_public_categories(uuid);
create function get_public_categories(p_company_id uuid)
returns table(name text, available boolean, qr_visible boolean, pos integer)
language sql
security definer
set search_path to 'public'
as $$
  SELECT name, available, qr_visible, "position" FROM categories WHERE company_id = p_company_id ORDER BY "position";
$$;

drop function if exists get_public_menu_items(uuid);
create function get_public_menu_items(p_company_id uuid)
returns table(id uuid, name text, price numeric, category text, available boolean, qr_visible boolean, variants jsonb, cost_price numeric, image text, cooking_station text, pos integer)
language sql
security definer
set search_path to 'public'
as $$
  SELECT id, name, price, category, available, qr_visible, variants, cost_price, image, cooking_station, "position"
  FROM menu_items WHERE company_id = p_company_id ORDER BY "position";
$$;

-- The drop took the old grants with it; the QR page reads these as anon.
grant execute on function get_public_categories(uuid) to anon, authenticated, service_role;
grant execute on function get_public_menu_items(uuid) to anon, authenticated, service_role;
