-- Modifikatorlar: reusable option sets with per-option prices.
--
-- Replaces the hardcoded MOD_GROUPS table that lived in app/seller/page.tsx and
-- was keyed by category name, identical for every company, and priceless. A set
-- is now built once and attached to as many menu items as the owner likes.
--
-- Pricing rule: each selected option's price is ADDED on top of the item's base
-- (or variant) price. An option priced 0 is a plain choice that prints on the
-- ticket and changes nothing.

create table if not exists public.modifier_groups (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  -- 1 = the seller must pick something before the item can go in the cart.
  min_select  int  not null default 0,
  -- 1 = pick one (radio); null = pick any number (checkbox).
  max_select  int,
  position    int  not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, name)
);

create table if not exists public.modifier_options (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid not null references public.modifier_groups(id) on delete cascade,
  name      text not null,
  -- Added to the line price. 0 = free choice.
  price     numeric(10,2) not null default 0,
  image     text,
  position  int not null default 0
);

create index if not exists modifier_options_group_id_idx on public.modifier_options (group_id);

-- The join table is what makes a set reusable: one group, many items.
create table if not exists public.menu_item_modifier_groups (
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  group_id     uuid not null references public.modifier_groups(id) on delete cascade,
  position     int  not null default 0,
  primary key (menu_item_id, group_id)
);

create index if not exists menu_item_modifier_groups_group_id_idx
  on public.menu_item_modifier_groups (group_id);

-- Additive only. order_items.modifiers (text) keeps being written exactly as
-- before, so every existing read path — receipts, station tickets, order cards,
-- order history — keeps working on both old and new rows. This column carries the
-- per-option breakdown for display; the money itself is already folded into
-- order_items.menu_item_price, the per-line snapshot every total reads.
alter table public.order_items
  add column if not exists modifiers_detail jsonb;

alter table public.modifier_groups          enable row level security;
alter table public.modifier_options         enable row level security;
alter table public.menu_item_modifier_groups enable row level security;

drop policy if exists modifier_groups_all on public.modifier_groups;
create policy modifier_groups_all on public.modifier_groups for all
  using      ((company_id = get_my_company_id()) or is_superadmin())
  with check ((company_id = get_my_company_id()) or is_superadmin());

-- Options and links have no company_id of their own: they inherit it from the
-- group / menu item they hang off, so the check follows the FK.
drop policy if exists modifier_options_all on public.modifier_options;
create policy modifier_options_all on public.modifier_options for all
  using (exists (
    select 1 from public.modifier_groups g
     where g.id = group_id
       and ((g.company_id = get_my_company_id()) or is_superadmin())))
  with check (exists (
    select 1 from public.modifier_groups g
     where g.id = group_id
       and ((g.company_id = get_my_company_id()) or is_superadmin())));

drop policy if exists menu_item_modifier_groups_all on public.menu_item_modifier_groups;
create policy menu_item_modifier_groups_all on public.menu_item_modifier_groups for all
  using (exists (
    select 1 from public.modifier_groups g
     where g.id = group_id
       and ((g.company_id = get_my_company_id()) or is_superadmin())))
  with check (exists (
    select 1 from public.modifier_groups g
     where g.id = group_id
       and ((g.company_id = get_my_company_id()) or is_superadmin())));
