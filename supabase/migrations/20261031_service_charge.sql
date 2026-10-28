-- Xidmət haqqı: a percent added on top of the order (2026-10-29).
--
-- A restaurant asked for a service charge: 8% on a 100 ₼ order makes the bill
-- 108 ₼ (lib/service-charge.ts).
--   * the company keeps {on, percent, typeIds} in companies.service_charge,
--     written by the owner through set_service_charge, read like order_types;
--   * an order remembers the percent it was taken under, so changing the
--     percent later does not rewrite old orders. Null on orders without one.
--     The amount is not stored: it is the percent of the dishes, worked out
--     by orderTotal, so it stays right when dishes are added or taken off.

alter table public.companies add column if not exists service_charge jsonb;
-- companies is read column by column (20261008_hide_seller_token.sql).
grant select (service_charge) on public.companies to authenticated;

alter table public.orders add column if not exists service_charge_percent numeric;

-- Owners write companies through functions, like set_order_types.
create or replace function public.set_service_charge(p_charge jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if p_charge is not null and jsonb_typeof(p_charge) <> 'object' then
    raise exception 'bad_charge';
  end if;
  update companies set service_charge = p_charge where id = cid;
end $function$;

revoke execute on function public.set_service_charge(jsonb) from public, anon;
grant execute on function public.set_service_charge(jsonb) to authenticated, service_role;

-- The QR menu shows the guest the total with the Xidmət haqqı, the same 108
-- the bill will say. A percent the bill prints anyway; nothing secret.
-- anon: the QR menu's cart total.
grant select (service_charge) on public.companies to anon;
