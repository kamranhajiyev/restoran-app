-- A deactivated account, or one whose restaurant was deactivated or trashed,
-- loses the database too (code review, 2026-10-08).
--
-- Deactivating only logged the screen out (lib/auth.ts). The database asked
-- "which company is this user in", never "is the user still allowed in", so a
-- fired employee still logged in elsewhere, or a restaurant switched off for
-- not paying, could go on reading and changing orders with the token they had.
--
-- Every read and write rule goes through get_my_company_id() or is_superadmin();
-- the owner functions look the company up in profiles themselves. All of them
-- now find nothing for an account that is off.

create or replace function public.get_my_company_id()
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select p.company_id
  from profiles p
  join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.active and c.active and c.trashed_at is null
$$;

create or replace function public.is_superadmin()
returns boolean
language sql stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'superadmin' and active)
$$;

-- The owner functions: `company_id … from profiles where id = auth.uid()` also
-- has to match get_my_company_id(), which is null for an account that is off.
-- Rewritten in place so each function keeps its body, owner and grants.
do $$
declare
  f record;
  pattern constant text :=
    '(company_id\s+(into\s+\w+\s+)?from\s+(public\.)?profiles\s+where\s+id\s*=\s*auth\.uid\(\))(?!\s+and\s+company_id\s*=\s*public\.get_my_company_id\(\))';
  def text;
begin
  for f in
    select p.oid
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')  -- aggregates have no definition to rewrite
      and p.proname not in ('get_my_company_id', 'is_superadmin')
      and pg_get_functiondef(p.oid) ~* pattern
  loop
    def := regexp_replace(pg_get_functiondef(f.oid), pattern,
                          '\1 and company_id = public.get_my_company_id()', 'gi');
    execute def;
  end loop;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind in ('f', 'p')
      and p.proname not in ('get_my_company_id', 'is_superadmin')
      and pg_get_functiondef(p.oid) ~* pattern
  ) then
    raise exception 'a function still finds the company without checking the account is on';
  end if;
end $$;
