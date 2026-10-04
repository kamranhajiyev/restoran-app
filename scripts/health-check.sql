-- Daily health check: things that should never exist in the database.
-- Read-only. Each row is one problem a restaurant may be stuck on.
-- See LESSONS.md for the bugs behind each check.

with c as (select id, name from companies where active and trashed_at is null)

-- 1. The server refused a payment, and the order is still unpaid.
--    The till replays that saved "no" forever (Latte Art №4171/№4172, 2026-10-04).
select c.name, 'stuck payment' as problem, o.order_number, o.created_at
from applied_mutations m
join orders o on m.key = 'pay:' || o.id
join c on c.id = o.company_id
where m.route = 'update-order-status' and (m.result->>'ok')::boolean = false
  and o.status not in ('ödənilib', 'ləğv edildi', 'silinib')

union all

-- 2. A write that started and never finished.
select c.name, 'unfinished write', o.order_number, m.applied_at
from applied_mutations m
join c on c.id = m.company_id
left join orders o on m.key like '%:' || o.id
where m.result is null and m.applied_at < now() - interval '10 minutes'

union all

-- 3. An order left open for more than 3 hours.
select c.name, 'open > 3h', o.order_number, o.created_at
from orders o
join c on c.id = o.company_id
where o.status not in ('ödənilib', 'ləğv edildi', 'silinib')
  and o.created_at < now() - interval '3 hours'

union all

-- 4. A live order with no dishes.
select c.name, 'no items', o.order_number, o.created_at
from orders o
join c on c.id = o.company_id
where o.status not in ('ləğv edildi', 'silinib')
  and o.created_at > now() - interval '30 days'
  and not exists (
    select 1 from order_items i where i.order_id = o.id and i.removed_at is null
  )

order by 1, 2, 4;
