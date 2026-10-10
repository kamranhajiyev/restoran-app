-- A set ("Set 1: ayran + dolma") lists the products inside it, so the owner can
-- count how many ayrans went out, alone and inside sets (admin → Analiz → Cəmi).
-- [{ "id": <menu item id>, "qty": 1 }, ...]; null = not a set.
--
-- No new table, sequence or function: the column sits behind menu_items' own
-- row level security and owner-only writes. The public menu route names its
-- columns and does not send this one.
alter table public.menu_items add column if not exists set_items jsonb;
