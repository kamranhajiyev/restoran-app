-- Let an order keep the number the till already printed on it.
--
-- assign_order_number has always overwritten order_number from the per-company
-- counter, which was right while every order was born on the server. The
-- desktop till breaks that assumption: it takes orders with the line down, and
-- it has to put a number on the guest's receipt and on the kitchen slip right
-- then — minutes, or a whole service, before Supabase hears about the order at
-- all. Renumbering it on arrival would leave the paper in the restaurant
-- disagreeing with the report at the end of the night, with nothing to say which
-- bill was which.
--
-- So a supplied number is kept, and the counter is moved *past* it rather than
-- over it, so the next order the server numbers cannot land on top of one that
-- has already been handed to a guest. Everything else — the web till, the QR
-- menu, admin — still inserts without a number and is numbered here exactly as
-- before.
--
-- Only the desktop till's replay supplies one (lib/store.ts, keepOrderNumber).
create or replace function public.assign_order_number()
returns trigger
language plpgsql
as $function$
begin
  if new.order_number is not null and new.order_number > 0 then
    insert into company_order_counters (company_id, last_order_number)
    values (new.company_id, new.order_number)
    on conflict (company_id) do update
      set last_order_number = greatest(company_order_counters.last_order_number, new.order_number);
    return new;
  end if;

  insert into company_order_counters (company_id, last_order_number)
  values (new.company_id, 1)
  on conflict (company_id) do update
    set last_order_number = company_order_counters.last_order_number + 1
  returning last_order_number into new.order_number;
  return new;
end;
$function$;
