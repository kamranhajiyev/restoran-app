-- staff.pin_hash was readable by every signed-in user of the company. A
-- four-digit PIN's hash is guessed offline in seconds, past any lockout, so an
-- employee could learn every cashier's PIN and work under their name. The
-- browser only ever reads id, name, active and created_at; PINs are checked in
-- security definer functions, which still see the column.
revoke select on public.staff from anon, authenticated;
grant select (id, company_id, name, active, created_at) on public.staff to authenticated;
