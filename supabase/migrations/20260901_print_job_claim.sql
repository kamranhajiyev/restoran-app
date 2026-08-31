-- Claiming a print job, so the POS itself can drive the kitchen printers.
--
-- Until now exactly one process (agent/) drained print_jobs, and it was kept
-- honest by a rule in a README: "run only one agent per restaurant". That rule
-- cannot survive the desktop app, where every register runs the same code and
-- any of them may be the one nearest the kitchen printer. Two registers reading
-- `status = 'pending'` at the same moment would both send the same ticket, and a
-- cook cannot tell a duplicate from a real second order.
--
-- So a job is now *claimed* before it is printed: one statement moves it out of
-- 'pending' and hands it to exactly one caller. FOR UPDATE SKIP LOCKED is what
-- makes that safe — a second register racing the first skips the locked row
-- instead of waiting for it and printing it twice.

alter table public.print_jobs drop constraint if exists print_jobs_status_check;
alter table public.print_jobs add constraint print_jobs_status_check
  check (status in ('pending','printing','printed','failed'));

-- When the claim happened, so a register that dies mid-print can be noticed.
alter table public.print_jobs add column if not exists claimed_at timestamptz;

-- A register that is killed (power cut, app closed, laptop lid) between the
-- claim and the printer's acknowledgement leaves the job stranded in 'printing'
-- forever, and the ticket silently never comes out — the exact failure this
-- whole table exists to prevent. Anything held longer than two minutes is
-- assumed abandoned and goes back in the queue.
-- Scoped to one company: a register sweeping up after itself must not touch
-- another restaurant's rows, however harmless the edit looks.
create or replace function public.requeue_stale_print_jobs(p_company uuid)
returns void language sql security definer set search_path = public as $$
  update public.print_jobs
     set status = 'pending', claimed_at = null
   where company_id = p_company
     and status = 'printing'
     and claimed_at < now() - interval '2 minutes';
$$;

-- Hand the caller up to p_limit jobs and mark them as theirs in the same
-- statement. Company scoping is taken from the caller's own session, never from
-- an argument: the desktop app signs in as an ordinary waiter, and a register
-- must not be able to ask for another restaurant's tickets by passing its id.
create or replace function public.claim_print_jobs(p_limit int default 10)
returns setof public.print_jobs
language plpgsql security definer set search_path = public as $$
declare
  my_company uuid := get_my_company_id();
begin
  if my_company is null then
    return;
  end if;

  perform public.requeue_stale_print_jobs(my_company);

  return query
  update public.print_jobs pj
     set status = 'printing', claimed_at = now()
   where pj.id in (
     select c.id from public.print_jobs c
      where c.company_id = my_company
        and c.status = 'pending'
        and c.attempts < 5
      order by c.created_at
      limit p_limit
      for update skip locked
   )
  returning pj.*;
end $$;

-- Supabase's default privileges hand EXECUTE to anon on every new function, so
-- revoking from PUBLIC is not enough — anon has to be named. A signed-out caller
-- already gets nothing back (get_my_company_id() is null without a JWT), but a
-- SECURITY DEFINER function that writes should not be reachable at all from an
-- unauthenticated key.
revoke all on function public.claim_print_jobs(int) from public, anon;
-- Only ever called from inside claim_print_jobs, which is SECURITY DEFINER and
-- so runs it as the owner. Left callable, it would let any signed-in user pass
-- someone else's company id and requeue that restaurant's in-flight tickets.
revoke all on function public.requeue_stale_print_jobs(uuid) from public, anon, authenticated;
grant execute on function public.claim_print_jobs(int) to authenticated;

-- The old agent selects `status = 'pending'` directly and knows nothing about
-- claiming. Running it alongside the desktop app would reintroduce exactly the
-- duplicate this migration removes, so agent/README.md now says: one or the
-- other, never both.
