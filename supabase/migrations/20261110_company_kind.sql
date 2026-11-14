-- Restoran or Mağaza (SHOP-MODE.md, lib/company-kind.ts). Every company that
-- exists today is a restaurant, so the default keeps them exactly as they are.
alter table public.companies
  add column if not exists kind text not null default 'restaurant';

alter table public.companies drop constraint if exists companies_kind_check;
alter table public.companies add constraint companies_kind_check
  check (kind in ('restaurant', 'shop'));

-- companies is read column by column (20261008_hide_seller_token.sql): a new
-- column needs its own grant or the browser cannot read it. Logged-in users
-- only — the public key gets nothing (20261008_closed_by_default.sql).
grant select (kind) on public.companies to authenticated;

-- Writing it needs no grant of its own: companies_update lets only a
-- superadmin change a company row, so an owner cannot switch their own kind.
