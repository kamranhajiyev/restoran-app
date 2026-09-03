-- Writes the till made offline arrive late, and sometimes twice.
--
-- A queued payment is sent when the line returns; if the reply is lost on the
-- way back, the till still has the entry and sends it again. Without a record
-- of what has already been applied, the guest is charged twice and the shift
-- never balances.
--
-- Every till write now carries an Idempotency-Key. The API route claims the key
-- here first: winning the insert means "nobody has done this yet, go ahead",
-- losing it means the work is already done and the stored reply is returned
-- unchanged.

create table if not exists public.applied_mutations (
  key         text primary key,
  company_id  uuid not null references public.companies(id) on delete cascade,
  route       text not null,
  result      jsonb,
  applied_at  timestamptz not null default now()
);

-- The only query shape: the sweep below.
create index if not exists applied_mutations_applied_at_idx
  on public.applied_mutations (applied_at);

-- Written and read only by the service-role API routes, never by a till.
alter table public.applied_mutations enable row level security;

-- A key is only useful for as long as a till might retry it. A queue that has
-- been stranded for a week is a support case, not a replay, so the table is not
-- allowed to grow forever.
create or replace function public.prune_applied_mutations()
returns void
language sql
security definer
set search_path = public, extensions
as $$
  delete from public.applied_mutations where applied_at < now() - interval '30 days';
$$;
