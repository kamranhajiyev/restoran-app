-- Correcting how one courier order was paid: "it was 1 ₼ cash" → "0.50 cash,
-- 0.50 card".
--
-- An order's courier_cash / courier_card are not stored facts — courier_reallocate
-- (20261002_courier_order_settlement.sql) derives them from courier_payments, so
-- writing them on the order would be undone by the next recompute. The edit has
-- to happen on the payments:
--
--   1. detach — take this order's share off every payment that names it, and
--      drop the order from that payment's order_ids. The payment keeps covering
--      its other orders exactly as before; one left at 0 is deleted.
--   2. re-attach — up to two new payments, nağd and kart, naming only this order,
--      on the same shift and at the same moment as the payment it came from.
--
-- The sum of the courier's payments does not move, so neither does their
-- balance. Only the split does, and with it the drawer: every cash payment
-- carries a 'Kuryer ödənişi' movement under its own id, which is shrunk,
-- removed or added to match — the same guards as set_courier_payment_method.
--
-- A payment taken before order_ids existed names no order. Its share cannot be
-- found here, and the edit is refused (legacy_payment) rather than guessed: the
-- Ödənişlər log can still change that payment as a whole.
--
-- Owner-only, no service-role path: a till never corrects history.

create or replace function public.set_courier_order_split(
  p_order_id text,
  p_cash     numeric,
  p_card     numeric,
  p_by       text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  o     record;
  cid   uuid;
  who   text;
  cash  numeric := round(coalesce(p_cash, 0), 2);
  card  numeric := round(coalesce(p_card, 0), 2);
  meth  text;
  cur_cash numeric;
  cur_card numeric;
  have  numeric;
  take  numeric;
  pay   public.courier_payments%rowtype;
  tmpl  public.courier_payments%rowtype;
  nid   uuid;
  has_m boolean;
begin
  select id, company_id, courier_id, status into o from orders where id = p_order_id;
  if o.id is null or o.courier_id is null then raise exception 'bad_order'; end if;

  select company_id into cid from profiles where id = auth.uid() and role = 'owner';
  if not coalesce(is_superadmin(), false) and (cid is null or cid <> o.company_id) then
    raise exception 'not_allowed';
  end if;
  if o.status <> 'ödənilib' then raise exception 'bad_order'; end if;

  -- Serialise against a till settling this courier at the same moment, then
  -- read the split under the lock.
  perform 1 from couriers where id = o.courier_id for update;
  select courier_cash, courier_card into cur_cash, cur_card from orders where id = p_order_id;

  if cash < 0 or card < 0 or cur_cash + cur_card <= 0
     or abs(cash + card - (cur_cash + cur_card)) > 0.005 then
    raise exception 'bad_amount';
  end if;
  if abs(cash - cur_cash) <= 0.005 then return; end if;

  who := coalesce(nullif(p_by, ''), (select name from profiles where id = auth.uid()), '');

  -- 1. Detach, one method at a time.
  foreach meth in array array['nağd', 'kart'] loop
    have := case when meth = 'nağd' then cur_cash else cur_card end;

    for pay in
      select * from courier_payments
      where courier_id = o.courier_id and method = meth and p_order_id = any(order_ids)
      order by created_at, id
      for update
    loop
      exit when have <= 0.005;
      take := least(have, pay.amount);
      if tmpl.id is null then tmpl := pay; end if;

      has_m := pay.shift_id is not null and exists (
        select 1 from cash_shifts s, jsonb_array_elements(s.movements) m
         where s.id = pay.shift_id and m->>'id' = pay.id::text);

      if pay.amount - take <= 0.005 then
        if meth = 'nağd' and has_m then
          perform delete_shift_movement(pay.shift_id, pay.id::text, who);
        end if;
        delete from courier_payments where id = pay.id;
      else
        update courier_payments
           set amount = amount - take, order_ids = array_remove(order_ids, p_order_id)
         where id = pay.id;
        if meth = 'nağd' and has_m then
          perform update_shift_movement(pay.shift_id, pay.id::text, pay.amount - take, 'Kuryer ödənişi', who);
        end if;
      end if;
      have := have - take;
    end loop;

    if have > 0.005 then raise exception 'legacy_payment'; end if;
  end loop;

  -- 2. Re-attach.
  foreach meth in array array['nağd', 'kart'] loop
    take := case when meth = 'nağd' then cash else card end;
    continue when take <= 0.005;

    nid := gen_random_uuid();
    insert into courier_payments (id, company_id, courier_id, amount, created_by, staff_id, shift_id, note, method, order_ids, created_at)
    values (nid, tmpl.company_id, tmpl.courier_id, take, tmpl.created_by, tmpl.staff_id, tmpl.shift_id,
            tmpl.note, meth, array[p_order_id], tmpl.created_at);

    if meth = 'nağd' and tmpl.shift_id is not null then
      perform append_shift_movement_audited(tmpl.shift_id, jsonb_build_object(
        'id',     nid::text,
        'at',     tmpl.created_at,
        'amount', take,
        'reason', 'Kuryer ödənişi',
        'by',     coalesce(nullif(tmpl.created_by, ''), who)
      ), who);
    end if;
  end loop;
end $function$;

revoke all on function public.set_courier_order_split(text, numeric, numeric, text) from public, anon;
grant execute on function public.set_courier_order_split(text, numeric, numeric, text) to authenticated;
