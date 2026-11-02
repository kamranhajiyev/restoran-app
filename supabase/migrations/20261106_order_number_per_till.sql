-- One №45 per till, and the indexes production has (2026-11-01).
--
-- Production has had orders_company_order_number_unique (company_id,
-- order_number) since it was added by hand, never in a migration; testing had
-- none, so the tests ran on a database that took what production refuses.
-- Neither rule was right: two tills that could not see each other both make
-- №45, which 20260903_order_till_number.sql shows as №45 and №45/2 on
-- purpose, and production refused the second (the server then renumbers it,
-- app/api/add-order). With no rule at all, two plain №45s could stand.
--
-- Now a number is unique per till. A null till (numbered by the server) and
-- till 1 both show a plain №45, so they count as the same till. The index name
-- still holds "order_number", which add-order's clash retry looks for.
--
-- The plain indexes below are production's, also added by hand, so the two
-- databases search the same way. Every one is "if not exists": on production
-- they are already there.

create unique index if not exists orders_company_order_number_till_unique
  on public.orders (company_id, order_number, coalesce(till_number, 1));

-- On production it is a constraint, whose index can only go with it: drop the
-- constraint first (the plain drop index failed there, 2026-11-03).
alter table public.orders drop constraint if exists orders_company_order_number_unique;
drop index if exists public.orders_company_order_number_unique;

create index if not exists cash_shifts_company_open_idx on public.cash_shifts (company_id) where closed_at is null;
create unique index if not exists companies_seller_token_idx on public.companies (seller_token);
create index if not exists idx_categories_company_id on public.categories (company_id);
create index if not exists idx_menu_items_company_id on public.menu_items (company_id);
create index if not exists idx_order_items_order_id on public.order_items (order_id);
create index if not exists idx_orders_company_id on public.orders (company_id);
create index if not exists idx_orders_paid_at on public.orders (paid_at);
create index if not exists idx_orders_table_id on public.orders (table_id);
create index if not exists idx_profiles_company_id on public.profiles (company_id);
create index if not exists idx_restaurant_tables_company_id on public.restaurant_tables (company_id);
create index if not exists idx_trash_items_company_id on public.trash_items (company_id);
create index if not exists login_events_company_created_idx on public.login_events (company_id, created_at desc);
create index if not exists login_events_user_idx on public.login_events (user_id);
