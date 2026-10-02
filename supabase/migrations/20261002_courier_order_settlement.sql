-- Which courier orders have been paid for, and how.
--
-- A courier's handover was recorded against the courier alone — "Nihad, 30 ₼,
-- nağd" — so the balance was right but no order could say whether its money had
-- come back. Tarixçə showed every delivery as plain "ödənilib", and the Nağd /
-- Kart filters dropped them altogether: they tender nothing at the till.
--
-- Two things change:
--
--   · a payment can name the orders it is for (order_ids). The till now settles
--     by ticking orders, and a split handover is two payments — one nağd, one
--     kart — naming the same orders.
--   · each courier order carries how much of its debt came back as cash and as
--     card (courier_cash, courier_card). Derived, never written by a client:
--     courier_reallocate recomputes a courier's orders from their payments.
--
-- The allocation: payments that name orders cover those orders first, oldest
-- order first. Whatever is left over — every payment made before this existed,
-- one from a till that has not updated, the part of a payment whose order was
-- later returned — covers the courier's remaining orders oldest first. That is
-- also what fills in the history: at the moment of migrating, past handovers are
-- spread over past deliveries in the order they happened.
--
-- The balance itself (courier_outstanding) is untouched. These columns only say
-- which orders the money already paid belongs to.

alter table public.orders
  add column if not exists courier_cash numeric not null default 0,
  add column if not exists courier_card numeric not null default 0;

alter table public.courier_payments
  add column if not exists order_ids text[];

create or replace function public.courier_reallocate(p_courier_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pay    record;
  ord    record;
  v_left numeric;
  take   numeric;
begin
  if p_courier_id is null then return; end if;

  create temp table if not exists _cr_orders (
    id text primary key, created_at timestamptz, owed numeric, cash numeric, card numeric
  ) on commit drop;
  create temp table if not exists _cr_pay (
    id uuid primary key, created_at timestamptz, method text, left_amt numeric, order_ids text[]
  ) on commit drop;
  -- Truncate, not a bare DELETE: Supabase's safeupdate refuses a DELETE with no
  -- WHERE clause on calls arriving through PostgREST.
  truncate _cr_orders, _cr_pay;

  -- Only 'ödənilib' orders owe anything — see courier_outstanding.
  insert into _cr_orders
    select id, created_at, courier_debt, 0, 0 from orders
    where courier_id = p_courier_id and status = 'ödənilib' and coalesce(courier_debt, 0) > 0;
  insert into _cr_pay
    select id, created_at, method, amount, order_ids from courier_payments
    where courier_id = p_courier_id;

  -- Pass 1: payments that name their orders.
  for pay in select * from _cr_pay where order_ids is not null order by created_at, id loop
    v_left := pay.left_amt;
    for ord in
      select * from _cr_orders
      where id = any(pay.order_ids) and owed - cash - card > 0.0001
      order by created_at, id
    loop
      exit when v_left <= 0.0001;
      take := least(v_left, ord.owed - ord.cash - ord.card);
      update _cr_orders set
        cash = cash + case when pay.method = 'kart' then 0 else take end,
        card = card + case when pay.method = 'kart' then take else 0 end
      where id = ord.id;
      v_left := v_left - take;
    end loop;
    update _cr_pay set left_amt = v_left where id = pay.id;
  end loop;

  -- Pass 2: everything not yet spent, oldest payment onto oldest order. Payments
  -- that named no orders go first — they were meant for the oldest debts. What a
  -- named payment has left (its order came back) is a true surplus and is spent
  -- last, so it does not push an ordinary payment off the order it paid for.
  for pay in
    select * from _cr_pay where left_amt > 0.0001
    order by (order_ids is not null), created_at, id
  loop
    v_left := pay.left_amt;
    for ord in
      select * from _cr_orders where owed - cash - card > 0.0001 order by created_at, id
    loop
      exit when v_left <= 0.0001;
      take := least(v_left, ord.owed - ord.cash - ord.card);
      update _cr_orders set
        cash = cash + case when pay.method = 'kart' then 0 else take end,
        card = card + case when pay.method = 'kart' then take else 0 end
      where id = ord.id;
      v_left := v_left - take;
    end loop;
  end loop;

  update orders o set courier_cash = w.cash, courier_card = w.card
  from _cr_orders w
  where o.id = w.id and (o.courier_cash <> w.cash or o.courier_card <> w.card);

  -- Returned, deleted or moved to another courier: nothing of this courier's
  -- money sits on it any more.
  update orders set courier_cash = 0, courier_card = 0
  where courier_id = p_courier_id
    and (courier_cash <> 0 or courier_card <> 0)
    and id not in (select id from _cr_orders);
end $function$;

revoke all on function public.courier_reallocate(uuid) from public, anon, authenticated;

-- Any change to a courier's payments — taken, deleted, trimmed, method flipped.
create or replace function public.courier_payments_reallocate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op <> 'INSERT' then perform courier_reallocate(old.courier_id); end if;
  if tg_op <> 'DELETE' and (tg_op = 'INSERT' or new.courier_id is distinct from old.courier_id) then
    perform courier_reallocate(new.courier_id);
  end if;
  return null;
end $function$;

drop trigger if exists courier_payments_reallocate on public.courier_payments;
create trigger courier_payments_reallocate
  after insert or update or delete on public.courier_payments
  for each row execute function public.courier_payments_reallocate();

-- An order starts or stops owing: paid with a courier, returned, deleted,
-- restored, its debt edited, or handed to a different rider. courier_reallocate
-- itself writes only courier_cash/courier_card, which this does not watch.
create or replace function public.orders_courier_reallocate()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if tg_op = 'UPDATE' and old.courier_id is not null then
    perform courier_reallocate(old.courier_id);
  end if;
  if new.courier_id is not null and (tg_op = 'INSERT' or new.courier_id is distinct from old.courier_id) then
    perform courier_reallocate(new.courier_id);
  end if;
  return null;
end $function$;

-- Two triggers because an INSERT trigger's condition cannot mention OLD.
drop trigger if exists orders_courier_reallocate on public.orders;
drop trigger if exists orders_courier_reallocate_ins on public.orders;
create trigger orders_courier_reallocate_ins
  after insert on public.orders
  for each row
  when (new.courier_id is not null)
  execute function public.orders_courier_reallocate();
drop trigger if exists orders_courier_reallocate_upd on public.orders;
create trigger orders_courier_reallocate_upd
  after update of status, courier_debt, courier_id on public.orders
  for each row
  when (new.courier_id is not null or old.courier_id is not null)
  execute function public.orders_courier_reallocate();

-- add_courier_payment, now able to name the orders it is for. Dropped and
-- recreated rather than overloaded: two versions differing only in a defaulted
-- trailing argument make every named-argument call from PostgREST ambiguous.
-- A till that has not updated calls without p_order_ids and lands in pass 2.
drop function if exists public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text);

create or replace function public.add_courier_payment(
  p_courier_id uuid,
  p_amount     numeric,
  p_created_by text default null,
  p_staff_id   uuid default null,
  p_shift_id   uuid default null,
  p_note       text default null,
  p_id         uuid default null,
  p_method     text default 'nağd',
  p_order_ids  text[] default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid    uuid;
  pid    uuid := coalesce(p_id, gen_random_uuid());
  uname  text;
  debt   numeric;
  meth   text := case when p_method = 'kart' then 'kart' else 'nağd' end;
  ids    text[];
begin
  select company_id into cid from couriers where id = p_courier_id;
  if cid is null then raise exception 'bad_courier'; end if;
  if auth.uid() is not null and cid <> coalesce(get_my_company_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     and not is_superadmin() then
    raise exception 'no_company';
  end if;
  if p_amount is null or p_amount <= 0 then raise exception 'bad_amount'; end if;

  -- The same id twice is one payment retried, not two payments taken.
  if exists (select 1 from courier_payments where id = pid) then return pid; end if;

  -- Serialise two tills settling the same courier, or both pass the check below.
  perform 1 from couriers where id = p_courier_id for update;

  debt := courier_outstanding(p_courier_id);
  -- Epsilon so a float residue on an exact "tam" payment is not rejected.
  if p_amount > debt + 0.005 then raise exception 'overpay'; end if;

  -- Only this courier's own orders. Anything else in the list is dropped rather
  -- than refused: an order returned between the tick and the tap should not
  -- cost the seller the whole handover.
  if p_order_ids is not null then
    select array_agg(id) into ids from orders
    where id = any(p_order_ids) and courier_id = p_courier_id;
  end if;

  select name into uname from profiles where id = auth.uid();

  insert into courier_payments (id, company_id, courier_id, amount, created_by, staff_id, shift_id, note, method, order_ids)
  values (pid, cid, p_courier_id, p_amount, coalesce(nullif(p_created_by,''), uname), p_staff_id,
          p_shift_id, nullif(p_note,''), meth, ids);

  -- Cash only. A card settlement is money the restaurant has received but not
  -- money in this drawer, so the shift must not count it.
  if p_shift_id is not null and meth = 'nağd' then
    perform append_shift_movement(p_shift_id, jsonb_build_object(
      'id',     pid::text,
      'at',     now(),
      'amount', p_amount,
      'reason', 'Kuryer ödənişi',
      'by',     coalesce(nullif(p_created_by,''), uname, '')
    ));
  end if;

  return pid;
end $function$;

revoke all on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text, text[]) from public;
grant execute on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text, text[]) to authenticated, service_role;

-- Fill in every courier's history.
do $$
declare c record;
begin
  for c in select id from couriers loop
    perform public.courier_reallocate(c.id);
  end loop;
end $$;
