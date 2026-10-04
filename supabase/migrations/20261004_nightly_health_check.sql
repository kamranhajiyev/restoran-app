-- Nightly health check, sent to Telegram.
--
-- Looks for things that should never exist — a payment the server refused on an
-- order still unpaid, a write that never finished, an order left open for hours,
-- an order with no dishes — and messages the owner before a restaurant has to
-- call. Read-only: it reports, it never fixes. See LESSONS.md.
--
-- Runs at 00:30 UTC = 04:30 Baku, after the latest closing time (Latte Art,
-- 04:00), so a normal evening's open orders are not reported as problems.
--
-- Needs two Vault secrets, set by hand and never committed:
--   select vault.create_secret('<bot token>', 'telegram_bot_token');
--   select vault.create_secret('<chat id>',   'telegram_chat_id');

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Every restaurant by default; pass slugs to check only those. Latte Art and
-- İXLAS CAFE are the first, while we see whether the report is useful or noise.
create or replace function public.health_check(only_slugs text[] default null)
returns table (company text, problem text, order_number integer, at timestamptz)
language sql
stable
set search_path = public
as $$
  with c as (
    select id, name from companies
    where active and trashed_at is null
      and (only_slugs is null or slug = any(only_slugs))
  )

  -- The server refused a payment and the order is still unpaid. The till
  -- replays that saved "no" forever (Latte Art №4171/№4172, 2026-10-04).
  select c.name, 'stuck payment', o.order_number, o.created_at
  from applied_mutations m
  join orders o on m.key = 'pay:' || o.id
  join c on c.id = o.company_id
  where m.route = 'update-order-status' and (m.result->>'ok')::boolean = false
    and o.status not in ('ödənilib', 'ləğv edildi', 'silinib')

  union all

  -- A write that started and never finished.
  select c.name, 'unfinished write', o.order_number, m.applied_at
  from applied_mutations m
  join c on c.id = m.company_id
  left join orders o on m.key like '%:' || o.id
  where m.result is null and m.applied_at < now() - interval '10 minutes'

  union all

  -- An order left open for more than 3 hours.
  select c.name, 'open > 3h', o.order_number, o.created_at
  from orders o
  join c on c.id = o.company_id
  where o.status not in ('ödənilib', 'ləğv edildi', 'silinib')
    and o.created_at < now() - interval '3 hours'

  union all

  -- A live order with no dishes.
  select c.name, 'no items', o.order_number, o.created_at
  from orders o
  join c on c.id = o.company_id
  where o.status not in ('ləğv edildi', 'silinib')
    and o.created_at > now() - interval '30 days'
    and not exists (
      select 1 from order_items i where i.order_id = o.id and i.removed_at is null
    )
$$;

create or replace function public.send_health_report(only_slugs text[] default null)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  token text;
  chat  text;
  body  text;
begin
  select decrypted_secret into token from vault.decrypted_secrets where name = 'telegram_bot_token';
  select decrypted_secret into chat  from vault.decrypted_secrets where name = 'telegram_chat_id';
  if token is null or chat is null then
    raise warning 'send_health_report: telegram secrets are not set';
    return;
  end if;

  -- Plain words, one line per order, only what is new since last night. A stuck
  -- payment is the exception: it is reported every night until someone fixes
  -- it. An order with several problems is listed once, under the worst.
  with r as (
    select company, order_number, problem, at,
           row_number() over (
             partition by company, coalesce(order_number::text, at::text)
             order by case problem when 'stuck payment' then 1 when 'unfinished write' then 2
                                   when 'no items' then 3 else 4 end) as pick
    from public.health_check(only_slugs)
    where problem = 'stuck payment' or at > now() - interval '25 hours'
  ),
  lines as (
    select company, at,
           format('• №%s %s', coalesce(order_number::text, '?'),
             case problem
               when 'stuck payment'    then 'can''t be paid — the Ödəniş button won''t work'
               when 'unfinished write' then 'was not fully saved'
               when 'no items'         then 'has no items'
               else                         'is still open after 3+ hours'
             end) as line,
           row_number() over (partition by company order by at) as n,
           count(*) over (partition by company) as total
    from r where pick = 1
  )
  select string_agg(block, E'\n\n' order by company) into body
  from (
    select company,
           format(E'⚠️ %s\n%s%s', company,
             string_agg(line, E'\n' order by at) filter (where n <= 10),
             case when max(total) > 10 then format(E'\n…and %s more', max(total) - 10) else '' end) as block
    from lines group by company
  ) b;

  -- Nothing wrong, nothing sent.
  if body is null then return; end if;

  perform net.http_post(
    url  := 'https://api.telegram.org/bot' || token || '/sendMessage',
    body := jsonb_build_object('chat_id', chat, 'text', left(body, 4000))
  );
end;
$$;

-- Lists every restaurant's problems, and can message the owner: neither is for
-- the app's users.
revoke all on function public.health_check(text[]) from public, anon, authenticated;
revoke all on function public.send_health_report(text[]) from public, anon, authenticated;

-- To add a restaurant, add its slug here; drop the argument to check them all.
select cron.schedule('nightly-health-check', '30 0 * * *',
  $$select public.send_health_report(array['latte-art', 'ixlas-cafe'])$$);
