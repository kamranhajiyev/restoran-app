-- "Hesabı böl" left an empty bill on the table when none of a guest's dishes
-- were still on the original (removed on another till meanwhile). split_order()
-- now skips that guest instead of making a bill with nothing on it; lib/split-bill
-- applySplit, the exe's copy, does the same (2026-11-02).

create or replace function public.split_order(
  p_order_id text,
  p_parts    jsonb,
  p_company  uuid default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ord   public.orders%rowtype;
  cid   uuid;
  part  record;
  ln    record;
  cur   public.order_items%rowtype;
  moved int := 0;
  num   int;
begin
  -- The server route calls this with the service key and names the company it
  -- has already checked the terminal token against. Anyone else is scoped to
  -- their own session's company, whatever they pass.
  cid := case when auth.role() = 'service_role' then p_company else get_my_company_id() end;
  if cid is null then raise exception 'not_allowed'; end if;

  select * into ord from orders where id = p_order_id and company_id = cid for update;
  if ord.id is null then raise exception 'not_found'; end if;
  if ord.status in ('ödənilib', 'ləğv edildi', 'silinib') then raise exception 'closed'; end if;

  perform set_config('app.splitting', 'on', true);

  for part in
    select * from jsonb_to_recordset(coalesce(p_parts, '[]'::jsonb))
      as x("orderId" text, "orderNumber" int, "tillNumber" smallint, lines jsonb)
  loop
    if part."orderId" is null or part."orderId" = p_order_id then raise exception 'bad_request'; end if;
    -- Already made: this is the same split sent again.
    if exists (select 1 from orders where id = part."orderId") then continue; end if;
    -- Nothing it names is still on the bill (removed meanwhile, or taken by an
    -- earlier guest): no empty bill on the table.
    if not exists (
      select 1 from jsonb_to_recordset(coalesce(part.lines, '[]'::jsonb)) as y(id uuid, quantity int)
        join order_items oi on oi.id = y.id
       where oi.order_id = p_order_id and oi.removed_at is null and coalesce(y.quantity, 0) > 0
    ) then continue; end if;

    -- The exe's number, unless the server already has that number from that
    -- till: then it numbers the bill itself, as add-order's clash retry does.
    -- Refusing would drop the replay and lose the split the restaurant saw.
    num := part."orderNumber";
    if num is not null and exists (
      select 1 from orders o
       where o.company_id = ord.company_id and o.order_number = num
         and coalesce(o.till_number, 1) = coalesce(part."tillNumber", 1)
    ) then num := null; end if;

    insert into orders (id, company_id, table_id, waiter_name, staff_id, status, created_at,
                        order_type, order_type_name, service_charge_percent,
                        order_number, till_number)
    values (part."orderId", ord.company_id, ord.table_id, ord.waiter_name, ord.staff_id,
            ord.status, ord.created_at, ord.order_type, ord.order_type_name,
            ord.service_charge_percent,
            num, case when num is not null then part."tillNumber" end);

    for ln in
      select * from jsonb_to_recordset(coalesce(part.lines, '[]'::jsonb))
        as y(id uuid, quantity int, "newId" uuid)
    loop
      select * into cur from order_items
       where id = ln.id and order_id = p_order_id and removed_at is null
       for update;
      if cur.id is null or coalesce(ln.quantity, 0) <= 0 then cur := null; continue; end if;

      if ln.quantity >= cur.quantity then
        update order_items set order_id = part."orderId" where id = cur.id;
      else
        update order_items set quantity = cur.quantity - ln.quantity where id = cur.id;
        insert into order_items (id, order_id, company_id, menu_item_id, menu_item_name,
                                 menu_item_price, menu_price, quantity, modifiers,
                                 modifiers_detail, variant_id, no_print,
                                 printed_station_id, printed_station_ids, created_at)
        values (coalesce(ln."newId", gen_random_uuid()), part."orderId", cur.company_id,
                cur.menu_item_id, cur.menu_item_name, cur.menu_item_price, cur.menu_price,
                ln.quantity, cur.modifiers, cur.modifiers_detail, cur.variant_id, cur.no_print,
                cur.printed_station_id, cur.printed_station_ids, cur.created_at);
      end if;
      moved := moved + 1;
      cur := null;
    end loop;
  end loop;

  perform set_config('app.splitting', 'off', true);

  -- The first guest keeps the original bill: it may not be emptied by a split.
  if moved > 0 and not exists (select 1 from order_items where order_id = p_order_id and removed_at is null) then
    raise exception 'empty_original';
  end if;
end $function$;
