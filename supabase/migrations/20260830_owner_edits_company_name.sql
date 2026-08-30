-- Owners can now rename their own venue from the admin panel, so the profile
-- RPC takes the company name alongside the fields it already wrote.
-- companies UPDATE is superadmin-only under RLS, which is why this stays a
-- security definer function scoped to the caller's own company.

drop function if exists public.set_company_profile(text, text, text);

create or replace function public.set_company_profile(
  name_t text,
  owner_name_t text,
  address_t text,
  phone_t text
)
 returns void
 language sql
 security definer
 set search_path to 'public'
as $function$
  update companies set
    -- A blank name would leave the venue unnamed on the menu, receipts and the
    -- superadmin list, so an empty submission keeps whatever is already there.
    name       = coalesce(nullif(btrim(name_t), ''), name),
    owner_name = owner_name_t,
    address    = address_t,
    phone      = phone_t
  where id = (select company_id from profiles where id = auth.uid() and role = 'owner');
$function$;
