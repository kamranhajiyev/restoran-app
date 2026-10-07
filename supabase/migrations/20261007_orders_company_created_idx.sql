-- Every order list asks for one restaurant's newest orders. With no index on
-- company_id the whole table was read and checked against RLS row by row:
-- 4 s on average, up to 35 s, and 68 reads hit the statement timeout on
-- production on 2026-10-07.
create index if not exists orders_company_created_idx
  on public.orders (company_id, created_at desc);
