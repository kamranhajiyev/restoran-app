-- Az qalan mal (SHOP-MODE.md, lib/low-stock.ts): the owner's limit per stock
-- item. Null = no warning. Read through the existing stock_items_select policy
-- (the company's own people), written through stock_items_owner_write (the
-- owner); the public key reaches neither.
alter table public.stock_items add column if not exists min_qty numeric;

alter table public.stock_items drop constraint if exists stock_items_min_qty_check;
alter table public.stock_items add constraint stock_items_min_qty_check
  check (min_qty is null or min_qty >= 0);
