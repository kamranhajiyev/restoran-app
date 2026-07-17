-- Sex (station) employees + per-sex readiness.
--
-- Two gaps this closes:
--   1. Only the seller has an account. The people who cook are served by station
--      printers alone, and have no way to signal back.
--   2. orders.status ('hazırdır') sits on the ORDER, but one order spans several
--      sexes. The bar finishing its beers cannot be said out loud — flipping the
--      order to 'hazırdır' would falsely claim the kitchen's part is ready too.

-- ── The employee's sex link ──────────────────────────────────────────────────
-- Null for every existing row, so owners/sellers are untouched.
alter table public.profiles
  add column if not exists station_id uuid references public.stations(id) on delete set null;

create index if not exists profiles_station_idx on public.profiles (station_id);

-- The role list is pinned by a CHECK constraint: widening the app's Role union alone
-- leaves every insert failing on profiles_role_check.
alter table public.profiles drop constraint if exists profiles_role_check;
alter table public.profiles add constraint profiles_role_check
  check (role = any (array['superadmin'::text, 'owner'::text, 'seller'::text, 'employee'::text]));

-- station_id only means anything for an employee: one without a sex would log in to a
-- blank screen, and a seller with a sex implies work they never do. /api/users enforces
-- both, but a constraint outlives whichever route forgets.
alter table public.profiles drop constraint if exists profiles_station_role_check;
alter table public.profiles add constraint profiles_station_role_check
  check (
    (role = 'employee' and station_id is not null)
    or (role <> 'employee' and station_id is null)
  );

-- ── Which sex has finished its part ──────────────────────────────────────────
create table if not exists public.order_station_ready (
  order_id   text not null references public.orders(id) on delete cascade,
  station_id uuid not null references public.stations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  ready_at   timestamptz not null default now(),
  ready_by   text,
  primary key (order_id, station_id)
);

create index if not exists order_station_ready_company_idx
  on public.order_station_ready (company_id, ready_at desc);

alter table public.order_station_ready enable row level security;

drop policy if exists order_station_ready_all on public.order_station_ready;
create policy order_station_ready_all on public.order_station_ready for all
  using      ((company_id = public.get_my_company_id()) or public.is_superadmin())
  with check ((company_id = public.get_my_company_id()) or public.is_superadmin());

-- ready_at is not decoration: a sex's "done" is invalidated by its own work landing
-- afterwards. The bar says done at 14:00 and the waiter adds a beer at 14:10 — without
-- comparing the two timestamps the beer reads as ready and the bar's card never comes
-- back, so nobody ever makes it. lib/stations.ts readyStationIds() is the other half.

-- ── Which sex prepares an item ───────────────────────────────────────────────
-- The same coalesce(...) fallback the print_jobs triggers already apply nine times
-- over: an item with no sex of its own goes to the company's FIRST sex, never nowhere.
-- The prep screen and the printed ticket must name the same sex for the same dish, so
-- the rule gets one home. The nine existing call sites are load-bearing and stay as
-- they are; this is for new code.
create or replace function public.resolve_station_id(p_company_id uuid, p_station_id uuid)
returns uuid
language sql
stable
set search_path to 'public'
as $$
  select coalesce(p_station_id, (
    select s.id from stations s
    where s.company_id = p_company_id
    order by s.position, s.created_at
    limit 1))
$$;

-- ── Realtime ─────────────────────────────────────────────────────────────────
-- Skipping this is exactly how every subscription in this app once went silently dead
-- (see 20260711_enable_realtime.sql): the seller would never see a sex go green until
-- a manual refresh.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_station_ready'
  ) then
    alter publication supabase_realtime add table public.order_station_ready;
  end if;
end $$;
