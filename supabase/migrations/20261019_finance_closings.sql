-- Maliyyə: a month that has ended is closed.
--
-- Every balance was counted from every shift and every line since the first
-- day, each time the page opened, and a shift corrected in Kassa changed the
-- numbers of a month long over. Now a finished month is saved once: its lines,
-- and what each account had gained or lost by its end (lib/finance.ts counts
-- it, the admin page saves it). The page reads the newest closing and what
-- came after it. A closing is written once and never changed, and nothing can
-- be written into, or deleted from, a closed month.

create table if not exists public.finance_closings (
  company_id uuid not null references public.companies(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  -- The month's end: everything before it is closed.
  until timestamptz not null,
  -- Per account: what it gained or lost before "until" (its starting balance is not in it).
  moved jsonb not null default '{}'::jsonb,
  -- The last shift counted before "until": the next opening is compared with it.
  carry jsonb,
  -- The month's own lines.
  entries jsonb not null default '[]'::jsonb,
  closed_at timestamptz not null default now(),
  closed_by text,
  primary key (company_id, month)
);

alter table public.finance_closings enable row level security;

revoke all on public.finance_closings from anon, authenticated;
grant select, insert on public.finance_closings to authenticated;

drop policy if exists finance_closings_select on public.finance_closings;
create policy finance_closings_select on public.finance_closings for select to authenticated
  using ((company_id = get_my_owner_company_id()) or is_superadmin());

drop policy if exists finance_closings_insert on public.finance_closings;
create policy finance_closings_insert on public.finance_closings for insert to authenticated
  with check ((company_id = get_my_owner_company_id()) or is_superadmin());

-- Months close in order, and only once the month after them is over too
-- (28 days is the shortest month): the owner keeps that long to explain
-- unwritten cash.
create or replace function public.finance_closing_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from finance_closings c where c.company_id = new.company_id and c.month = new.month) then
    -- The same month sent again (a second tab): the primary key keeps the first.
    return new;
  end if;
  if new.until > now() - interval '28 days' then
    raise exception 'finance month % is not over long enough to close', new.month using errcode = 'FN002';
  end if;
  if exists (select 1 from finance_closings c
             where c.company_id = new.company_id and (c.month >= new.month or c.until >= new.until)) then
    raise exception 'finance month % is behind a closed month', new.month using errcode = 'FN002';
  end if;
  new.closed_at := now();
  new.closed_by := coalesce((select name from profiles where id = auth.uid()), new.closed_by);
  return new;
end $$;

drop trigger if exists finance_closing_order on public.finance_closings;
create trigger finance_closing_order before insert on public.finance_closings
  for each row execute function public.finance_closing_order();

-- A closed month takes no new line and loses none.
create or replace function public.finance_closed_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  closed timestamptz := (select max(until) from finance_closings where company_id = new.company_id);
begin
  if closed is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.happened_at < closed then
      raise exception 'finance month is closed' using errcode = 'FN001';
    end if;
  elsif old.deleted_at is null and new.deleted_at is not null and old.happened_at < closed then
    raise exception 'finance month is closed' using errcode = 'FN001';
  end if;
  return new;
end $$;

drop trigger if exists finance_closed_guard on public.finance_transactions;
create trigger finance_closed_guard before insert or update on public.finance_transactions
  for each row execute function public.finance_closed_guard();

revoke all on function public.finance_closing_order() from public, anon, authenticated;
revoke all on function public.finance_closed_guard() from public, anon, authenticated;
