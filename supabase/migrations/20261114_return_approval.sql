-- Qaytarma: the manager's approval is checked by the server, not taken on the
-- till's word (found 2026-11-14, before any shop used it). Until now
-- record_return() took p_approved_by as a plain name, so anyone holding a
-- till's link could send a return "approved" by anyone.
--
-- Now the till sends the manager's PIN or card with the return, and
-- record_return() checks it here with the same functions and the same lockout
-- as the approval pad (verify_staff_pin_for_company / verify_staff_card_in).
-- The approver saved is the name the server found, never the till's.
--
-- The one case without a PIN: a company with no manager at all, where the
-- owner's own signed-in session approves (the till allows only that). A link
-- till has no owner session, so it always needs a manager.
--
-- Also:
--   · two returns of one receipt at the same moment: the sale is locked, so
--     the second sees the first and "never more than was bought" holds;
--   · the same return sent twice at the same moment: the second finds the
--     first and answers "already saved" instead of a duplicate-key error.

drop function if exists public.record_return(uuid, text, jsonb, text, text, text, uuid);

create or replace function public.record_return(
  p_id          uuid,
  p_order_id    text,
  p_lines       jsonb,
  p_pay         text,
  p_seller      text,
  p_approved_by text,
  p_company     uuid default null,
  p_pin         text default null,
  p_card        text default null,
  p_device      text default ''
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  cid      uuid;
  ord      public.orders%rowtype;
  ln       record;
  sold     numeric;
  back     numeric;
  price    numeric;
  tot      numeric := 0;
  wh       uuid;
  sh       uuid;
  kassa    boolean;
  gross    numeric;
  factor   numeric := 1;
  check_r  jsonb;
  approver text;
  inserted int;
begin
  -- The server route calls this with the service key and names the company it
  -- has already checked the terminal link against; anyone else is scoped to
  -- their own session's company, whatever they pass (as split_order).
  cid := case when auth.role() = 'service_role' then p_company else get_my_company_id() end;
  if cid is null then raise exception 'not_allowed'; end if;
  if p_pay not in ('cash', 'card') then raise exception 'bad_request'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'bad_request'; end if;

  -- Sent again (a lost reply): it is already saved. Before the approval, so a
  -- resend is never refused for a PIN that was right the first time.
  if exists (select 1 from returns where id = p_id and company_id = cid) then
    return jsonb_build_object('ok', true, 'again', true, 'id', p_id, 'total', (select total from returns where id = p_id));
  end if;

  -- Who approved it: checked here, never the till's say-so.
  if nullif(btrim(coalesce(p_card, '')), '') is not null then
    check_r := verify_staff_card_in(cid, btrim(p_card), coalesce(p_device, ''));
  elsif nullif(btrim(coalesce(p_pin, '')), '') is not null then
    check_r := verify_staff_pin_for_company(cid, btrim(p_pin), coalesce(p_device, ''));
  end if;
  if check_r is not null then
    -- Answered, not raised: an exception would undo the wrong-PIN count the
    -- check just wrote, and the lockout would never come.
    if coalesce((check_r->>'ok')::boolean, false) is not true or check_r->>'role' <> 'manager' then
      return jsonb_build_object('ok', false, 'error', case when check_r->>'error' = 'locked' then 'locked' else 'not_approved' end);
    end if;
    approver := check_r->>'name';
  elsif auth.role() <> 'service_role'
    and not exists (select 1 from staff s where s.company_id = cid and s.active and s.role = 'manager')
    and exists (select 1 from profiles p where p.id = auth.uid() and p.company_id = cid and p.role = 'owner')
    and nullif(btrim(coalesce(p_approved_by, '')), '') is not null then
    approver := btrim(p_approved_by);
  else
    raise exception 'not_approved';
  end if;

  if p_order_id is not null then
    -- Locked: two returns of one receipt wait for each other, so the second
    -- counts what the first gave back.
    select * into ord from orders where id = p_order_id and company_id = cid for update;
    if ord.id is null then raise exception 'not_found'; end if;
    if ord.status <> 'ödənilib' then raise exception 'not_paid'; end if;
    -- A sale paid with a discount gives back what was paid: each line's price
    -- shrinks by the same share the discount took off the whole bill.
    if coalesce(ord.discount_amount, 0) > 0 then
      select sum(oi.menu_item_price * oi.quantity) into gross
        from order_items oi where oi.order_id = p_order_id and oi.removed_at is null;
      if gross > 0 then factor := greatest(0, (gross - ord.discount_amount) / gross); end if;
    end if;
  end if;

  -- The same id at the same moment: the second waits here, then finds it saved.
  insert into returns (id, company_id, order_id, total, pay, seller_name, approved_by)
  values (p_id, cid, p_order_id, 0.01, p_pay, p_seller, approver)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return jsonb_build_object('ok', true, 'again', true, 'id', p_id, 'total', (select total from returns where id = p_id and company_id = cid));
  end if;

  for ln in
    select * from jsonb_to_recordset(p_lines)
      as x("menuItemId" uuid, "variantId" text, name text, qty numeric, price numeric)
  loop
    if ln.qty is null or ln.qty <= 0 or ln.name is null then raise exception 'bad_request'; end if;
    price := ln.price;
    if p_order_id is not null then
      -- With a receipt: what this sale really had of it, and at what price.
      select coalesce(sum(oi.quantity), 0), max(oi.menu_item_price) into sold, price
        from order_items oi
       where oi.order_id = p_order_id and oi.removed_at is null
         and oi.menu_item_id = ln."menuItemId"::text
         and nullif(oi.variant_id, '') is not distinct from nullif(ln."variantId", '');
      select coalesce(sum(rl.qty), 0) into back
        from return_lines rl join returns r on r.id = rl.return_id
       where r.order_id = p_order_id
         and rl.menu_item_id = ln."menuItemId"
         and nullif(rl.variant_id, '') is not distinct from nullif(ln."variantId", '');
      if sold = 0 then raise exception 'not_on_receipt'; end if;
      if back + ln.qty > sold then raise exception 'more_than_sold'; end if;
      price := round(price * factor, 2);
    end if;
    if price is null or price < 0 then raise exception 'bad_request'; end if;
    insert into return_lines (return_id, company_id, menu_item_id, variant_id, name, qty, price)
    values (p_id, cid, ln."menuItemId", nullif(ln."variantId", ''), ln.name, ln.qty, price);
    tot := tot + round(ln.qty * price, 2);
  end loop;

  tot := round(tot, 2);
  if tot <= 0 then raise exception 'bad_request'; end if;

  -- The goods go back into the warehouse sales take them from, by the same
  -- recipe lines (a set's parts too, one level, as order_stock_lines).
  select sales_warehouse_id, coalesce(kassa_enabled, true) into wh, kassa from companies where id = cid;
  if wh is not null then
    with units as (
      select rl.menu_item_id, nullif(rl.variant_id, '') as variant_id, rl.qty as n,
             case when jsonb_typeof(mi.set_items) = 'array' and mi.set_items <> '[]'::jsonb then mi.set_items end as parts
        from return_lines rl
        left join menu_items mi on mi.id = rl.menu_item_id and mi.company_id = cid
       where rl.return_id = p_id and rl.menu_item_id is not null
    ), flat as (
      select menu_item_id, variant_id, n from units where parts is null
      union all
      select (p->>'id')::uuid, null, u.n * (p->>'qty')::numeric
        from units u cross join lateral jsonb_array_elements(u.parts) p where u.parts is not null
    ), stock as (
      select r.stock_item_id, sum(r.qty * f.n) as qty
        from flat f
        join recipe_lines r on r.menu_item_id = f.menu_item_id and r.company_id = cid
         and (nullif(r.variant_id, '') is not distinct from f.variant_id)
       group by r.stock_item_id
    ), moved as (
      insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by, note)
      select cid, wh, s.stock_item_id, s.qty, 'return', p_order_id, p_seller, 'Qaytarma'
        from stock s
      returning stock_item_id, qty
    )
    insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
    select wh, m.stock_item_id, cid, sum(m.qty) from moved m group by m.stock_item_id
    on conflict (warehouse_id, stock_item_id) do update set qty = stock_balances.qty + excluded.qty;
  end if;

  -- Cash leaves the drawer: a Kassa movement in the open shift, keyed by the
  -- return's id so it is never counted twice (the exe/APK puts the same id in
  -- its own copy of the shift: lib/till-store, RETURN_MOVEMENT). A company
  -- with Kassa on has to have a shift open to hand cash out.
  select id into sh from cash_shifts where company_id = cid and closed_at is null order by opened_at desc limit 1;
  if p_pay = 'cash' then
    if sh is null and kassa then raise exception 'no_shift'; end if;
    if sh is not null then
      update cash_shifts
         set movements = movements || jsonb_build_array(jsonb_build_object(
               'id', p_id::text, 'at', now(), 'amount', -tot,
               'reason', 'Qaytarma' || coalesce(' · №' || ord.order_number, ''),
               'by', coalesce(p_seller, '')))
       where id = sh;
    end if;
  end if;

  update returns set total = tot, shift_id = sh where id = p_id;
  return jsonb_build_object('ok', true, 'id', p_id, 'total', tot, 'approvedBy', approver, 'shiftId', sh,
    'reason', 'Qaytarma' || coalesce(' · №' || ord.order_number, ''));
end $function$;

revoke all on function public.record_return(uuid, text, jsonb, text, text, text, uuid, text, text, text) from public, anon;
grant execute on function public.record_return(uuid, text, jsonb, text, text, text, uuid, text, text, text) to authenticated, service_role;
