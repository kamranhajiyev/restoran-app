-- company_order_counters had no row level security: anyone holding the public
-- anon key could read every company's counter or reset it, and the next orders
-- would reuse old numbers.
--
-- Only assign_order_number touches the table, but it ran as whoever inserted
-- the order — which is why switching RLS on by itself used to break numbering.
-- It now runs as its owner, so the table can be closed to everyone else.
alter function public.assign_order_number() security definer set search_path = public;

alter table public.company_order_counters enable row level security;
revoke all on public.company_order_counters from anon, authenticated;
