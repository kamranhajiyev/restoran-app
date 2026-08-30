-- Backfill: turn the hardcoded MOD_GROUPS table that used to live in
-- app/seller/page.tsx into real, editable modifier sets.
--
-- Every option is priced 0, so nothing about what a sale costs changes. The one
-- visible difference for sellers: the modal no longer preselects a default (with
-- prices in play a silent default could add money nobody chose), so these groups
-- are marked required — the ticket still always carries a size, it just takes one
-- deliberate tap.
--
-- Group names are prefixed with the category because modifier_groups is unique on
-- (company_id, name) and "Ölçü" meant different options in Qəhvə than in Çay.
--
-- Idempotent: safe to re-run, and it only touches companies that actually have
-- items in those categories.

with spec(category, group_name, opts) as (
  values
    ('Qəhvə',          'Qəhvə: Ölçü',          array['S', 'M', 'L']),
    ('Qəhvə',          'Qəhvə: Süd',           array['Tam', 'Oat', 'Badam', 'Soya']),
    ('Qəhvə',          'Qəhvə: Temp',          array['İsti', 'Buzlu']),
    ('Çay',            'Çay: Ölçü',            array['Kiçik', 'Böyük']),
    ('Çay',            'Çay: Temp',            array['İsti', 'Soyuq']),
    ('Soyuq içkilər',  'Soyuq içkilər: Ölçü',  array['Kiçik', 'Böyük'])
)
insert into public.modifier_groups (company_id, name, min_select, max_select, position)
select distinct mi.company_id, s.group_name, 1, 1, 0
  from public.menu_items mi
  join spec s on s.category = mi.category
on conflict (company_id, name) do nothing;

-- Options, in the order they were listed in the old constant.
with spec(category, group_name, opts) as (
  values
    ('Qəhvə',          'Qəhvə: Ölçü',          array['S', 'M', 'L']),
    ('Qəhvə',          'Qəhvə: Süd',           array['Tam', 'Oat', 'Badam', 'Soya']),
    ('Qəhvə',          'Qəhvə: Temp',          array['İsti', 'Buzlu']),
    ('Çay',            'Çay: Ölçü',            array['Kiçik', 'Böyük']),
    ('Çay',            'Çay: Temp',            array['İsti', 'Soyuq']),
    ('Soyuq içkilər',  'Soyuq içkilər: Ölçü',  array['Kiçik', 'Böyük'])
)
insert into public.modifier_options (group_id, name, price, position)
select g.id, o.name, 0, o.ord - 1
  from spec s
  join public.modifier_groups g on g.name = s.group_name
  cross join lateral unnest(s.opts) with ordinality as o(name, ord)
 where not exists (
   select 1 from public.modifier_options existing
    where existing.group_id = g.id and existing.name = o.name);

-- Attach each set to the items of its category, in the company that owns both.
with spec(category, group_name) as (
  values
    ('Qəhvə',          'Qəhvə: Ölçü'),
    ('Qəhvə',          'Qəhvə: Süd'),
    ('Qəhvə',          'Qəhvə: Temp'),
    ('Çay',            'Çay: Ölçü'),
    ('Çay',            'Çay: Temp'),
    ('Soyuq içkilər',  'Soyuq içkilər: Ölçü')
)
insert into public.menu_item_modifier_groups (menu_item_id, group_id, position)
select mi.id, g.id, g.position
  from public.menu_items mi
  join spec s on s.category = mi.category
  join public.modifier_groups g
    on g.name = s.group_name and g.company_id = mi.company_id
on conflict (menu_item_id, group_id) do nothing;
