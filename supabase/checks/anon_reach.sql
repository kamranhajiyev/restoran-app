-- What can the public anon key reach that it should not?
--
-- Run on a database (SQL editor or the Supabase tools) after applying
-- migrations, and before telling anyone a database is safe. An EMPTY result is
-- the only good answer. Each row is a door to close, or to add to the allowed
-- list here, in 20261009_close_anon_doors.sql and in tests/anon-doors.test.ts,
-- with the reason.

with allowed_functions(name) as (values
  ('get_public_menu_items'), ('get_public_categories'), ('get_public_table'),
  ('get_my_company_id'), ('is_superadmin')
)
-- Tables and views anon has any privilege on (companies: read only).
select 'table' as kind, c.relname as name, p.privilege as detail
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) p(privilege)
where n.nspname = 'public' and c.relkind in ('r', 'v', 'm', 'p')
  and has_table_privilege('anon', c.oid, p.privilege)
  and not (c.relname = 'companies' and p.privilege = 'SELECT')

union all
-- Column privileges anon has beyond reading companies.
select 'column', table_name || '.' || column_name, privilege_type
from information_schema.column_privileges
where table_schema = 'public' and grantee = 'anon'
  and not (table_name = 'companies' and privilege_type = 'SELECT')

union all
-- The till's link is a secret: never readable by anon.
select 'secret column', 'companies.seller_token', 'SELECT'
where has_column_privilege('anon', 'public.companies', 'seller_token', 'SELECT')

union all
-- Functions anon can run (trigger functions cannot be called directly).
select 'function', p.proname, pg_get_function_identity_arguments(p.oid)
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.prorettype <> 'trigger'::regtype
  and has_function_privilege('anon', p.oid, 'execute')
  and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
  and p.proname not in (select name from allowed_functions)

union all
-- Sequences.
select 'sequence', c.relname, 'USAGE'
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'S'
  and (has_sequence_privilege('anon', c.oid, 'USAGE') or has_sequence_privilege('anon', c.oid, 'UPDATE'))

union all
-- Storage: any rule anon falls under (anon or public role).
select 'storage policy', policyname, cmd
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and (roles::text like '%anon%' or roles::text like '%public%')

order by 1, 2;
