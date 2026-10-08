-- add_courier_payment and cancel_courier_order check the company only when
-- someone is signed in (auth.uid() is not null), so a caller with just the
-- public anon key skipped the check: courier payments added to, and delivered
-- orders cancelled in, any restaurant. The till reaches them through the
-- server (service role); the browser only with a session. Nobody needs them
-- as anon.
--
-- verify_staff_pin_for_company is only for /api/verify-pin. Open to anon, its
-- lockout is per device id — chosen by the caller — so a PIN could be guessed.
--
-- Postgres grants EXECUTE to PUBLIC by default, so revoking from anon alone
-- would change nothing.
revoke execute on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text, text[]) from public, anon;
grant execute on function public.add_courier_payment(uuid, numeric, text, uuid, uuid, text, uuid, text, text[]) to authenticated, service_role;

revoke execute on function public.cancel_courier_order(text, text, text) from public, anon;
grant execute on function public.cancel_courier_order(text, text, text) to authenticated, service_role;

revoke execute on function public.verify_staff_pin_for_company(uuid, text, text) from public, anon, authenticated;
grant execute on function public.verify_staff_pin_for_company(uuid, text, text) to service_role;
