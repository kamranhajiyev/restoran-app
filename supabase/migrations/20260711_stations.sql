-- Sexlər: owner-defined prep stations (Mətbəx, Bar, Kabab …).
-- Each menu item is prepared at one station; a station owns the printer its
-- tickets come out of. Replaces the never-rendered COOKING_STATIONS constant
-- and the free-text menu_items.cooking_station column.

create table if not exists public.stations (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  name         text not null,
  position     int  not null default 0,
  printer_ip   text,                        -- null until an Ethernet printer is assigned
  printer_port int  not null default 9100,
  created_at   timestamptz not null default now(),
  unique (company_id, name)
);

-- An FK, not the old text column: renaming a station must not orphan its items.
alter table public.menu_items
  add column if not exists station_id uuid references public.stations(id) on delete set null;

create index if not exists menu_items_station_id_idx on public.menu_items (station_id);

alter table public.stations enable row level security;

drop policy if exists stations_all on public.stations;
create policy stations_all on public.stations for all
  using      ((company_id = get_my_company_id()) or is_superadmin())
  with check ((company_id = get_my_company_id()) or is_superadmin());

-- Backfill any pre-existing cooking_station text into real station rows.
insert into public.stations (company_id, name)
select distinct company_id, cooking_station
  from public.menu_items
 where cooking_station is not null and btrim(cooking_station) <> ''
on conflict (company_id, name) do nothing;

update public.menu_items m
   set station_id = s.id
  from public.stations s
 where s.company_id = m.company_id
   and s.name = m.cooking_station
   and m.station_id is null;
