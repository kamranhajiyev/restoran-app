-- Deleting a warehouse used to be a bare DELETE from the client, so Postgres decided the
-- outcome via six foreign keys (stock_balances, stock_movements, stock_receipts,
-- stock_transfers ×2, companies.sales_warehouse_id) and the UI turned every one of them
-- into "Bu anbarda hərəkət var — əvvəlcə qalıqları boşaldın."
--
-- That message was wrong more often than right. stock_balances keeps a row per item
-- forever, at qty = 0 once everything is written off, so a warehouse whose stock is
-- genuinely empty still had hundreds of rows pointing at it and could never be deleted —
-- no amount of "emptying the stock" would help.
--
-- The RPC below draws the line where it belongs: balances are a cache and get cleaned up,
-- but movements/receipts/transfers are history and block the delete. A warehouse with
-- history is meant to be archived (active = false), not deleted. Each refusal raises its
-- own code so the client can say what is actually wrong.

create or replace function public.delete_warehouse(p_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  cid   uuid;
  n_hist bigint;
begin
  cid := get_my_company_id();
  if cid is null then raise exception 'no_company'; end if;
  if not exists (select 1 from warehouses where id = p_id and company_id = cid) then
    raise exception 'bad_warehouse';
  end if;

  if exists (select 1 from companies where id = cid and sales_warehouse_id = p_id) then
    raise exception 'sales_warehouse';
  end if;

  select (select count(*) from stock_movements where warehouse_id = p_id)
       + (select count(*) from stock_receipts  where warehouse_id = p_id)
       + (select count(*) from stock_transfers where from_warehouse_id = p_id
                                                  or to_warehouse_id = p_id)
    into n_hist;
  if n_hist > 0 then raise exception 'has_history:%', n_hist; end if;

  -- Belt and braces: without history there is nothing that could have moved a balance,
  -- but never drop a row that still claims stock.
  if exists (select 1 from stock_balances where warehouse_id = p_id and qty <> 0) then
    raise exception 'has_stock';
  end if;

  delete from stock_balances where warehouse_id = p_id;
  delete from warehouses where id = p_id;
end $function$;

revoke all on function public.delete_warehouse(uuid) from public;
grant execute on function public.delete_warehouse(uuid) to authenticated;
