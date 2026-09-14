-- The order number trigger has to run for orders that already have a number.
--
-- assign_order_number was taught in 20260903_keep_till_order_number.sql to keep
-- a number the desktop till had already printed and to move the counter *past*
-- it, so the next order the server numbers cannot land on one a guest is already
-- holding. That branch has never run in production. The trigger there was
-- created by hand as
--
--   BEFORE INSERT ... FOR EACH ROW WHEN (new.order_number IS NULL)
--
-- and a till order is precisely the case where order_number is not null. So
-- every order the till took left company_order_counters untouched, the counter
-- drifted further behind max(order_number) with each one, and the web till and
-- the kitchen screen — which do ask the counter — were handed numbers the till
-- had already used. With orders_company_order_number_unique on the table the
-- insert is refused outright and the waiter is told the order was not saved.
--
-- Test Restoran reached four orders of drift on 2026-09-14 and could not take an
-- order on the web at all until the counter was moved up by hand.
--
-- The trigger is recreated here without the WHEN clause — the function has
-- always decided for itself which branch it is in, and asking twice was the
-- mistake. Neither the trigger nor the constraint was ever in this directory:
-- "restoran testing" was already running the unconditional form, which is why
-- nothing here ever reproduced it.
drop trigger if exists trg_assign_order_number on public.orders;

create trigger trg_assign_order_number
  before insert on public.orders
  for each row
  execute function public.assign_order_number();

-- Catch up every counter that drifted while the trigger was skipping till
-- orders. greatest() so this can only move a counter forward, whatever a
-- concurrent insert is doing.
update company_order_counters c
   set last_order_number = greatest(
         c.last_order_number,
         (select coalesce(max(o.order_number), 0)
            from orders o
           where o.company_id = c.company_id));
