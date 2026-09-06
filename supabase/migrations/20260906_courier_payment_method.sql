-- Nağd or kart, when the courier settles up.
--
-- 20260905_couriers.sql assumed one answer: the rider empties their pocket and
-- the cash goes in the drawer. Half the deliveries in practice are paid by card
-- — the guest taps the rider's terminal — and that money never touches the till.
-- Booking it as a drawer movement made the shift's expected cash too high by
-- exactly the card takings, and a seller counting the drawer at close came up
-- short with nothing to explain it.
--
-- So the method is recorded, and it decides one thing: whether a drawer movement
-- is written. The debt drops either way — the courier is square once the money
-- has reached the restaurant, by whichever road.
--
-- Existing rows default to 'nağd', which is what they were: before this column
-- there was no way to take anything else.
alter table public.courier_payments
  add column if not exists method text not null default 'nağd';

do $$ begin
  alter table public.courier_payments
    add constraint courier_payments_method_check check (method in ('nağd', 'kart'));
exception when duplicate_object then null; end $$;

-- The 7-argument version is dropped rather than left beside this one. Two
-- overloads separated only by a defaulted trailing argument make every named-arg
-- call from PostgREST ambiguous, and the failure would look like the feature
-- simply not working.
drop function if exists public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid);

create or replace function public.add_courier_payment(
  p_courier_id uuid,
  p_amount     numeric,
  p_created_by text default null,
  p_staff_id   uuid default null,
  p_shift_id   uuid default null,
  p_note       text default null,
  p_id         uuid default null,
  p_method     text default 'nağd'
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

  select name into uname from profiles where id = auth.uid();

  insert into courier_payments (id, company_id, courier_id, amount, created_by, staff_id, shift_id, note, method)
  values (pid, cid, p_courier_id, p_amount, coalesce(nullif(p_created_by,''), uname), p_staff_id,
          p_shift_id, nullif(p_note,''), meth);

  -- Cash only. A card settlement is money the restaurant has received but not
  -- money in this drawer, so the shift must not count it — see the header.
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

revoke all on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text) from public;
grant execute on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text) to authenticated, service_role;
