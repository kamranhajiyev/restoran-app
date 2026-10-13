-- Maliyyə: a deleted account leaves a trace too.
--
-- An account nothing pointed at could be erased in one click, and its starting
-- balance left "Cəmi pul" with nothing written. Now an account is only marked
-- deleted (who, when) and stays in Silinənlər. Only an account no line and no
-- shift money ever touched can be deleted; the rest are switched off.

alter table public.finance_accounts
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

revoke delete on public.finance_accounts from authenticated;
grant update (deleted_at, deleted_by) on public.finance_accounts to authenticated;

-- A deleted account's name is free again.
drop index if exists public.finance_accounts_name;
create unique index finance_accounts_name
  on public.finance_accounts (company_id, lower(btrim(name))) where deleted_at is null;

create or replace function public.finance_account_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  who text := coalesce((select name from profiles where id = auth.uid()), 'server');
  e jsonb := '[]'::jsonb;
begin
  if old.deleted_at is not null then
    -- Deleted stays deleted, and as it was.
    return old;
  end if;
  if new.deleted_at is not null then
    if exists (select 1 from finance_transactions t where t.account_id = old.id or t.to_account_id = old.id)
       or exists (select 1 from finance_sources s where s.account_id = old.id) then
      raise exception 'finance account % has history', old.id using errcode = '23503';
    end if;
    new.deleted_at := now();
    new.deleted_by := coalesce((select name from profiles where id = auth.uid()), new.deleted_by);
  end if;
  if new.opening_balance is distinct from old.opening_balance then
    e := e || jsonb_build_object('at', now(), 'by', who, 'field', 'opening_balance', 'from', old.opening_balance, 'to', new.opening_balance);
  end if;
  if new.name is distinct from old.name then
    e := e || jsonb_build_object('at', now(), 'by', who, 'field', 'name', 'from', old.name, 'to', new.name);
  end if;
  if new.kind is distinct from old.kind then
    e := e || jsonb_build_object('at', now(), 'by', who, 'field', 'kind', 'from', old.kind, 'to', new.kind);
  end if;
  if new.active is distinct from old.active then
    e := e || jsonb_build_object('at', now(), 'by', who, 'field', 'active', 'from', old.active, 'to', new.active);
  end if;
  new.edits := old.edits || e;
  return new;
end $$;

-- Nothing new may point at a deleted account.
create or replace function public.finance_account_alive()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- finance_sources has no second account: the lookup is then null.
  if exists (select 1 from finance_accounts a
             where a.deleted_at is not null
               and (a.id = new.account_id or a.id = (to_jsonb(new) ->> 'to_account_id')::uuid)) then
    raise exception 'finance account is deleted' using errcode = '23503';
  end if;
  return new;
end $$;

drop trigger if exists finance_transaction_account_alive on public.finance_transactions;
create trigger finance_transaction_account_alive before insert on public.finance_transactions
  for each row execute function public.finance_account_alive();

drop trigger if exists finance_source_account_alive on public.finance_sources;
create trigger finance_source_account_alive before insert on public.finance_sources
  for each row execute function public.finance_account_alive();

revoke all on function public.finance_account_trace() from public, anon, authenticated;
revoke all on function public.finance_account_alive() from public, anon, authenticated;
