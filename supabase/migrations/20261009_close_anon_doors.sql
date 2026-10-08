-- Close everything the public anon key could still reach, in one place
-- (code review, 2026-10-08).
--
-- The first tills talked to the database directly with the anon key, so tables,
-- functions and storage were opened to anon to let them work. Tills now go
-- through server routes that check their link, but the open doors stayed, and
-- each review found another one. 20261008_closed_by_default.sql closes what is
-- created from now on; this closes what was already there.
--
-- What anon keeps, and why:
--   companies (read, the columns already granted) — the QR menu finds the
--     restaurant by its slug and reads its name, logo and switches.
--   get_public_menu_items, get_public_categories, get_public_table — the QR
--     menu's dishes, categories and table.
--   get_my_company_id, is_superadmin — used inside the companies read rule.
-- Everything else needs a login or goes through a server route.
--
-- Signed-in users and the server keep exactly the access they had: a function
-- they could call before is granted to them directly before PUBLIC loses it.
-- tests/anon-doors.test.ts holds the same list and fails if it grows.

-- Tables: nothing for anon but reading companies.
do $$
declare t record;
begin
  for t in
    select c.oid::regclass as r, c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  loop
    if t.relname = 'companies' then
      execute format('revoke insert, update, delete, truncate, references, trigger on %s from anon', t.r);
    else
      execute format('revoke all on %s from anon', t.r);
    end if;
  end loop;
end $$;

revoke all on all sequences in schema public from anon;

-- Functions: keep what signed-in users and the server had, then take PUBLIC
-- and anon away. Functions that belong to an extension are left alone.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind in ('f', 'p')
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  loop
    if has_function_privilege('authenticated', f.sig, 'execute') then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;
    if has_function_privilege('service_role', f.sig, 'execute') then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
    execute format('revoke execute on function %s from public, anon', f.sig);
  end loop;
end $$;

-- anon: the QR menu lists its dishes.
grant execute on function public.get_public_menu_items(uuid) to anon;
-- anon: the QR menu lists its categories.
grant execute on function public.get_public_categories(uuid) to anon;
-- anon: the QR menu shows the table it was opened at.
grant execute on function public.get_public_table(uuid, integer) to anon;
-- anon: the companies read rule calls it.
grant execute on function public.get_my_company_id() to anon;
-- anon: the companies read rule calls it.
grant execute on function public.is_superadmin() to anon;
