-- Deleting a courier who has carried orders.
--
-- orders.courier_id and courier_payments.courier_id are `on delete restrict`, so
-- a courier with history could never be deleted — the panel said "deactivate
-- instead", and the deactivated name stayed in every list. Test Restoran,
-- 2026-10-06: the owner wants delete to work, the name kept only in the reports.
--
-- So a courier with history is marked deleted, never removed: the row stays for
-- the names in Ödənişlər, Hesabat and old orders, and every list a seller or the
-- owner picks from leaves it out. Deleting also clears `active`, so a till still
-- running an older page stops offering the courier for new orders as well.
alter table public.couriers add column if not exists deleted_at timestamptz;

-- A deleted "Kuryer 3" must not block hiring a new "Kuryer 3".
alter table public.couriers drop constraint if exists couriers_company_id_name_key;
create unique index if not exists couriers_company_name_live_key
  on public.couriers (company_id, name) where deleted_at is null;
