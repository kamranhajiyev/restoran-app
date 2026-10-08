-- Three stock fixes (code review, 2026-10-08).
--
-- 1. apply_stock_on_payment swallowed every error: a sale whose stock could
--    not be taken off left no trace anywhere, and the count drifted. The
--    payment must still go through, so it stays caught — but now it is logged
--    (Postgres logs, "stock not applied").
-- 2. A receipt, write-off or transfer whose reply was lost was recorded again
--    when Save was pressed again. Each now takes the id the screen chose when
--    it opened; a second call with the same id does nothing.
-- 3. A write-off could take out more than the warehouse holds, sending the
--    balance negative. Transfers already refused that; write-offs now do too.

create or replace function public.apply_stock_on_payment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare wh uuid;
begin
  if NEW.status = 'ödənilib' and OLD.status is distinct from 'ödənilib' and not NEW.stock_applied then
    begin
      select sales_warehouse_id into wh from companies where id = NEW.company_id;
      if wh is not null then
        insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by)
        select NEW.company_id, wh, rl.stock_item_id, -(rl.qty * oi.quantity), 'sale', NEW.id, NEW.waiter_name
        from order_items oi
        join recipe_lines rl on rl.menu_item_id = oi.menu_item_id::uuid
          and rl.company_id = NEW.company_id
          and (nullif(rl.variant_id,'') is not distinct from nullif(oi.variant_id,''))
        where oi.order_id = NEW.id
          and oi.removed_at is null;

        insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
        select wh, rl.stock_item_id, NEW.company_id, -sum(rl.qty * oi.quantity)
        from order_items oi
        join recipe_lines rl on rl.menu_item_id = oi.menu_item_id::uuid
          and rl.company_id = NEW.company_id
          and (nullif(rl.variant_id,'') is not distinct from nullif(oi.variant_id,''))
        where oi.order_id = NEW.id
          and oi.removed_at is null
        group by rl.stock_item_id
        on conflict (warehouse_id, stock_item_id)
          do update set qty = stock_balances.qty + excluded.qty;
      end if;
      NEW.stock_applied := true;
    exception when others then
      raise warning 'stock not applied: order % company %: % (%)', NEW.id, NEW.company_id, sqlerrm, sqlstate;
    end;

  elsif OLD.status = 'ödənilib' and NEW.status in ('ləğv edildi','silinib') and NEW.stock_applied then
    begin
      insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by)
      select company_id, warehouse_id, stock_item_id, -qty, 'sale_void', NEW.id, NEW.cancelled_by
      from stock_movements where order_id = NEW.id and reason = 'sale';

      insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
      select warehouse_id, stock_item_id, company_id, -sum(qty)
      from stock_movements where order_id = NEW.id and reason = 'sale'
      group by warehouse_id, stock_item_id, company_id
      on conflict (warehouse_id, stock_item_id)
        do update set qty = stock_balances.qty + excluded.qty;

      NEW.stock_applied := false;
    exception when others then
      raise warning 'stock not returned: order % company %: % (%)', NEW.id, NEW.company_id, sqlerrm, sqlstate;
    end;
  end if;

  return NEW;
end $function$;

drop function if exists public.record_receipt(uuid, uuid, jsonb, text, numeric);
create function public.record_receipt(p_warehouse_id uuid, p_supplier_id uuid, p_lines jsonb, p_note text, p_paid_amount numeric default 0, p_id uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid;
  uname text;
  rid uuid;
  ln jsonb;
  v_item uuid; v_qty numeric; v_cost numeric;
  v_total numeric := 0;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  -- Saved already: a retry after a lost reply.
  if p_id is not null and exists (select 1 from stock_receipts where id = p_id and company_id = cid) then
    return p_id;
  end if;
  if not exists (select 1 from warehouses where id = p_warehouse_id and company_id = cid) then
    raise exception 'bad_warehouse';
  end if;
  if p_supplier_id is not null and not exists (select 1 from suppliers where id = p_supplier_id and company_id = cid) then
    raise exception 'bad_supplier';
  end if;
  select name into uname from profiles where id = auth.uid();

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_qty := (ln->>'qty')::numeric;
    v_cost := nullif(ln->>'unit_cost','')::numeric;
    if v_qty is not null then v_total := v_total + v_qty * coalesce(v_cost,0); end if;
  end loop;

  insert into stock_receipts (id, company_id, warehouse_id, supplier_id, total, note, created_by, paid_amount)
  values (coalesce(p_id, gen_random_uuid()), cid, p_warehouse_id, p_supplier_id, v_total, p_note, uname, coalesce(p_paid_amount,0))
  returning id into rid;

  for ln in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_item := (ln->>'stock_item_id')::uuid;
    v_qty := (ln->>'qty')::numeric;
    v_cost := nullif(ln->>'unit_cost','')::numeric;
    if v_item is null or v_qty is null or v_qty = 0 then continue; end if;
    if not exists (select 1 from stock_items where id = v_item and company_id = cid) then
      raise exception 'bad_item';
    end if;
    insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, unit_cost, receipt_id, created_by)
    values (cid, p_warehouse_id, v_item, v_qty, 'receipt', v_cost, rid, uname);
    insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
    values (p_warehouse_id, v_item, cid, v_qty)
    on conflict (warehouse_id, stock_item_id) do update set qty = stock_balances.qty + excluded.qty;
  end loop;

  return rid;
end $function$;

drop function if exists public.record_transfer(uuid, uuid, jsonb, text);
create function public.record_transfer(p_from uuid, p_to uuid, p_lines jsonb, p_note text, p_id uuid default null)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  cid uuid;
  uname text;
  tid uuid;
  ln jsonb;
  v_item uuid; v_qty numeric; v_cost numeric; v_have numeric;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  -- Saved already: a retry after a lost reply.
  if p_id is not null and exists (select 1 from stock_transfers where id = p_id and company_id = cid) then
    return p_id;
  end if;
  if p_from = p_to then raise exception 'same_warehouse'; end if;
  if not exists (select 1 from warehouses where id = p_from and company_id = cid)
     or not exists (select 1 from warehouses where id = p_to and company_id = cid) then
    raise exception 'bad_warehouse';
  end if;
  select name into uname from profiles where id = auth.uid();

  insert into stock_transfers (id, company_id, from_warehouse_id, to_warehouse_id, note, created_by)
  values (coalesce(p_id, gen_random_uuid()), cid, p_from, p_to, nullif(p_note, ''), uname)
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
end $function$;

drop function if exists public.record_writeoff(uuid, uuid, numeric, text);
create function public.record_writeoff(p_warehouse_id uuid, p_stock_item_id uuid, p_qty numeric, p_reason text, p_id uuid default null)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare cid uuid; uname text; v_have numeric;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  -- Saved already: a retry after a lost reply.
  if p_id is not null and exists (select 1 from stock_movements where id = p_id and company_id = cid) then
    return;
  end if;
  if p_qty is null or p_qty <= 0 then raise exception 'bad_qty'; end if;
  if not exists (select 1 from warehouses where id = p_warehouse_id and company_id = cid) then raise exception 'bad_warehouse'; end if;
  if not exists (select 1 from stock_items where id = p_stock_item_id and company_id = cid) then raise exception 'bad_item'; end if;
  select qty into v_have from stock_balances where warehouse_id = p_warehouse_id and stock_item_id = p_stock_item_id for update;
  if coalesce(v_have, 0) < p_qty then
    raise exception 'insufficient_stock:%', (select name from stock_items where id = p_stock_item_id);
  end if;
  select name into uname from profiles where id = auth.uid();

  insert into stock_movements (id, company_id, warehouse_id, stock_item_id, qty, reason, note, created_by)
  values (coalesce(p_id, gen_random_uuid()), cid, p_warehouse_id, p_stock_item_id, -p_qty, 'writeoff', nullif(p_reason,''), uname);
  insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
  values (p_warehouse_id, p_stock_item_id, cid, -p_qty)
  on conflict (warehouse_id, stock_item_id) do update set qty = stock_balances.qty - p_qty;
end $function$;

-- The recreated functions are closed to the public key like everything new;
-- signed-in users call them as before.
revoke execute on function public.record_receipt(uuid, uuid, jsonb, text, numeric, uuid) from public, anon;
revoke execute on function public.record_transfer(uuid, uuid, jsonb, text, uuid) from public, anon;
revoke execute on function public.record_writeoff(uuid, uuid, numeric, text, uuid) from public, anon;
grant execute on function public.record_receipt(uuid, uuid, jsonb, text, numeric, uuid) to authenticated, service_role;
grant execute on function public.record_transfer(uuid, uuid, jsonb, text, uuid) to authenticated, service_role;
grant execute on function public.record_writeoff(uuid, uuid, numeric, text, uuid) to authenticated, service_role;
