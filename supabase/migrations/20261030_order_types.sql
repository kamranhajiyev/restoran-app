-- Sifariş növləri: order types with their own prices (2026-10-29).
--
-- A restaurant asked for types beside Masa, Takeaway and Çatdırılma (Banket,
-- Glovo…) that move every menu price up or down by manat or percent
-- (lib/order-types.ts). Poster has the types but not the prices.
--   * the company keeps its list in companies.order_types, written by the
--     owner through set_order_types, read like till_rules: admin and the
--     signed-in till from the row, the link till from /api/public-settings,
--     the exe and the APK from their own copy so it holds offline. Masa and
--     Çatdırılma are switched on and off by tables_enabled and
--     delivery_enabled as before; the list only adds their price change;
--   * an order remembers its type and the name it had that day, so a renamed
--     or deleted type does not rewrite history;
--   * a line remembers the menu price beside the price charged
--     (menu_item_price, which every total reads), so admin can show what a type
--     added or took off, and a later "show the discount on the bill" switch
--     needs nothing new. Null on old lines: nothing was changed.

alter table public.companies add column if not exists order_types jsonb;
-- companies is read column by column (20261008_hide_seller_token.sql).
grant select (order_types) on public.companies to authenticated;

alter table public.orders add column if not exists order_type text;
alter table public.orders add column if not exists order_type_name text;

alter table public.order_items add column if not exists menu_price numeric;

-- Owners write companies through functions (RLS keeps direct updates for the
-- superadmin), like set_till_rules.
create or replace function public.set_order_types(p_types jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if p_types is not null and (jsonb_typeof(p_types) <> 'array' or jsonb_array_length(p_types) > 50) then
    raise exception 'bad_types';
  end if;
  update companies set order_types = p_types where id = cid;
end $function$;

revoke execute on function public.set_order_types(jsonb) from public, anon;
grant execute on function public.set_order_types(jsonb) to authenticated, service_role;
