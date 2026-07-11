-- Anbarlar arası transfer: moving stock between two warehouses.
--
-- Without this, the only way to move goods from the storage warehouse to the sales warehouse was to
-- write them off from one and "buy" them into the other — which fakes a purchase (inflating supplier
-- debt) and fakes a loss (inflating Silinmələr). A transfer is its own movement type: two ledger rows
-- that net to zero, touching neither suppliers nor write-offs.

alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason in ('receipt', 'writeoff', 'recount', 'sale', 'sale_void', 'void',
                    'transfer_out', 'transfer_in', 'transfer_void'));

-- Header row grouping the movements of one multi-item transfer, mirroring stock_receipts.
create table if not exists public.stock_transfers (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id),
  from_warehouse_id uuid not null references public.warehouses(id),
  to_warehouse_id   uuid not null references public.warehouses(id),
  note              text,
  created_by        text,
  created_at        timestamptz not null default now(),
  voided_at         timestamptz,
  voided_by         text,
  check (from_warehouse_id <> to_warehouse_id)
);

alter table public.stock_movements
  add column if not exists transfer_id uuid references public.stock_transfers(id) on delete set null;

create index if not exists stock_movements_transfer_id_idx on public.stock_movements (transfer_id);

alter table public.stock_transfers enable row level security;

drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers for select
  using ((company_id = get_my_company_id()) or is_superadmin());

-- Writes go through the RPCs below (SECURITY DEFINER), same as receipts and write-offs — the table
-- itself is select-only, so a client can never move stock without the balance checks.

-- ─────────────────────────────────────────────────────────────────────────────
-- record_transfer: −qty out of the source, +qty into the target, in one transaction.
-- Unlike a write-off, an over-transfer is always a data-entry error — it is refused, never allowed
-- to drive the source negative.
create or replace function public.record_transfer(
  p_from uuid, p_to uuid, p_lines jsonb, p_note text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  cid uuid;
  uname text;
  tid uuid;
  ln jsonb;
  v_item uuid; v_qty numeric; v_cost numeric; v_have numeric;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  if p_from = p_to then raise exception 'same_warehouse'; end if;
  if not exists (select 1 from warehouses where id = p_from and company_id = cid)
     or not exists (select 1 from warehouses where id = p_to and company_id = cid) then
    raise exception 'bad_warehouse';
  end if;
  select name into uname from profiles where id = auth.uid();

  insert into stock_transfers (company_id, from_warehouse_id, to_warehouse_id, note, created_by)
  values (cid, p_from, p_to, nullif(p_note, ''), uname)
  returning id into tid;

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_item := (ln->>'stock_item_id')::uuid;
    v_qty  := (ln->>'qty')::numeric;
    if v_item is null or v_qty is null or v_qty <= 0 then continue; end if;
    if not exists (select 1 from stock_items where id = v_item and company_id = cid) then
      raise exception 'bad_item';
    end if;

    select coalesce(qty, 0) into v_have
      from stock_balances where warehouse_id = p_from and stock_item_id = v_item;
    if coalesce(v_have, 0) < v_qty then
      raise exception 'insufficient_stock:%', (select name from stock_items where id = v_item);
    end if;

    -- Carry the source's weighted average purchase cost, so moving goods doesn't move value out of
    -- the books: both legs are stamped with the same unit cost.
    select sum(qty * unit_cost) / nullif(sum(qty), 0) into v_cost
      from stock_movements
     where warehouse_id = p_from and stock_item_id = v_item
       and reason = 'receipt' and unit_cost is not null and qty > 0;

    insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, unit_cost, transfer_id, created_by)
    values (cid, p_from, v_item, -v_qty, 'transfer_out', v_cost, tid, uname),
           (cid, p_to,   v_item,  v_qty, 'transfer_in',  v_cost, tid, uname);

    insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
    values (p_from, v_item, cid, -v_qty)
    on conflict (warehouse_id, stock_item_id) do update set qty = stock_balances.qty - v_qty;

    insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
    values (p_to, v_item, cid, v_qty)
    on conflict (warehouse_id, stock_item_id) do update set qty = stock_balances.qty + v_qty;
  end loop;

  return tid;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- void_transfer: soft-delete, same shape as void_receipt — the row stays visible (red) and the stock
-- is reversed.
--
-- Deliberately NOT guarded on the target's balance. A void is a compensating entry: it restores both
-- warehouses to exactly their pre-transfer numbers, so it cannot invent a negative that the data
-- didn't already imply. Refusing when the target holds less than the transferred qty would block
-- legitimate undos whenever the target was already negative — which is common here, since sales and
-- write-offs are free to push a balance below zero (the UI shows those in red).
create or replace function public.void_transfer(p_transfer_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  cid uuid; uname text; t record; m record;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  select * into t from stock_transfers where id = p_transfer_id and company_id = cid;
  if not found then raise exception 'bad_transfer'; end if;
  if t.voided_at is not null then return; end if;   -- idempotent
  select name into uname from profiles where id = auth.uid();

  -- Reverse both legs of every line: the target gives the goods back to the source.
  for m in select * from stock_movements
            where transfer_id = p_transfer_id and reason in ('transfer_out', 'transfer_in') loop
    insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, unit_cost, transfer_id, note, created_by)
    values (cid, m.warehouse_id, m.stock_item_id, -m.qty, 'transfer_void', m.unit_cost, p_transfer_id, 'transfer silindi', uname);

    insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
    values (m.warehouse_id, m.stock_item_id, cid, -m.qty)
    on conflict (warehouse_id, stock_item_id) do update set qty = stock_balances.qty - m.qty;
  end loop;

  update stock_transfers set voided_at = now(), voided_by = uname where id = p_transfer_id;
end $$;
