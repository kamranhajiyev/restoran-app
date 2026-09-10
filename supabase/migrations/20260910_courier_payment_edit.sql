-- Correcting a courier settlement that was recorded wrong.
--
-- A seller takes 40 ₼ off a rider and taps Nağd when the guest actually paid by
-- card, or books the handover against the wrong courier, or takes it twice.
-- Until now none of that could be undone by anyone: courier_payments has no
-- write policy on purpose (add_courier_payment is the only insert path), and the
-- order's own cash/card edit is refused while courier_debt sits on it, because
-- payments are recorded against the COURIER, not against a specific order.
--
-- So the correction has to happen on the payment row, and it has to carry the
-- drawer with it. That is the whole difficulty here:
--
--   nağd  → the money went into the till, and a 'Kuryer ödənişi' movement was
--           written for it, carrying the payment's own id.
--   kart  → the guest tapped the rider's terminal. Nothing entered this drawer
--           and no movement exists.
--
-- Change the method and the movement has to appear or disappear to match, or the
-- shift will not balance at close. Delete the payment and the movement goes with
-- it. The debt needs no such care — it is derived (see the header of
-- 20260905_couriers.sql), so removing a payment puts it back by itself.
--
-- Owner-only, and unlike add_courier_payment there is no service-role path: a
-- till never corrects history, an owner sitting in the admin panel does.

-- ── Appending a movement to a shift that may already be closed ───────────────
-- append_shift_movement is fine for a settlement taken at the counter, because
-- the drawer it goes into is open by definition. A correction is not: the owner
-- notices on Thursday that Monday's shift was booked wrong. expected_cash is a
-- snapshot taken at close, so on a closed shift it has to move with the
-- movement — the same reasoning, and the same audit entry, as
-- delete_shift_movement in 20260903_shift_edits.sql.
create or replace function public.append_shift_movement_audited(
  shift_id uuid, movement jsonb, by_name text)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  is_open boolean;
  new_m   jsonb;
begin
  select closed_at is null into is_open from cash_shifts where id = shift_id for update;
  if is_open is null then raise exception 'shift not found'; end if;

  new_m := case when movement ? 'id' then movement
                else movement || jsonb_build_object('id', gen_random_uuid()::text) end;

  update cash_shifts c set
    movements = c.movements || jsonb_build_array(new_m),
    expected_cash = case when is_open then c.expected_cash
                         else c.expected_cash + (new_m->>'amount')::numeric end,
    edits = c.edits || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', by_name, 'action', 'movement_add', 'to', new_m))
  where c.id = shift_id;
end $function$;

-- ── Who is allowed to correct one ────────────────────────────────────────────
-- Returns the payment row, or raises. Both functions below open with this, so
-- there is one definition of "this is mine to fix" rather than two that can
-- drift apart.
create or replace function public.courier_payment_for_edit(p_id uuid)
returns public.courier_payments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pay public.courier_payments%rowtype;
  cid uuid;
begin
  -- Locked for the caller's transaction: two owners on two devices correcting
  -- the same row must not both read the old method and both act on it.
  select * into pay from courier_payments where id = p_id for update;
  if pay.id is null then raise exception 'bad_payment'; end if;

  select company_id into cid from profiles where id = auth.uid() and role = 'owner';
  if not coalesce(is_superadmin(), false) and (cid is null or cid <> pay.company_id) then
    raise exception 'not_allowed';
  end if;
  return pay;
end $function$;

revoke all on function public.courier_payment_for_edit(uuid) from public;

-- ── Nağd ↔ Kart ──────────────────────────────────────────────────────────────
-- The amount is untouched: how much came off the rider is what the seller
-- counted, and the debt does not change. Only the road the money took does, and
-- with it whether this drawer should be able to find it.
create or replace function public.set_courier_payment_method(
  p_id     uuid,
  p_method text,
  p_by     text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pay  public.courier_payments%rowtype;
  meth text := case when p_method = 'kart' then 'kart' else 'nağd' end;
  who  text;
begin
  pay := courier_payment_for_edit(p_id);
  if meth = pay.method then return; end if;

  who := coalesce(nullif(p_by, ''), (select name from profiles where id = auth.uid()), '');

  update courier_payments set method = meth where id = p_id;

  -- No shift means the settlement was taken with no drawer open — there was
  -- never a movement to keep in step, whichever way the method goes.
  if pay.shift_id is null then return; end if;

  if meth = 'nağd' then
    -- Guarded because the owner may have deleted the movement by hand from the
    -- kassa panel; appending a second one would double the drawer.
    if not exists (
      select 1 from cash_shifts s, jsonb_array_elements(s.movements) m
       where s.id = pay.shift_id and m->>'id' = pay.id::text)
    then
      perform append_shift_movement_audited(pay.shift_id, jsonb_build_object(
        'id',     pay.id::text,
        'at',     now(),
        'amount', pay.amount,
        'reason', 'Kuryer ödənişi',
        'by',     coalesce(nullif(pay.created_by, ''), who)
      ), who);
    end if;
  else
    -- Same guard the other way: delete_shift_movement raises when the entry is
    -- already gone, and that must not turn a correct method change into an error.
    if exists (
      select 1 from cash_shifts s, jsonb_array_elements(s.movements) m
       where s.id = pay.shift_id and m->>'id' = pay.id::text)
    then
      perform delete_shift_movement(pay.shift_id, pay.id::text, who);
    end if;
  end if;
end $function$;

revoke all on function public.set_courier_payment_method(uuid, text, text) from public;
grant execute on function public.set_courier_payment_method(uuid, text, text) to authenticated;

-- ── Removing a settlement that never happened ────────────────────────────────
-- The debt comes straight back, with nothing to write: courier_outstanding sums
-- the payment rows, so one fewer row is one more debt. The drawer is the only
-- thing that needs undoing, and only for a cash settlement.
--
-- The row is destroyed rather than flagged, because every query that computes a
-- balance sums courier_payments unconditionally — a soft-deleted row would have
-- to be excluded in each of them, and the one that got missed would keep
-- crediting a rider for money nobody ever took. What survives is the kassa audit
-- entry, which holds the deleted movement in full.
create or replace function public.delete_courier_payment(
  p_id uuid,
  p_by text default null
) returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  pay public.courier_payments%rowtype;
  who text;
begin
  pay := courier_payment_for_edit(p_id);
  who := coalesce(nullif(p_by, ''), (select name from profiles where id = auth.uid()), '');

  if pay.method = 'nağd' and pay.shift_id is not null and exists (
    select 1 from cash_shifts s, jsonb_array_elements(s.movements) m
     where s.id = pay.shift_id and m->>'id' = pay.id::text)
  then
    perform delete_shift_movement(pay.shift_id, pay.id::text, who);
  end if;

  delete from courier_payments where id = p_id;
end $function$;

revoke all on function public.delete_courier_payment(uuid, text) from public;
grant execute on function public.delete_courier_payment(uuid, text) to authenticated;
