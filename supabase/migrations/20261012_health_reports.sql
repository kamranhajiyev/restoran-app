-- The nightly health check, kept in the database for the superadmin page.
--
-- 20261004_nightly_health_check.sql messages Telegram for two restaurants. This
-- also checks every restaurant each night at 05:00 Baku (01:00 UTC, after the
-- latest closing time, so a normal evening's open orders are not problems) and
-- saves the result, "all good" included, so the superadmin page can show each
-- night. The superadmin can also run it now. Telegram stays as it is.

create table if not exists public.health_reports (
  id bigint generated always as identity primary key,
  run_at timestamptz not null default now(),
  -- [{ company, problem, order_number, at, count }]: one per order (its worst
  -- problem), then the restaurant-wide ones (order_number null).
  problems jsonb not null default '[]'::jsonb
);

alter table public.health_reports enable row level security;
revoke all on public.health_reports from anon, authenticated;
grant select on public.health_reports to authenticated;

drop policy if exists health_reports_select on public.health_reports;
create policy health_reports_select on public.health_reports for select
  to authenticated using (is_superadmin());

-- Restaurant-wide checks, for the report only (Telegram keeps health_check's
-- four). Each is reported every night until it is gone.
create or replace function public.health_check_restaurants()
returns table (company text, problem text, order_number integer, at timestamptz, count integer)
language sql
stable
set search_path = public
as $$
  with c as (select id, name, expires_at from companies where active and trashed_at is null)

  -- A cash shift nobody closed for a day: the next day's money lands in it.
  select c.name, 'shift open > 24h', null::integer, s.opened_at, null::integer
  from cash_shifts s join c on c.id = s.company_id
  where s.closed_at is null and s.opened_at < now() - interval '24 hours'

  union all

  -- Kitchen tickets from the last day that never printed (failed, or still
  -- waiting after 10 minutes): the kitchen never saw those dishes.
  select c.name, 'tickets not printed', null, max(j.created_at), count(*)::integer
  from print_jobs j join c on c.id = j.company_id
  where j.status in ('failed', 'pending')
    and j.created_at > now() - interval '25 hours'
    and j.created_at < now() - interval '10 minutes'
  group by c.name

  union all

  -- The paid-until date ends within a week.
  select c.name, 'expires soon', null, c.expires_at, null
  from c
  where c.expires_at is not null and c.expires_at > now() and c.expires_at < now() + interval '7 days'

  union all

  -- Sold in the week before, nothing in the last day: the till may be down.
  select c.name, 'no orders today', null, now(), null
  from c
  where exists (select 1 from orders o where o.company_id = c.id
                  and o.created_at > now() - interval '8 days' and o.created_at < now() - interval '24 hours')
    and not exists (select 1 from orders o where o.company_id = c.id
                      and o.created_at > now() - interval '24 hours')
$$;

revoke all on function public.health_check_restaurants() from public, anon, authenticated;

-- Same order rows as the Telegram message: a stuck payment every night until
-- fixed, everything else only if it is from the last 25 hours; one line per
-- order. Then the restaurant-wide checks.
create or replace function public.save_health_report()
returns public.health_reports
language plpgsql
security definer
set search_path = public
as $$
declare r public.health_reports;
begin
  -- The nightly job has no signed-in user; anyone signed in must be the superadmin.
  if auth.uid() is not null and not public.is_superadmin() then
    raise exception 'superadmin_only' using errcode = '42501';
  end if;

  insert into health_reports (problems)
  select coalesce(jsonb_agg(jsonb_build_object(
           'company', company, 'problem', problem, 'order_number', order_number, 'at', at, 'count', count)
         order by company, at), '[]'::jsonb)
  from (
    select company, problem, order_number, at, null::integer as count
    from (
      select company, problem, order_number, at,
             row_number() over (
               partition by company, coalesce(order_number::text, at::text)
               order by case problem when 'stuck payment' then 1 when 'unfinished write' then 2
                                     when 'no items' then 3 else 4 end) as pick
      from public.health_check(null)
      where problem = 'stuck payment' or at > now() - interval '25 hours'
    ) o
    where pick = 1
    union all
    select company, problem, order_number, at, count from public.health_check_restaurants()
  ) x
  returning * into r;

  delete from health_reports where run_at < now() - interval '60 days';
  return r;
end $$;

revoke all on function public.save_health_report() from public, anon;
grant execute on function public.save_health_report() to authenticated, service_role;

select cron.unschedule('nightly-health-report')
where exists (select 1 from cron.job where jobname = 'nightly-health-report');
select cron.schedule('nightly-health-report', '0 1 * * *', $$select public.save_health_report()$$);
