-- Every time the superadmin opens a restaurant's admin as its owner ("Bax" on
-- /superadmin). The visit is a real login, so who went in, where and when is
-- kept here. Only the server route (service role) writes; the superadmin reads.

create table if not exists public.view_as_events (
  id bigint generated always as identity primary key,
  superadmin_id uuid references auth.users(id) on delete set null,
  owner_id uuid references auth.users(id) on delete set null,
  company_id uuid references public.companies(id) on delete set null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);

alter table public.view_as_events enable row level security;
revoke all on public.view_as_events from anon, authenticated;
grant select on public.view_as_events to authenticated;

drop policy if exists view_as_events_select on public.view_as_events;
create policy view_as_events_select on public.view_as_events for select
  to authenticated using (is_superadmin());
