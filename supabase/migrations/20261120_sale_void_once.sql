-- Deleting a paid sale gave back every 'sale' line the order ever had, and
-- forgot the 'sale_void' lines earlier deletes had already written. A sale of
-- 4 deleted, restored and deleted again gave back 8, then 12, then 16
-- (customer report, 2026-11-27, shop and restaurant mode alike).
-- Now a delete gives back only what the order still holds: its 'sale' lines
-- plus its 'sale_void' lines, per warehouse and item.

create or replace function public.apply_stock_on_payment()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if NEW.status = 'ödənilib' and OLD.status is distinct from 'ödənilib' and not NEW.stock_applied then
    begin
      perform take_order_stock(NEW.id, NEW.company_id, NEW.waiter_name);
      NEW.stock_applied := true;
      NEW.stock_error := null;
    exception when others then
      NEW.stock_error := left(sqlerrm, 300);
      raise warning 'stock not applied: order % company %: % (%)', NEW.id, NEW.company_id, sqlerrm, sqlstate;
    end;

  elsif OLD.status = 'ödənilib' and NEW.status in ('ləğv edildi','silinib') then
    -- A sale that never took stock has nothing to give back, and nothing left
    -- to retry.
    NEW.stock_error := null;
    if NEW.stock_applied then
      begin
        -- Balances first: both statements read what the order still holds,
        -- and the second one's insert would change that.
        insert into stock_balances (warehouse_id, stock_item_id, company_id, qty)
        select warehouse_id, stock_item_id, company_id, -sum(qty)
        from stock_movements where order_id = NEW.id and reason in ('sale','sale_void')
        group by warehouse_id, stock_item_id, company_id
        having sum(qty) <> 0
        on conflict (warehouse_id, stock_item_id)
          do update set qty = stock_balances.qty + excluded.qty;

        insert into stock_movements (company_id, warehouse_id, stock_item_id, qty, reason, order_id, created_by)
        select company_id, warehouse_id, stock_item_id, -sum(qty), 'sale_void', NEW.id, NEW.cancelled_by
        from stock_movements where order_id = NEW.id and reason in ('sale','sale_void')
        group by company_id, warehouse_id, stock_item_id
        having sum(qty) <> 0;

        NEW.stock_applied := false;
      exception when others then
        raise warning 'stock not returned: order % company %: % (%)', NEW.id, NEW.company_id, sqlerrm, sqlstate;
      end;
    end if;
  end if;

  return NEW;
end $function$;
