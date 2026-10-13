-- Maliyyə: inkassasiya is written at the till, and the accounts make themselves.
--
-- Inkassasiya was a button in Maliyyə, but the cash it takes is in the open
-- shift's drawer, which Maliyyə does not see until the shift closes: written
-- there, the same money came off the account twice (once as inkassasiya, once
-- as the drawer's shortfall). Now the cashier writes it in the open shift, as a
-- cash out with the reason "İnkassasiya", and lib/finance.ts reads it as a
-- transfer from the cash account to the account kept for it. Which account
-- that is sits in finance_sources, like the cash and card ones, so it can be
-- renamed freely and changing it leaves earlier shifts where they were.

alter table public.finance_sources drop constraint if exists finance_sources_kind_check;
alter table public.finance_sources
  add constraint finance_sources_kind_check check (kind in ('cash', 'card', 'inkassasiya'));

-- The accounts every restaurant starts with, made once when the owner first
-- opens Maliyyə: Nağd (shift cash), Bank (shift card money) and İnkassasiya.
-- An owner who already made accounts keeps them and gets only İnkassasiya.
-- The inkassasiya source row is the mark that this ran: with one written,
-- nothing is made again, even after the owner turns it off.
-- Says what it made: 'all', 'inkassasiya' or 'none'.
create or replace function public.finance_defaults(p_company_id uuid, p_by text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce((select name from profiles where id = auth.uid()), p_by);
  cash_id uuid;
  bank_id uuid;
  ink_id uuid;
  made text := 'none';
begin
  -- A cashier has no owner company: the comparison is then null, not false,
  -- and null must refuse too.
  if not coalesce((p_company_id = get_my_owner_company_id()) or is_superadmin(), false) then
    raise exception 'owner_only' using errcode = '42501';
  end if;
  -- Two tabs opening Maliyyə at once make one set of accounts.
  perform pg_advisory_xact_lock(hashtextextended('finance_defaults:' || p_company_id::text, 0));

  if not exists (select 1 from finance_accounts where company_id = p_company_id) then
    insert into finance_accounts (company_id, name, kind, created_by)
      values (p_company_id, 'Nağd', 'cash', who) returning id into cash_id;
    insert into finance_accounts (company_id, name, kind, created_by)
      values (p_company_id, 'Bank', 'bank', who) returning id into bank_id;
    insert into finance_sources (company_id, kind, account_id, created_by)
      values (p_company_id, 'cash', cash_id, who), (p_company_id, 'card', bank_id, who);
    made := 'all';
  end if;

  if not exists (select 1 from finance_sources where company_id = p_company_id and kind = 'inkassasiya') then
    select id into ink_id from finance_accounts
      where company_id = p_company_id and deleted_at is null and lower(btrim(name)) = lower(btrim('İnkassasiya'));
    if ink_id is null then
      insert into finance_accounts (company_id, name, kind, created_by)
        values (p_company_id, 'İnkassasiya', 'cash', who) returning id into ink_id;
    end if;
    insert into finance_sources (company_id, kind, account_id, created_by)
      values (p_company_id, 'inkassasiya', ink_id, who);
    if made = 'none' then
      made := 'inkassasiya';
    end if;
  end if;
  return made;
end $$;

revoke all on function public.finance_defaults(uuid, text) from public, anon;
grant execute on function public.finance_defaults(uuid, text) to authenticated;
