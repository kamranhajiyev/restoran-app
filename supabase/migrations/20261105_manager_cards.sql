-- A manager approves with a card instead of a PIN, where the venue wants it
-- (2026-11-01).
--
-- Some venues have an RFID reader on the till. The owner picks, in İcazələr,
-- how a manager approves: only the PIN, only a card, or either. The choice
-- rides in till_rules ("approve_with"), so it reaches the browser till, the exe
-- and the APK the way the rules already do. No choice = the PIN, as before.
--
-- The card's number (lib/card-reader cardNumber) is kept as card_hash, a
-- bcrypt hash at cost 8 like approve_hash, and for the same reason: the till
-- checks a manager's card with it when the line is down. It is read only
-- through public-staff and till_staff_extras(), and only for managers. A
-- 125 kHz card can be copied with a cheap gadget; the owner accepted that,
-- and every approval names the manager on the order.

alter table public.staff add column if not exists card_hash text;
-- staff is read column by column (20261008_hide_pin_hash.sql): card_hash is
-- left ungranted on purpose.

-- ── Owner saves or clears a card ────────────────────────────────────────────

create or replace function public.set_staff_card(p_id uuid, p_card text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if p_card is null or p_card = '' then
    update staff set card_hash = null where id = p_id and company_id = cid;
    return;
  end if;
  if p_card !~ '^[1-9]\d{0,19}$' then raise exception 'bad_card'; end if;
  if exists (select 1 from staff s where s.company_id = cid and s.id <> p_id and s.card_hash is not null and s.card_hash = crypt(p_card, s.card_hash)) then
    raise exception 'card_taken';
  end if;
  update staff set card_hash = crypt(p_card, gen_salt('bf', 8)) where id = p_id and company_id = cid;
end $function$;

-- ── Checking a card: the same answer and lockout as a PIN ───────────────────
-- One body for both callers; a wrong card counts against the same five tries
-- as a wrong PIN on that till.

create or replace function public.verify_staff_card_in(p_company_id uuid, p_card text, p_device_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare cid uuid; did text; st record; ps record; fails int;
begin
  cid := p_company_id;
  did := coalesce(p_device_id, '');
  if cid is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;

  select * into ps from staff_pin_state where company_id = cid and device_id = did for update;
  if ps.locked_until is not null and ps.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', ps.locked_until);
  end if;

  select s.id, s.name, s.role into st from staff s
  where s.company_id = cid and s.active and s.card_hash is not null
    and coalesce(p_card, '') ~ '^[1-9]\d{0,19}$' and s.card_hash = crypt(p_card, s.card_hash) limit 1;

  if st.id is null then
    fails := case when ps.company_id is null or (ps.locked_until is not null and ps.locked_until <= now())
                  then 1 else ps.failed_attempts + 1 end;
    insert into staff_pin_state (company_id, device_id, failed_attempts, locked_until)
    values (cid, did, fails, case when fails >= 5 then now() + interval '60 seconds' end)
    on conflict (company_id, device_id) do update
      set failed_attempts = excluded.failed_attempts, locked_until = excluded.locked_until;
    if fails >= 5 then
      return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', now() + interval '60 seconds');
    end if;
    return jsonb_build_object('ok', false, 'error', 'wrong', 'attempts_left', 5 - fails);
  end if;

  delete from staff_pin_state where company_id = cid and device_id = did;
  return jsonb_build_object('ok', true, 'id', st.id, 'name', st.name, 'role', st.role);
end $function$;

-- The signed-in till: its own company.
create or replace function public.verify_staff_card(p_card text, p_device_id text default '')
returns jsonb
language sql
security definer
set search_path to 'public'
as $function$
  select public.verify_staff_card_in(public.get_my_company_id(), p_card, p_device_id);
$function$;

-- ── What a signed-in till reads: the managers' card hashes beside the PINs' ─

create or replace function public.till_staff_extras()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'approvers', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'approve_hash', s.approve_hash, 'card_hash', s.card_hash))
      from staff s
      where s.company_id = public.get_my_company_id()
        and s.active and s.role = 'manager' and (s.approve_hash is not null or s.card_hash is not null)
    ), '[]'::jsonb),
    'rules', (select c.till_rules from companies c where c.id = public.get_my_company_id())
  );
$function$;

revoke execute on function public.set_staff_card(uuid, text) from public, anon;
revoke execute on function public.verify_staff_card(text, text) from public, anon;
-- Any company id can be passed here: only the definer functions above and
-- /api/verify-pin (service role, after checking the till's link) may call it.
revoke execute on function public.verify_staff_card_in(uuid, text, text) from public, anon, authenticated;
grant execute on function public.set_staff_card(uuid, text) to authenticated, service_role;
grant execute on function public.verify_staff_card(text, text) to authenticated, service_role;
grant execute on function public.verify_staff_card_in(uuid, text, text) to service_role;
