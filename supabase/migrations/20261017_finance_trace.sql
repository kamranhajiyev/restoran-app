-- Maliyyə: nothing about money disappears without a trace.
--
-- A deleted line was gone for good, and an account's starting balance could be
-- changed with nothing to show it. Now a line is only marked deleted (who,
-- when) and stays in the Silinənlər list, and every change to an account is
-- written on the account. The database writes both itself, with the name of
-- the signed-in user, so the browser cannot skip it or sign another name.

alter table public.finance_transactions
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by text;

alter table public.finance_accounts
  add column if not exists edits jsonb not null default '[]'::jsonb;

-- A line can be marked deleted, never erased or rewritten. An account's
-- history cannot be written from the browser at all.
revoke delete, update on public.finance_transactions from authenticated;
grant update (deleted_at, deleted_by) on public.finance_transactions to authenticated;
revoke update on public.finance_accounts from authenticated;
grant update (name, kind, opening_balance, active) on public.finance_accounts to authenticated;

create or replace function public.finance_transaction_trace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.deleted_at is not null then
    -- Deleted stays deleted, by whom and when it was.
    new.deleted_at := old.deleted_at;
    new.deleted_by := old.deleted_by;
  elsif new.deleted_at is not null then
    new.deleted_at := now();
    new.deleted_by := coalesce((select name from profiles where id = auth.uid()), new.deleted_by);
  end if;
  return new;
end $$;

drop trigger if exists finance_transaction_trace on public.finance_transactions;
create trigger finance_transaction_trace before update on public.finance_transactions
  for each row execute function public.finance_transaction_trace();

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

drop trigger if exists finance_account_trace on public.finance_accounts;
create trigger finance_account_trace before update on public.finance_accounts
  for each row execute function public.finance_account_trace();

revoke all on function public.finance_transaction_trace() from public, anon, authenticated;
revoke all on function public.finance_account_trace() from public, anon, authenticated;
