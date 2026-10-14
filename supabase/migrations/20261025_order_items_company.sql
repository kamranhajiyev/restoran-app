-- order_items gets its restaurant.
--
-- The screens' live listeners are filtered to their own restaurant
-- (lib/company-changes), but order_items had no company_id, so its listener
-- could not be: every dish line in every restaurant was checked against every
-- open till, admin and kitchen screen (usage review, 2026-10-14).
--
-- The database fills the column from the order, on every insert and update.
-- What a client sends for it is ignored, so a line can never claim another
-- restaurant.
--
-- Nullable on purpose: a line whose order is missing must still save rather
-- than refuse a sale. None exist today.
--
-- Run it when the restaurants are closed: filling the column updates every
-- line once, and each update is a live change the open screens hear.

alter table public.order_items
  add column if not exists company_id uuid references public.companies(id) on delete cascade;

create or replace function public.order_items_company()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  new.company_id := (select o.company_id from public.orders o where o.id = new.order_id);
  return new;
end $$;

revoke execute on function public.order_items_company() from public, anon, authenticated;

drop trigger if exists order_items_company on public.order_items;
create trigger order_items_company
  before insert or update on public.order_items
  for each row execute function public.order_items_company();

-- The old lines. The till signal is paused so this does not ping every till;
-- the print triggers only act on a dish being removed, which this is not.
alter table public.order_items disable trigger till_signal_order_items_upd;

update public.order_items i
   set company_id = o.company_id
  from public.orders o
 where o.id = i.order_id
   and i.company_id is distinct from o.company_id;

alter table public.order_items enable trigger till_signal_order_items_upd;
