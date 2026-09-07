-- Çatdırılma as a module the owner switches on, not something the data decides.
--
-- The seller panel used to work delivery out for itself: the Çatdırılma tile and
-- the Kuryerlər tab appeared because the company happened to have courier rows.
-- So a venue that added one rider to try it could never take the option back off
-- the sales screen without deleting them, and an owner who does not deliver at
-- all had no switch to say so. Masalar, Kassa, çek çapı and səs are all a boolean
-- on the companies row; delivery joins them.
--
-- Default true: every venue already delivering keeps its screens exactly as they
-- are the moment this ships. Off is a decision someone makes, not a migration.
alter table public.companies
  add column if not exists delivery_enabled boolean not null default true;

-- RLS makes companies superadmin-only for UPDATE, so the owner toggles through
-- an RPC — same shape as set_sound_enabled / set_kassa_enabled.
create or replace function public.set_delivery_enabled(enabled boolean)
returns void language sql security definer set search_path = public as $$
  update public.companies set delivery_enabled = enabled
   where id = (select company_id from public.profiles
                where id = auth.uid() and role = 'owner');
$$;
grant execute on function public.set_delivery_enabled(boolean) to authenticated;
