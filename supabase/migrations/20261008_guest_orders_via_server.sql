-- The QR menu inserted orders itself with the public anon key, and the insert
-- policies let anon add an order — and its lines — to any company: paid, at any
-- price, counted as a sale. Guest orders now go through /api/guest-order, which
-- prices them from the menu, so the anon branch is removed. Signed-in users
-- keep inserting into their own company; the server uses the service role.
alter policy orders_insert on public.orders
  with check ((company_id = get_my_company_id()) or is_superadmin());
alter policy order_items_insert on public.order_items
  with check ((order_company(order_id) = get_my_company_id()) or is_superadmin());
