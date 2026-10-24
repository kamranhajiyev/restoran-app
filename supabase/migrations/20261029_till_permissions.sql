-- Who may do what on the till, and a manager's PIN for the rest (2026-10-24).
--
-- A seller could take a dish off an order after the guest had seen the bill,
-- close an order without payment or give a discount, and nothing asked anyone.
-- Now, as in Clopos:
--   * every PIN person has a role: seller, waiter or manager;
--   * the company keeps one rule per role and action (lib/till-rules.ts):
--     free, a manager's PIN, or not allowed. Managers are never asked;
--   * an order remembers when its bill was printed, so "after the bill" can be
--     told apart from an ordinary edit.
--
-- A manager's PIN has to work with the line down, so every till keeps a slow
-- hash of each manager's PIN (approve_hash, bcrypt cost 8, separate from
-- pin_hash). It is read only through public-staff and till_staff_extras(), and
-- only for managers — sellers' and waiters' hashes never leave the database.
-- A four-digit PIN can still be ground out of it; the owner accepted that,
-- and every approval names the manager on the order.

alter table public.staff add column if not exists role text not null default 'seller';
alter table public.staff drop constraint if exists staff_role_check;
alter table public.staff add constraint staff_role_check check (role in ('seller', 'waiter', 'manager'));
alter table public.staff add column if not exists approve_hash text;
grant select (role) on public.staff to authenticated;

-- Null = every action free: the restaurants already running keep working as
-- they did until their owner turns rules on. A new restaurant starts with the
-- recommended set (TILL_RULES_NEW in lib/till-rules.ts).
alter table public.companies add column if not exists till_rules jsonb;
-- companies is read column by column (20261008_hide_seller_token.sql): a new
-- column the browser reads has to be granted, or admin and the signed-in till
-- cannot load the rules. Signed-in users only; the link till reads them
-- through /api/public-settings.
grant select (till_rules) on public.companies to authenticated;
alter table public.companies alter column till_rules set default '{
  "seller": {"remove_item": "free", "remove_after_bill": "pin", "add_after_bill": "pin", "cancel": "pin", "discount": "pin", "view_history": "pin"},
  "waiter": {"remove_item": "free", "remove_after_bill": "pin", "add_after_bill": "pin", "cancel": "deny", "discount": "pin", "view_history": "pin"}
}'::jsonb;

alter table public.orders add column if not exists bill_printed_at timestamptz;

-- ── Staff writes: the role, and the approval hash beside every PIN ──────────

drop function if exists public.create_staff(text, text);
create or replace function public.create_staff(p_name text, p_pin text, p_role text default 'seller')
returns uuid
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare cid uuid; sid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'bad_pin'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'bad_name'; end if;
  if p_role not in ('seller', 'waiter', 'manager') then raise exception 'bad_role'; end if;
  if exists (select 1 from staff s where s.company_id = cid and s.pin_hash = crypt(p_pin, s.pin_hash)) then
    raise exception 'pin_taken';
  end if;
  insert into staff (company_id, name, pin_hash, role, approve_hash)
  values (cid, trim(p_name), crypt(p_pin, gen_salt('bf')), p_role, crypt(p_pin, gen_salt('bf', 8)))
  returning id into sid;
  return sid;
end $function$;

drop function if exists public.update_staff(uuid, text, boolean);
create or replace function public.update_staff(p_id uuid, p_name text, p_active boolean, p_role text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'bad_name'; end if;
  if p_role is not null and p_role not in ('seller', 'waiter', 'manager') then raise exception 'bad_role'; end if;
  update staff set name = trim(p_name), active = p_active, role = coalesce(p_role, role)
  where id = p_id and company_id = cid;
end $function$;

create or replace function public.set_staff_pin(p_id uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if p_pin !~ '^\d{4}$' then raise exception 'bad_pin'; end if;
  if exists (select 1 from staff s where s.company_id = cid and s.id <> p_id and s.pin_hash = crypt(p_pin, s.pin_hash)) then
    raise exception 'pin_taken';
  end if;
  update staff set pin_hash = crypt(p_pin, gen_salt('bf')), approve_hash = crypt(p_pin, gen_salt('bf', 8))
  where id = p_id and company_id = cid;
end $function$;

-- ── PIN checks: say the role, and fill in a missing approval hash ───────────
-- Staff made before this have no approve_hash, and nobody knows their PIN but
-- them. The first time they type it online it is stored; until then a manager
-- among them can approve online only.

create or replace function public.verify_staff_pin(p_pin text, p_device_id text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare cid uuid; did text; st record; ps record; fails int;
begin
  cid := get_my_company_id();
  did := coalesce(p_device_id, '');
  if cid is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;

  select * into ps from staff_pin_state where company_id = cid and device_id = did for update;
  if ps.locked_until is not null and ps.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', ps.locked_until);
  end if;

  select s.id, s.name, s.role, s.approve_hash into st from staff s
  where s.company_id = cid and s.active and s.pin_hash = crypt(p_pin, s.pin_hash) limit 1;

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

  if st.approve_hash is null then
    update staff set approve_hash = crypt(p_pin, gen_salt('bf', 8)) where id = st.id;
  end if;
  delete from staff_pin_state where company_id = cid and device_id = did;
  return jsonb_build_object('ok', true, 'id', st.id, 'name', st.name, 'role', st.role);
end $function$;

create or replace function public.verify_staff_pin_for_company(p_company_id uuid, p_pin text, p_device_id text default '')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare cid uuid; did text; st record; ps record; fails int; lcount int; wait_minutes int;
begin
  cid := p_company_id;
  did := coalesce(p_device_id, '');
  if cid is null then return jsonb_build_object('ok', false, 'error', 'no_company'); end if;

  select * into ps from staff_pin_state where company_id = cid and device_id = did for update;

  if ps.locked_until is not null and ps.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', ps.locked_until);
  end if;

  select s.id, s.name, s.role, s.approve_hash into st from staff s
  where s.company_id = cid and s.active and s.pin_hash = crypt(p_pin, s.pin_hash) limit 1;

  if st.id is null then
    if ps.company_id is null or (ps.locked_until is not null and ps.locked_until <= now()) then
      fails := 1; lcount := coalesce(ps.lockout_count, 0);
    else
      fails := ps.failed_attempts + 1; lcount := coalesce(ps.lockout_count, 0);
    end if;

    if fails >= 5 then
      lcount := lcount + 1;
      wait_minutes := least(10 * pow(2, lcount - 1)::int, 160);
      insert into staff_pin_state (company_id, device_id, failed_attempts, locked_until, lockout_count)
      values (cid, did, 0, now() + (wait_minutes || ' minutes')::interval, lcount)
      on conflict (company_id, device_id) do update
        set failed_attempts = 0, locked_until = now() + (wait_minutes || ' minutes')::interval, lockout_count = lcount;
      return jsonb_build_object('ok', false, 'error', 'locked', 'locked_until', now() + (wait_minutes || ' minutes')::interval);
    end if;

    insert into staff_pin_state (company_id, device_id, failed_attempts, locked_until, lockout_count)
    values (cid, did, fails, null, lcount)
    on conflict (company_id, device_id) do update
      set failed_attempts = fails, locked_until = null, lockout_count = lcount;

    return jsonb_build_object('ok', false, 'error', 'wrong', 'attempts_left', 5 - fails);
  end if;

  if st.approve_hash is null then
    update staff set approve_hash = crypt(p_pin, gen_salt('bf', 8)) where id = st.id;
  end if;
  delete from staff_pin_state where company_id = cid and device_id = did;
  return jsonb_build_object('ok', true, 'id', st.id, 'name', st.name, 'role', st.role);
end $function$;

-- ── What a signed-in till reads ─────────────────────────────────────────────
-- Read beside the staff list, so the rules cost the till no request of their
-- own: the managers' approval hashes (for checking a PIN offline — never a
-- seller's or a waiter's) and the company's rules. The link till gets the same
-- two from /api/public-staff.
create or replace function public.till_staff_extras()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object(
    'approvers', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'approve_hash', s.approve_hash))
      from staff s
      where s.company_id = public.get_my_company_id()
        and s.active and s.role = 'manager' and s.approve_hash is not null
    ), '[]'::jsonb),
    'rules', (select c.till_rules from companies c where c.id = public.get_my_company_id())
  );
$function$;

-- Owners write companies through functions (RLS keeps direct updates for the
-- superadmin), like set_kassa_enabled.
create or replace function public.set_till_rules(p_rules jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare cid uuid;
begin
  select company_id into cid from profiles where id = auth.uid() and company_id = public.get_my_company_id() and role = 'owner';
  if cid is null then raise exception 'not_owner'; end if;
  if p_rules is not null and jsonb_typeof(p_rules) <> 'object' then raise exception 'bad_rules'; end if;
  update companies set till_rules = p_rules where id = cid;
end $function$;

revoke execute on function public.create_staff(text, text, text) from public, anon;
revoke execute on function public.update_staff(uuid, text, boolean, text) from public, anon;
revoke execute on function public.till_staff_extras() from public, anon;
revoke execute on function public.set_till_rules(jsonb) from public, anon;
grant execute on function public.create_staff(text, text, text) to authenticated, service_role;
grant execute on function public.update_staff(uuid, text, boolean, text) to authenticated, service_role;
grant execute on function public.till_staff_extras() to authenticated, service_role;
grant execute on function public.set_till_rules(jsonb) to authenticated, service_role;
