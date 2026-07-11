-- Order alerts: the seller/kitchen screens beep when a new order arrives and
-- play a different sound when an item is pulled from an open order. Fallback
-- for venues whose station printers aren't wired up yet.

alter table public.companies
  add column if not exists sound_enabled boolean not null default true;

-- RLS makes companies superadmin-only for UPDATE, so the owner toggles through
-- an RPC — same shape as set_kassa_enabled / set_brand_color.
create or replace function public.set_sound_enabled(enabled boolean)
returns void language sql security definer set search_path = public as $$
  update public.companies set sound_enabled = enabled
   where id = (select company_id from public.profiles
                where id = auth.uid() and role = 'owner');
$$;
grant execute on function public.set_sound_enabled(boolean) to authenticated;

-- Without this a realtime DELETE payload carries only the primary key, so a
-- subscriber can't tell which order lost an item.
alter table public.order_items replica identity full;
