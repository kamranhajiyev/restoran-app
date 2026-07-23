-- Web Push subscriptions, so a waiter whose phone is locked or whose tab is in the
-- background still gets a native notification when a sex marks an order ready. A page
-- cannot make a sound in the background — only a pushed OS notification can (see
-- app/api/notify-ready). One row per browser push endpoint.
create table if not exists public.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id) on delete cascade,
  device_id    text,                       -- getDeviceId(): re-subscribing upserts, never piles up
  role         text not null default 'seller',
  endpoint     text not null unique,       -- the push service URL; unique identity of a subscription
  subscription jsonb not null,             -- full PushSubscription (endpoint + keys) for web-push
  created_at   timestamptz not null default now()
);

create index if not exists push_subscriptions_company_role_idx
  on public.push_subscriptions (company_id, role);

alter table public.push_subscriptions enable row level security;

-- Writes and reads happen server-side through the service role (bypasses RLS). The
-- policy still scopes any authed client to its own company and locks everyone else out,
-- consistent with order_station_ready.
drop policy if exists push_subscriptions_all on public.push_subscriptions;
create policy push_subscriptions_all on public.push_subscriptions for all
  using      ((company_id = public.get_my_company_id()) or public.is_superadmin())
  with check ((company_id = public.get_my_company_id()) or public.is_superadmin());
