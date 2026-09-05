-- Kuryerlər: the riders who take food out of the building.
--
-- A courier walks out with a 30 ₼ order and comes back with the money — this
-- evening, or three days later. Until now the till had no idea any of that
-- happened: the order went out as a Takeaway and nobody behind the counter knew
-- how much any courier was holding. The owner found out when cash went missing.
--
-- A courier order closes one of two ways. The guest paid at the till: ordinary
-- cash/card, nothing owed. Or the courier collects on delivery: the order closes
-- with cash=0 and card=0, and the whole discounted total is recorded as that
-- courier's debt. Nothing enters the drawer at that moment, so the shift's
-- expected cash stays honest; the money appears later, when a seller takes it
-- off the courier and add_courier_payment books it as a drawer movement.
--
-- ── Why no balance column ────────────────────────────────────────────────────
-- The balance is derived, never stored:
--
--   outstanding = sum(orders.courier_debt) where status = 'ödənilib'
--               - sum(courier_payments.amount)
--
-- That single choice is what makes "the customer refused the food" free. A
-- returned order simply stops being 'ödənilib' and its debt leaves the sum —
-- no compensating row to write, none to half-write, and restoring the order
-- restores the debt with it. The price is that EVERY query computing courier
-- debt must carry the status = 'ödənilib' predicate. Leave it out of one and
-- cancelled deliveries start being chased for money that no longer exists.

create table if not exists public.couriers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name       text not null,
  phone      text,
  active     boolean not null default true,
  -- Couriers are a name list today, not accounts. This is where a login gets
  -- attached the day they need one, without a second migration.
  staff_id   uuid references public.staff(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (company_id, name)
);

create index if not exists couriers_company_idx on public.couriers (company_id);

alter table public.couriers enable row level security;
drop policy if exists couriers_all on public.couriers;
create policy couriers_all on public.couriers for all
  using      ((company_id = get_my_company_id()) or is_superadmin())
  with check ((company_id = get_my_company_id()) or is_superadmin());

-- ── Orders ───────────────────────────────────────────────────────────────────
-- courier_id alone marks a courier order — table_id already separates masa from
-- everything else, and a second denormalised marker could only ever disagree
-- with the first. courier_debt says how much of THIS order the courier is
-- holding: 0 when the guest paid at the till.
--
-- on delete restrict, not cascade: a courier with delivery history must not be
-- deletable in a way that silently rewrites the books. The panel turns this
-- violation into "bu kuryerin sifarişləri var" and offers deactivation instead.
alter table public.orders
  add column if not exists courier_id   uuid references public.couriers(id) on delete restrict,
  add column if not exists courier_debt numeric not null default 0;

create index if not exists orders_courier_idx
  on public.orders (company_id, courier_id)
  where courier_id is not null;

-- ── Payments ─────────────────────────────────────────────────────────────────
-- created_by is the seller who physically took the cash; shift_id is the drawer
-- it went into. Both exist so that a courier settlement can be traced back to a
-- person and a till, which is the entire point of recording it.
create table if not exists public.courier_payments (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  courier_id uuid not null references public.couriers(id) on delete restrict,
  amount     numeric not null check (amount > 0),
  created_by text,
  staff_id   uuid references public.staff(id) on delete set null,
  shift_id   uuid references public.cash_shifts(id) on delete set null,
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists courier_payments_courier_idx
  on public.courier_payments (company_id, courier_id, created_at desc);

alter table public.courier_payments enable row level security;
drop policy if exists courier_payments_select on public.courier_payments;
create policy courier_payments_select on public.courier_payments for select
  using ((company_id = get_my_company_id()) or is_superadmin());
-- No write policy on purpose: every insert goes through add_courier_payment,
-- which is the only place the overpay check and the drawer movement live.

-- ── The one definition of "what this courier owes" ───────────────────────────
-- Deliberately SECURITY INVOKER. Under RLS an authenticated caller only ever
-- sums their own company's rows, so a guessed courier id from another company
-- answers 0 rather than leaking a balance. Called from inside the SECURITY
-- DEFINER function below it runs as the owner and sees everything, which is
-- what the overpay check needs.
create or replace function public.courier_outstanding(p_courier_id uuid)
returns numeric
language sql
stable
set search_path to 'public'
as $function$
  select coalesce((select sum(o.courier_debt) from orders o
                    where o.courier_id = p_courier_id
                      and o.status = 'ödənilib'), 0)
       - coalesce((select sum(p.amount) from courier_payments p
                    where p.courier_id = p_courier_id), 0);
$function$;

revoke all on function public.courier_outstanding(uuid) from public;
grant execute on function public.courier_outstanding(uuid) to authenticated, service_role;

-- ── Taking money off a courier ───────────────────────────────────────────────
-- The payment row and the drawer movement are written in one transaction. Split
-- them and a settlement that half-succeeds leaves the drawer short at close with
-- nothing to explain it.
--
-- p_id is minted by the till, so a replayed request — the offline outbox
-- resending, a double-tap — returns the original id instead of paying twice.
--
-- The company is read off the courier. An authenticated caller is then checked
-- against their own; a service-role caller (auth.uid() is null) is trusted,
-- because it can only arrive here through a route that has already verified the
-- terminal's seller token.
create or replace function public.add_courier_payment(
  p_courier_id uuid,
  p_amount     numeric,
  p_created_by text default null,
  p_staff_id   uuid default null,
  p_shift_id   uuid default null,
  p_note       text default null,
  p_id         uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid   uuid;
  pid   uuid := coalesce(p_id, gen_random_uuid());
  uname text;
  debt  numeric;
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

  insert into courier_payments (id, company_id, courier_id, amount, created_by, staff_id, shift_id, note)
  values (pid, cid, p_courier_id, p_amount, coalesce(nullif(p_created_by,''), uname), p_staff_id,
          p_shift_id, nullif(p_note,''));

  -- The cash is in the drawer now, so the shift has to know. The movement
  -- carries the payment's own id, which is also the till's replay key — so a
  -- resend cannot append a second movement for the same money.
  if p_shift_id is not null then
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

revoke all on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid) from public;
grant execute on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid) to authenticated, service_role;

-- ── The food came back ───────────────────────────────────────────────────────
-- "A paid order is final" holds everywhere else in this system, and cancelOrder
-- guards it with .neq('status','ödənilib'). A courier-debt order is closed but
-- unpaid — the customer refused the food and the rider carried it home — so it
-- needs a way out. This is that hole in the rule, and it is kept as narrow as it
-- can be: only an 'ödənilib' order that still carries courier debt. Anything
-- else raises, so this can never become a general "un-pay an order" tool.
create or replace function public.cancel_courier_order(
  p_order_id text,
  p_reason   text,
  p_by       text
) returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid; rows int;
begin
  select company_id into cid from orders where id = p_order_id;
  if cid is null then raise exception 'bad_order'; end if;
  if auth.uid() is not null and cid <> coalesce(get_my_company_id(), '00000000-0000-0000-0000-000000000000'::uuid)
     and not is_superadmin() then
    raise exception 'no_company';
  end if;

  update orders
     set status = 'ləğv edildi',
         cancelled_at = now(),
         cancelled_by = p_by,
         cancel_reason = p_reason
   where id = p_order_id
     and status = 'ödənilib'
     and courier_id is not null
     and courier_debt > 0;
  get diagnostics rows = row_count;

  -- Already returned once: answer true so a replayed request does not read as
  -- a failure on the till, the same reasoning as /api/cancel-order.
  if rows = 0 then
    return exists (select 1 from orders
                    where id = p_order_id and status = 'ləğv edildi' and courier_id is not null);
  end if;
  return true;
end $function$;

revoke all on function public.cancel_courier_order(text, text, text) from public;
grant execute on function public.cancel_courier_order(text, text, text) to authenticated, service_role;

-- The seller panel watches couriers so a name added in the admin panel reaches
-- the till without a reload.
do $$
begin
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'couriers')
  then alter publication supabase_realtime add table public.couriers; end if;
end $$;
