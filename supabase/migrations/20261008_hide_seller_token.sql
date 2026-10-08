-- companies.seller_token is the till link: whoever holds it can read a
-- restaurant's orders and customers and write sales into it. The select policy
-- lets anyone read active companies (the slug lookup needs it), and with it
-- the token of every restaurant, through the public anon key.
--
-- Postgres cannot take one column back from a table-wide grant, so the grant is
-- replaced by one that lists every column but the token. A new column on
-- companies must be added here too, or the browser cannot read it.
revoke select on public.companies from anon, authenticated;
-- anon: the restaurant page and QR menu look a company up by slug.
grant select (
  id, name, slug, active, created_at, expires_at, owner_name, address, phone,
  tables_enabled, timezone, work_open, work_close, trashed_at, kassa_enabled,
  qr_enabled, menu_only, print_receipt, sales_warehouse_id, logo_url,
  brand_color, sound_enabled, delivery_enabled
) on public.companies to anon, authenticated;
