-- Only the owner changes the restaurant's setup (code review, 2026-10-08).
--
-- A cashier (seller) or kitchen (employee) login only sees its own screen, but
-- the database checked "same restaurant" and never "who": either could change
-- menu prices, tables, couriers, stock and settings, or delete orders, with the
-- token in their browser. Now those writes need the owner (or the superadmin).
--
-- What cashiers and kitchens still write themselves, unchanged: orders (insert,
-- update), order_items, cash_shifts, print_jobs, order_station_ready,
-- push_subscriptions, and the till functions (add_courier_payment,
-- cancel_courier_order, append_shift_movement, enqueue_note_ticket,
-- remove_order_items, set_print_receipt, claim_print_jobs). Everyone in the
-- restaurant still reads what they read before.

-- The owner's company, or null: not an owner, or the account or restaurant is off.
create or replace function public.get_my_owner_company_id()
returns uuid
language sql stable security definer
set search_path to 'public'
as $$
  select p.company_id
  from profiles p
  join companies c on c.id = p.company_id
  where p.id = auth.uid() and p.role = 'owner' and p.active and c.active and c.trashed_at is null
$$;

-- Stops a signed-in user who is neither the owner nor the superadmin. The server
-- (no signed-in user) passes, as it did before.
create or replace function public.require_owner()
returns void
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is not null and public.get_my_owner_company_id() is null and not public.is_superadmin() then
    raise exception 'owner_only' using errcode = '42501';
  end if;
end $$;

revoke execute on function public.get_my_owner_company_id() from public, anon;
revoke execute on function public.require_owner() from public, anon;
grant execute on function public.get_my_owner_company_id() to authenticated, service_role;
grant execute on function public.require_owner() to authenticated, service_role;

-- Setup tables: everyone in the restaurant reads, only the owner writes.
do $$
declare t text;
begin
  foreach t in array array[
    'couriers', 'halls', 'modifier_groups', 'recipe_lines', 'stations',
    'stock_items', 'stock_receipts', 'suppliers', 'warehouses', 'trash_items'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_owner_write', t);
    execute format(
      'create policy %I on public.%I for select using ((company_id = get_my_company_id()) or is_superadmin())',
      t || '_select', t);
    execute format(
      'create policy %I on public.%I for all using ((company_id = get_my_owner_company_id()) or is_superadmin())'
      ' with check ((company_id = get_my_owner_company_id()) or is_superadmin())',
      t || '_owner_write', t);
  end loop;

  -- These already had a separate read rule; only their writes change.
  foreach t in array array['categories', 'menu_items', 'restaurant_tables'] loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format(
      'create policy %I on public.%I for insert with check ((company_id = get_my_owner_company_id()) or is_superadmin())',
      t || '_write', t);
    execute format(
      'create policy %I on public.%I for update using ((company_id = get_my_owner_company_id()) or is_superadmin())'
      ' with check ((company_id = get_my_owner_company_id()) or is_superadmin())',
      t || '_update', t);
    execute format(
      'create policy %I on public.%I for delete using ((company_id = get_my_owner_company_id()) or is_superadmin())',
      t || '_delete', t);
  end loop;
end $$;

-- A for-all rule also answers reads, so the owner-only write rule above lets
-- the owner read too; the _select rule covers everyone else.

-- Options and dish links belong to a modifier group.
drop policy if exists modifier_options_all on public.modifier_options;
drop policy if exists modifier_options_select on public.modifier_options;
drop policy if exists modifier_options_owner_write on public.modifier_options;
create policy modifier_options_select on public.modifier_options for select using (exists (
  select 1 from modifier_groups g
  where g.id = modifier_options.group_id and ((g.company_id = get_my_company_id()) or is_superadmin())));
create policy modifier_options_owner_write on public.modifier_options for all using (exists (
  select 1 from modifier_groups g
  where g.id = modifier_options.group_id and ((g.company_id = get_my_owner_company_id()) or is_superadmin())))
with check (exists (
  select 1 from modifier_groups g
  where g.id = modifier_options.group_id and ((g.company_id = get_my_owner_company_id()) or is_superadmin())));

drop policy if exists menu_item_modifier_groups_all on public.menu_item_modifier_groups;
drop policy if exists menu_item_modifier_groups_select on public.menu_item_modifier_groups;
drop policy if exists menu_item_modifier_groups_owner_write on public.menu_item_modifier_groups;
create policy menu_item_modifier_groups_select on public.menu_item_modifier_groups for select using (exists (
  select 1 from modifier_groups g
  where g.id = menu_item_modifier_groups.group_id and ((g.company_id = get_my_company_id()) or is_superadmin())));
create policy menu_item_modifier_groups_owner_write on public.menu_item_modifier_groups for all using (exists (
  select 1 from modifier_groups g
  where g.id = menu_item_modifier_groups.group_id and ((g.company_id = get_my_owner_company_id()) or is_superadmin())))
with check (exists (
  select 1 from modifier_groups g
  where g.id = menu_item_modifier_groups.group_id and ((g.company_id = get_my_owner_company_id()) or is_superadmin())));

-- Deleting an order is the owner's; the till cancels instead.
drop policy if exists orders_delete on public.orders;
create policy orders_delete on public.orders for delete
  using ((company_id = get_my_owner_company_id()) or is_superadmin());

-- Admin-only functions that found the company with get_my_company_id() now
-- need the owner's.
do $$
declare
  f record;
  def text;
begin
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'add_supplier_payment', 'delete_warehouse', 'record_count', 'record_receipt',
      'record_transfer', 'record_writeoff', 'retry_order_stock', 'update_receipt',
      'void_receipt', 'void_transfer', 'set_brand_color', 'set_logo_url',
      'set_menu_only', 'set_qr_enabled')
  loop
    def := replace(pg_get_functiondef(f.oid), 'get_my_company_id()', 'get_my_owner_company_id()');
    execute def;
  end loop;

  -- The shift-editing functions run as the caller and had no company check of
  -- their own; the row rules let any cashier reach them. Owner first.
  for f in
    select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in (
      'correct_shift_totals', 'update_shift_movement', 'delete_shift_movement',
      'append_shift_movement_audited')
      and pg_get_functiondef(p.oid) not like '%perform public.require_owner();%'
  loop
    def := regexp_replace(pg_get_functiondef(f.oid), '\nbegin\n', E'\nbegin\n  perform public.require_owner();\n');
    if def not like '%perform public.require_owner();%' then
      raise exception 'could not guard %', f.oid::regprocedure;
    end if;
    execute def;
  end loop;
end $$;
