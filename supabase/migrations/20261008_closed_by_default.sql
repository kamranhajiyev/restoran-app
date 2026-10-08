-- New tables, sequences and functions are closed to the public anon key unless
-- a migration opens them on purpose.
--
-- Supabase grants anon everything on whatever is created in public, and
-- Postgres lets PUBLIC execute every new function. Each feature then had to
-- remember to close what it made, and four times it did not (2026-10-08: the
-- order counters, the till token column, the courier payment and courier
-- return functions). Now forgetting leaves a thing closed, not open.
--
-- Only objects created from here on are affected. Signed-in users and the
-- server keep their access; row level security still decides which rows.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from anon;
alter default privileges for role postgres revoke execute on functions from public;
