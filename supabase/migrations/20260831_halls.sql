-- Zallar: a venue's floor plan split into named halls (Əsas zal, Çöl, 2-ci mərtəbə…).
-- Until now every table lived on one shared canvas, which stops being readable
-- past ~15 tables. Each table now belongs to a hall, and admin/seller render one
-- hall's plan at a time.

create table if not exists public.halls (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name       text not null,
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

-- restrict, not cascade: deleting a hall must never silently take its tables —
-- and with them the orders pointing at those tables — down with it. The UI turns
-- this FK violation into "Bu zalda masalar var".
alter table public.restaurant_tables
  add column if not exists hall_id uuid references public.halls(id) on delete restrict;

create index if not exists restaurant_tables_hall_id_idx on public.restaurant_tables (hall_id);

alter table public.halls enable row level security;

drop policy if exists halls_all on public.halls;
create policy halls_all on public.halls for all
  using      ((company_id = get_my_company_id()) or is_superadmin())
  with check ((company_id = get_my_company_id()) or is_superadmin());

-- Backfill: every company that already has tables gets an "Əsas zal" holding them.
insert into public.halls (company_id, name)
select distinct company_id, 'Əsas zal'
  from public.restaurant_tables
 where company_id is not null
on conflict (company_id, name) do nothing;

update public.restaurant_tables t
   set hall_id = h.id
  from public.halls h
 where h.company_id = t.company_id
   and h.name = 'Əsas zal'
   and t.hall_id is null;

-- The seller and admin panels subscribe to hall changes the same way they do to
-- restaurant_tables (see 20260711_enable_realtime.sql).
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'halls')
  then
    alter publication supabase_realtime add table public.halls;
  end if;
end $$;
