-- Per-company branding: logo + accent color.
-- Mirrors the existing owner-scoped setter pattern (e.g. set_qr_enabled):
-- RLS blocks owners from writing to `companies` directly, so writes go through
-- security-definer RPCs scoped to the caller's own company via profiles.company_id.

alter table public.companies
  add column if not exists logo_url    text,
  add column if not exists brand_color text not null default 'teal';

create or replace function public.set_logo_url(url text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.companies
     set logo_url = nullif(url, '')
   where id = (select company_id from public.profiles where id = auth.uid());
$$;

create or replace function public.set_brand_color(c text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.companies
     set brand_color = coalesce(nullif(c, ''), 'teal')
   where id = (select company_id from public.profiles where id = auth.uid());
$$;

grant execute on function public.set_logo_url(text)    to authenticated;
grant execute on function public.set_brand_color(text) to authenticated;
