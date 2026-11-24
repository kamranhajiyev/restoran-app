-- LƏĞV tells the kitchen to stop cooking. The trigger queued it for every order
-- that became 'silinib', so deleting a paid order from admin, even one from an
-- earlier day, printed a slip for food that was long eaten (Natiq, 2026-11-23).
--
-- A deleted order that was already paid now prints nothing. An order closed
-- without payment never did (its slip went out at closing). Everything else is
-- unchanged: deleting or closing unpaid an open order still prints, and so does
-- a courier's order the guest refused ('ödənilib' to 'ləğv edildi').
drop trigger if exists orders_enqueue_cancel on public.orders;
create trigger orders_enqueue_cancel
  after update of status on public.orders
  for each row
  when (new.status in ('ləğv edildi','silinib')
        and old.status not in ('ləğv edildi','silinib')
        and not (new.status = 'silinib' and old.status = 'ödənilib'))
  execute function public.enqueue_print_jobs_order_cancel();
