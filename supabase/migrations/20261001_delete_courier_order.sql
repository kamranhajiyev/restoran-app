-- Deleting a courier order the courier has already paid for.
--
-- The debt is derived (see 20260905_couriers.sql): a delivery counts only while
-- it is 'ödənilib'. So deleting one takes its debt away by itself — but the
-- settlement that paid it off stays, and the courier ends up owed money. That is
-- what happened at Test Restoran on 2026-10-01: #3482 carried 15 ₼, the rider
-- handed over 15 ₼ in cash, the order was deleted, and the balance read -15
-- while the drawer still held the 15.
--
-- Payments are recorded against the courier, not against an order, so there is
-- no row that says "this 15 was for #3482". What can be said is how far below
-- zero the delete pushed the balance — capped at this order's own debt, so an
-- older overpayment is not swept up with it. That much is taken back off the
-- newest settlements first: a whole payment goes through delete_courier_payment,
-- which also pulls its cash out of the drawer; a payment larger than what is
-- left is trimmed, and its drawer movement trimmed with it.
--
-- Restoring the order afterwards is the plain status flip it always was: the
-- debt comes back, and since the money was handed back too, that is correct.

create or replace function public.delete_order(
  p_order_id text,
  p_by       text default null
) returns numeric
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  ord    public.orders%rowtype;
  pay    public.courier_payments%rowtype;
  cid    uuid;
  who    text;
  excess numeric;
  undone numeric := 0;
  take   numeric;
begin
  select * into ord from orders where id = p_order_id for update;
  if ord.id is null then raise exception 'bad_order'; end if;

  select company_id into cid from profiles where id = auth.uid() and role = 'owner';
  if not coalesce(is_superadmin(), false) and (cid is null or cid <> ord.company_id) then
    raise exception 'not_allowed';
  end if;

  if ord.status = 'silinib' then return 0; end if;

  -- Same lock add_courier_payment takes, so a till settling this courier right
  -- now cannot slip a payment in between the balance read and the undo.
  if ord.courier_id is not null then
    perform 1 from couriers where id = ord.courier_id for update;
  end if;

  update orders set status = 'silinib' where id = p_order_id;

  if ord.courier_id is null or ord.status <> 'ödənilib' or coalesce(ord.courier_debt, 0) <= 0 then
    return 0;
  end if;

  -- Rounded: courier_debt sums carry float residue (19.799999999999997), and a
  -- balance of -0.000000000000003 is not money anyone handed over.
  excess := least(round(ord.courier_debt, 2), round(-courier_outstanding(ord.courier_id), 2));
  if excess <= 0 then return 0; end if;

  who := coalesce(nullif(p_by, ''), (select name from profiles where id = auth.uid()), '');

  for pay in
    select * from courier_payments
     where courier_id = ord.courier_id
     order by created_at desc
  loop
    exit when excess - undone <= 0;
    take := least(pay.amount, excess - undone);

    if take >= pay.amount then
      perform delete_courier_payment(pay.id, who);
    else
      update courier_payments set amount = amount - take where id = pay.id;
      if pay.method = 'nağd' and pay.shift_id is not null and exists (
        select 1 from cash_shifts s, jsonb_array_elements(s.movements) m
         where s.id = pay.shift_id and m->>'id' = pay.id::text)
      then
        perform update_shift_movement(pay.shift_id, pay.id::text,
          pay.amount - take, 'Kuryer ödənişi', who);
      end if;
    end if;

    undone := undone + take;
  end loop;

  return undone;
end $function$;

revoke all on function public.delete_order(text, text) from public;
grant execute on function public.delete_order(text, text) to authenticated;
