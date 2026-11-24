-- Qaytarma's money and stock (found in review, 2026-11-24, before any shop had it):
--
--   · 3 × 1.00 less a 1.00 discount, paid 2.00, gave back 2.01; a product on
--     one receipt at 2.00 and 3.00 gave back 6.00 of 5.00. Now a line gives
--     back its share of what was paid, and all returns of a sale together
--     never more than was paid for its goods.
--   · A delivery closed on "Kuryer yığacaq" counts as paid, so cash could go
--     out before the rider brought any in: refused until it is all in.
--   · A size with no recipe of its own, and a set's part with a size, took
--     stock when sold and put none back. The same rule as a sale now
--     (order_stock_lines, 20261028_set_variants.sql).
--   · Deleting a sale whose goods came back put them into stock a second time
--     and took its money off twice: refused ('has_returns').
--
-- Also: a repeat of a saved return answers with what was saved, and every
-- answer carries the lines as saved, so the slip adds up to its total.

-- What a return puts back, by the rule a sale takes it (order_stock_lines).
create or replace function public.return_stock_lines(p_return_id uuid, p_company_id uuid)
 returns table (stock_item_id uuid, qty numeric)
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  with sold as (
    select l.menu_item_id,
           nullif(l.variant_id, '') as variant_id,
           l.qty as n,
           case when jsonb_typeof(mi.set_items) = 'array' and mi.set_items <> '[]'::jsonb
                then mi.set_items end as parts
    from return_lines l
    left join menu_items mi on mi.id = l.menu_item_id and mi.company_id = p_company_id
    where l.return_id = p_return_id
      and l.menu_item_id is not null
  ), units as (
    select s.menu_item_id, s.variant_id, s.n from sold s where s.parts is null
    union all
    select (p->>'id')::uuid, nullif(p->>'variantId', ''), s.n * (p->>'qty')::numeric
    from sold s cross join lateral jsonb_array_elements(s.parts) p
    where s.parts is not null
  )
  select rl.stock_item_id, rl.qty * u.n
  from units u
  join recipe_lines rl on rl.menu_item_id = u.menu_item_id
    and rl.company_id = p_company_id
    and (
      -- The size's own lines, or the dish's when there is no size.
      nullif(rl.variant_id, '') is not distinct from u.variant_id
      -- A size with no lines of its own takes the dish's recipe.
      or (nullif(rl.variant_id, '') is null
          and u.variant_id is not null
          and not exists (
            select 1 from recipe_lines own
            where own.menu_item_id = u.menu_item_id
              and own.company_id = p_company_id
              and nullif(own.variant_id, '') = u.variant_id))
    );
$function$;

-- A saved return's lines, for the slip.
create or replace function public.return_saved_lines(p_return_id uuid)
 returns jsonb
 language sql
 stable
 security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object('name', l.name, 'qty', l.qty, 'price', l.price)), '[]'::jsonb)
  from return_lines l where l.return_id = p_return_id;
$function$;

-- Only ever called from inside the database (record_return), never by a browser.
revoke all on function public.return_stock_lines(uuid, uuid) from public, anon, authenticated;
revoke all on function public.return_saved_lines(uuid) from public, anon, authenticated;

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
  worth    numeric;   -- what was paid for the line
  given    numeric;   -- what earlier returns gave back of it
  sum_ln   numeric;   -- what this line gives back
  room     numeric;   -- what the sale can still give back
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
    return (select jsonb_build_object('ok', true, 'again', true, 'id', p_id, 'total', r.total, 'approvedBy', r.approved_by,
      'lines', return_saved_lines(p_id)) from returns r where r.id = p_id);
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
    -- Closed on "Kuryer yığacaq" and the rider has not brought it all: nobody
    -- has the money yet, so there is none to give back.
    if coalesce(ord.courier_debt, 0) - coalesce(ord.courier_cash, 0) - coalesce(ord.courier_card, 0) > 0.005 then
      raise exception 'courier_unpaid';
    end if;
    -- A sale paid with a discount gives back what was paid: each line's price
    -- shrinks by the same share the discount took off the whole bill.
    select coalesce(sum(oi.menu_item_price * oi.quantity), 0) into gross
      from order_items oi where oi.order_id = p_order_id and oi.removed_at is null;
    if gross > 0 then factor := greatest(0, (gross - coalesce(ord.discount_amount, 0)) / gross); end if;
    -- All its returns together never give back more than was paid for the goods.
    select round(gross * factor, 2) - coalesce(sum(r.total), 0) into room from returns r where r.order_id = p_order_id;
  end if;

  -- The same id at the same moment: the second waits here, then finds it saved.
  insert into returns (id, company_id, order_id, total, pay, seller_name, approved_by)
  values (p_id, cid, p_order_id, 0.01, p_pay, p_seller, approver)
  on conflict (id) do nothing;
  get diagnostics inserted = row_count;
  if inserted = 0 then
    return (select jsonb_build_object('ok', true, 'again', true, 'id', p_id, 'total', r.total, 'approvedBy', r.approved_by,
      'lines', return_saved_lines(p_id)) from returns r where r.id = p_id and r.company_id = cid);
  end if;

  for ln in
    select * from jsonb_to_recordset(p_lines)
      as x("menuItemId" uuid, "variantId" text, name text, qty numeric, price numeric)
  loop
    if ln.qty is null or ln.qty <= 0 or ln.name is null then raise exception 'bad_request'; end if;
    price := ln.price;
    if p_order_id is not null then
      -- With a receipt: what this sale really had of it, and at what price.
      -- Sold at two prices: each unit is worth their average (it was the dearer one).
      select coalesce(sum(oi.quantity), 0), coalesce(sum(oi.quantity * oi.menu_item_price), 0) * factor into sold, worth
        from order_items oi
       where oi.order_id = p_order_id and oi.removed_at is null
         and oi.menu_item_id = ln."menuItemId"::text
         and nullif(oi.variant_id, '') is not distinct from nullif(ln."variantId", '');
      select coalesce(sum(rl.qty), 0), coalesce(sum(round(rl.qty * rl.price, 2)), 0) into back, given
        from return_lines rl join returns r on r.id = rl.return_id
       where r.order_id = p_order_id
         and rl.menu_item_id = ln."menuItemId"
         and nullif(rl.variant_id, '') is not distinct from nullif(ln."variantId", '');
      if sold = 0 then raise exception 'not_on_receipt'; end if;
      if back + ln.qty > sold then raise exception 'more_than_sold'; end if;
      -- Counted from the first unit that came back (lib/returns refundOf), so
      -- 3 for 2.00 gives back 0.67 + 0.66 + 0.67, not 2.01.
      sum_ln := greatest(0, least(round(worth * (back + ln.qty) / sold, 2) - given, room));
      room := room - sum_ln;
      price := round(sum_ln / ln.qty, 6);
    end if;
    if price is null or price < 0 then raise exception 'bad_request'; end if;
    insert into return_lines (return_id, company_id, menu_item_id, variant_id, name, qty, price)
    values (p_id, cid, ln."menuItemId", nullif(ln."variantId", ''), ln.name, ln.qty, price);
    tot := tot + round(ln.qty * price, 2);
  end loop;

  tot := round(tot, 2);
  if tot <= 0 then raise exception 'nothing_to_refund'; end if;

  -- The goods go back into the warehouse sales take them from, by the same
  -- recipe lines (a set's parts too, one level, as order_stock_lines).
  select sales_warehouse_id, coalesce(kassa_enabled, true) into wh, kassa from companies where id = cid;
  if wh is not null then
    with stock as (
      select l.stock_item_id, sum(l.qty) as qty from return_stock_lines(p_id, cid) l group by l.stock_item_id
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
    'lines', return_saved_lines(p_id),
    'reason', 'Qaytarma' || coalesce(' · №' || ord.order_number, ''));
end $function$;

revoke all on function public.record_return(uuid, text, jsonb, text, text, text, uuid, text, text, text) from public, anon;
grant execute on function public.record_return(uuid, text, jsonb, text, text, text, uuid, text, text, text) to authenticated, service_role;

-- A paid sale with returns stays paid. record_return() locks the sale, so a
-- delete at the same moment waits and then finds the return.
create or replace function public.keep_returned_sale()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (select 1 from returns r where r.order_id = NEW.id) then
    raise exception 'has_returns';
  end if;
  return NEW;
end $function$;

revoke all on function public.keep_returned_sale() from public, anon, authenticated;

drop trigger if exists keep_returned_sale on public.orders;
create trigger keep_returned_sale
  before update of status on public.orders
  for each row
  when (OLD.status = 'ödənilib' and NEW.status is distinct from OLD.status)
  execute function public.keep_returned_sale();
