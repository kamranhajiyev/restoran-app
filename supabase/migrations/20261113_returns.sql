-- Qaytarma (SHOP-MODE.md, step 5; agreed with Natiq 2026-11-14). A customer
-- brings goods back and gets the money back. Saved as its own record, not as a
-- sale with minus amounts, so no total that never expected a negative can go
-- wrong. Online only in this first version.
--
-- record_return() does it all in one transaction:
--   · the return and its lines;
--   · with a receipt (p_order_id): only a paid sale of this company, at the
--     price it was sold for, and never more than was bought (counting what
--     earlier returns already took back);
--   · the goods go back into the sales warehouse, the same recipe lines a sale
--     takes them by (reason 'return');
--   · cash comes out of the open shift as a Kassa movement "Qaytarma", so the
--     drawer count still matches; a card return is subtracted from the shift's
--     card total by the readers (lib/returns).
-- The id comes from the till: the same return sent twice is saved once.

create table if not exists public.returns (
  id          uuid primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  order_id    text,                 -- the sale, when the receipt was scanned
  total       numeric not null check (total > 0),
  pay         text not null check (pay in ('cash', 'card')),
  seller_name text,
  approved_by text,
  shift_id    uuid,
  created_at  timestamptz not null default now()
);

create table if not exists public.return_lines (
  id           uuid primary key default gen_random_uuid(),
  return_id    uuid not null references public.returns(id) on delete cascade,
  company_id   uuid not null references public.companies(id) on delete cascade,
  menu_item_id uuid,
  variant_id   text,
  name         text not null,
  qty          numeric not null check (qty > 0),
  price        numeric not null check (price >= 0)
);

create index if not exists returns_company_created_idx on public.returns (company_id, created_at);
create index if not exists returns_order_idx on public.returns (order_id) where order_id is not null;
create index if not exists return_lines_return_idx on public.return_lines (return_id);

alter table public.returns enable row level security;
alter table public.return_lines enable row level security;

-- Read by the company's own people; written only through record_return().
drop policy if exists returns_select on public.returns;
create policy returns_select on public.returns for select
  using (company_id = get_my_company_id() or is_superadmin());
drop policy if exists return_lines_select on public.return_lines;
create policy return_lines_select on public.return_lines for select
  using (company_id = get_my_company_id() or is_superadmin());

revoke all on public.returns, public.return_lines from anon;
grant select on public.returns, public.return_lines to authenticated;

-- A return puts goods back: a new reason for a stock movement.
alter table public.stock_movements drop constraint if exists stock_movements_reason_check;
alter table public.stock_movements add constraint stock_movements_reason_check
  check (reason = any (array['receipt', 'writeoff', 'recount', 'sale', 'sale_void', 'void',
                             'transfer_out', 'transfer_in', 'transfer_void', 'return']));

create or replace function public.record_return(
  p_id          uuid,
  p_order_id    text,
  p_lines       jsonb,
  p_pay         text,
  p_seller      text,
  p_approved_by text,
  p_company     uuid default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid   uuid;
  ord   public.orders%rowtype;
  ln    record;
  sold  numeric;
  back  numeric;
  price numeric;
  tot   numeric := 0;
  wh    uuid;
  sh    uuid;
  kassa boolean;
  gross numeric;
  factor numeric := 1;
begin
  -- The server route calls this with the service key and names the company it
  -- has already checked the terminal link against; anyone else is scoped to
  -- their own session's company, whatever they pass (as split_order).
  cid := case when auth.role() = 'service_role' then p_company else get_my_company_id() end;
  if cid is null then raise exception 'not_allowed'; end if;
  if p_pay not in ('cash', 'card') then raise exception 'bad_request'; end if;
  if p_approved_by is null or btrim(p_approved_by) = '' then raise exception 'not_approved'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'bad_request'; end if;

  -- Sent again (a lost reply): it is already saved.
  if exists (select 1 from returns where id = p_id) then
    return jsonb_build_object('id', p_id, 'total', (select total from returns where id = p_id), 'again', true);
  end if;

  if p_order_id is not null then
    select * into ord from orders where id = p_order_id and company_id = cid;
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

  insert into returns (id, company_id, order_id, total, pay, seller_name, approved_by)
  values (p_id, cid, p_order_id, 0.01, p_pay, p_seller, p_approved_by);

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
  -- return's id so it is never counted twice. A company with Kassa on has to
  -- have a shift open to hand cash out.
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
  return jsonb_build_object('id', p_id, 'total', tot);
end $function$;

revoke all on function public.record_return(uuid, text, jsonb, text, text, text, uuid) from public, anon;
grant execute on function public.record_return(uuid, text, jsonb, text, text, text, uuid) to authenticated, service_role;
