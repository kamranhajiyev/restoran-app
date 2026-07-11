-- The supabase_realtime publication was EMPTY, so every postgres_changes
-- subscription in the app (seller-orders, seller-data, admin-orders, admin-data)
-- was silently receiving nothing — the UI has been living on focus-refresh and
-- polling this whole time.
--
-- Kitchen tickets and order sounds both need sub-second delivery, so publish the
-- tables the app actually listens to. Measured effect: order → both station
-- tickets printed dropped from ~15s (poll) to ~1.3s (push).
--
-- Idempotent: re-running is a no-op, and it skips tables that don't exist.
do $$
declare t text;
begin
  foreach t in array array[
    'orders', 'order_items', 'print_jobs',
    'menu_items', 'categories', 'restaurant_tables', 'companies', 'cash_shifts', 'stations'
  ] loop
    if to_regclass('public.' || t) is not null
       and not exists (
         select 1 from pg_publication_tables
          where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t)
    then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
