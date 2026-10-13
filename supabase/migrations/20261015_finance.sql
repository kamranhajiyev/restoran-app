-- Maliyyə: the owner's money accounts (admin page only).
--
-- Accounts (Kassa, Seyf, a bank card, anything the owner names), what the owner
-- enters by hand (income, expense, transfer; inkassasiya is a transfer), and
-- which account a closed shift's cash and card money goes to. Shift money is
-- not copied here: the admin page reads it from cash_shifts (lib/finance.ts),
-- so the till writes nothing new and a corrected shift corrects the account.
--
-- Only the owner (or the superadmin) reads or writes any of it. A cashier or
-- kitchen login gets nothing, and neither does the public key.

create table if not exists public.finance_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('cash', 'card', 'bank')),
  opening_balance numeric(14,2) not null default 0,
  -- Off: gone from the pickers, kept in the history and the balances.
  active boolean not null default true,
  created_by text,
  created_at timestamptz not null default now(),
  -- So a transaction can only point at an account of its own company.
  unique (id, company_id)
);

create unique index if not exists finance_accounts_name
  on public.finance_accounts (company_id, lower(btrim(name)));

create table if not exists public.finance_transactions (
  -- The screen picks the id, so a save pressed again is kept once.
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense', 'transfer')),
  account_id uuid not null,
  to_account_id uuid,
  amount numeric(14,2) not null check (amount > 0),
  category text check (char_length(category) <= 60),
  note text check (char_length(note) <= 300),
  happened_at timestamptz not null default now(),
  created_by text,
  created_at timestamptz not null default now(),
  foreign key (account_id, company_id) references public.finance_accounts (id, company_id),
  foreign key (to_account_id, company_id) references public.finance_accounts (id, company_id),
  -- A transfer has a second account, and nothing else has one.
  check ((kind = 'transfer') = (to_account_id is not null)),
  check (to_account_id is distinct from account_id)
);

create index if not exists finance_transactions_company_at
  on public.finance_transactions (company_id, happened_at desc);

-- Which account takes a closed shift's cash or card money, from when. Rows are
-- only added: changing the account keeps earlier shifts where they were, and a
-- row with no account means "nowhere from now on".
create table if not exists public.finance_sources (
  id bigint generated always as identity primary key,
  company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check (kind in ('cash', 'card')),
  account_id uuid,
  from_at timestamptz not null default now(),
  created_by text,
  foreign key (account_id, company_id) references public.finance_accounts (id, company_id)
);

create index if not exists finance_sources_company on public.finance_sources (company_id, kind, from_at);

alter table public.finance_accounts enable row level security;
alter table public.finance_transactions enable row level security;
alter table public.finance_sources enable row level security;

revoke all on public.finance_accounts, public.finance_transactions, public.finance_sources from anon, authenticated;
grant select, insert, update, delete on public.finance_accounts, public.finance_transactions to authenticated;
grant select, insert on public.finance_sources to authenticated;

drop policy if exists finance_accounts_owner on public.finance_accounts;
create policy finance_accounts_owner on public.finance_accounts for all to authenticated
  using ((company_id = get_my_owner_company_id()) or is_superadmin())
  with check ((company_id = get_my_owner_company_id()) or is_superadmin());

drop policy if exists finance_transactions_owner on public.finance_transactions;
create policy finance_transactions_owner on public.finance_transactions for all to authenticated
  using ((company_id = get_my_owner_company_id()) or is_superadmin())
  with check ((company_id = get_my_owner_company_id()) or is_superadmin());

drop policy if exists finance_sources_select on public.finance_sources;
create policy finance_sources_select on public.finance_sources for select to authenticated
  using ((company_id = get_my_owner_company_id()) or is_superadmin());

drop policy if exists finance_sources_insert on public.finance_sources;
create policy finance_sources_insert on public.finance_sources for insert to authenticated
  with check ((company_id = get_my_owner_company_id()) or is_superadmin());
