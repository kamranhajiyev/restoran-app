-- A table with past orders can be deleted (Test Restoran, 2026-10-14).
--
-- Every order linked to its table (orders_table_id_fkey), so the database
-- refused to delete a table that had ever been sold at. Hiding it instead would
-- have left hidden tables behind QR codes and halls, so the order now keeps the
-- table's name and the link goes:
--   * each order carries the name its table had (orders.table_name), written by
--     the database whatever wrote the order: the browser till, the exe or a QR
--     guest; moving the order to another table moves the name with it;
--   * renaming a table renames its open orders, not the paid ones: history
--     shows the name the table had that day;
--   * orders.table_id stays as the number it was, so every screen still tells a
--     table order from a takeaway; the screens read table_name first.
-- A table with an open order still cannot be deleted (checked here as well as
-- on the admin page).

alter table public.orders add column if not exists table_name text;

update public.orders o
set table_name = t.name
from public.restaurant_tables t
where t.id = o.table_id and o.table_name is null;

alter table public.orders drop constraint if exists orders_table_id_fkey;

create or replace function public.order_table_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.table_id is not null then
    -- A table deleted meanwhile (a late order from an offline till) keeps
    -- whatever name the order came with.
    new.table_name := coalesce(
      (select t.name from restaurant_tables t where t.id = new.table_id),
      new.table_name);
  end if;
  return new;
end
$function$;

drop trigger if exists trg_order_table_name on public.orders;
create trigger trg_order_table_name
  before insert or update of table_id on public.orders
  for each row execute function public.order_table_name();

create or replace function public.table_rename_open_orders()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  update orders set table_name = new.name
  where table_id = new.id
    and status not in ('ödənilib', 'ləğv edildi', 'silinib');
  return new;
end
$function$;

drop trigger if exists trg_table_rename_open_orders on public.restaurant_tables;
create trigger trg_table_rename_open_orders
  after update of name on public.restaurant_tables
  for each row when (new.name is distinct from old.name)
  execute function public.table_rename_open_orders();

create or replace function public.table_delete_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if exists (
    select 1 from orders
    where table_id = old.id
      and status not in ('ödənilib', 'ləğv edildi', 'silinib')
  ) then
    raise exception 'table_has_open_order: Aktiv sifarişi olan masanı silmək olmaz';
  end if;
  return old;
end
$function$;

drop trigger if exists trg_table_delete_guard on public.restaurant_tables;
create trigger trg_table_delete_guard
  before delete on public.restaurant_tables
  for each row execute function public.table_delete_guard();

revoke all on function public.order_table_name() from public, anon, authenticated;
revoke all on function public.table_rename_open_orders() from public, anon, authenticated;
revoke all on function public.table_delete_guard() from public, anon, authenticated;
