-- Admin-side correction of kassa records.
--
-- A shift was write-once: a movement (mədaxil/məxaric) could be added but never
-- fixed, and a closed shift was frozen. Real mistakes — a wrong amount, a reason
-- on the wrong side, a miscounted drawer noticed later — had no remedy.
--
-- Corrections are only trustworthy if they leave a mark, so every function here
-- writes its audit entry in the same UPDATE that performs the change. There is
-- no code path that edits a shift without recording who did it and what moved.
--
-- Note: cash_shifts itself predates version control and was applied straight to
-- the project, so this migration assumes the table exists and only adds to it.

-- The trail lives on the row, like order_items.removed_at/removed_by, so it
-- arrives with the select('*') fetchShifts already does.
alter table public.cash_shifts
  add column if not exists edits jsonb not null default '[]'::jsonb;

-- Movements were {at, by, amount, reason} — addressable only by array index,
-- which no client can hold on to across a concurrent append. Give each one an
-- id. Idempotent: entries that already carry an id are left alone.
update public.cash_shifts c
set movements = (
  select coalesce(jsonb_agg(
    case when m ? 'id' then m
         else m || jsonb_build_object('id', gen_random_uuid()::text) end
    order by ord), '[]'::jsonb)
  from jsonb_array_elements(c.movements) with ordinality t(m, ord))
where jsonb_array_length(c.movements) > 0;

-- Same append as before, but a client that doesn't send an id (an old desktop
-- shell, the token seller terminal) still gets an addressable movement.
create or replace function public.append_shift_movement(shift_id uuid, movement jsonb)
returns void
language sql
set search_path to 'public'
as $$
  update cash_shifts
  set movements = movements || jsonb_build_array(
        case when movement ? 'id' then movement
             else movement || jsonb_build_object('id', gen_random_uuid()::text) end)
  where id = shift_id;
$$;

-- expected_cash is a snapshot of opening + sales + movements taken at close. If
-- a movement changes afterwards and the snapshot doesn't, the row stops agreeing
-- with its own inputs. So closed shifts get the delta applied — the difference
-- (fərq) moves with it, which is the honest outcome: correcting a wrongly
-- recorded expense genuinely changes whether the drawer balanced. counted_cash
-- is never touched here. An open shift has no snapshot; the UI computes it live.

create or replace function public.update_shift_movement(
  shift_id uuid, movement_id text,
  new_amount numeric, new_reason text, by_name text)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  cur     jsonb;
  is_open boolean;
  old_m   jsonb;
  new_m   jsonb;
  delta   numeric;
begin
  -- Lock the row before reading, so a movement added between the read and the
  -- write isn't dropped when the array is rebuilt.
  select movements, closed_at is null into cur, is_open
  from cash_shifts where id = shift_id for update;
  if cur is null then
    raise exception 'shift not found';
  end if;

  select m into old_m from jsonb_array_elements(cur) m where m->>'id' = movement_id;
  if old_m is null then
    raise exception 'movement not found';
  end if;

  new_m := old_m || jsonb_build_object('amount', new_amount, 'reason', new_reason);
  delta := new_amount - (old_m->>'amount')::numeric;

  update cash_shifts c set
    movements = (
      select coalesce(jsonb_agg(
        case when m->>'id' = movement_id then new_m else m end order by ord), '[]'::jsonb)
      from jsonb_array_elements(cur) with ordinality t(m, ord)),
    expected_cash = case when is_open then c.expected_cash else c.expected_cash + delta end,
    edits = c.edits || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', by_name, 'action', 'movement_edit',
      'from', old_m, 'to', new_m))
  where c.id = shift_id;
end;
$$;

create or replace function public.delete_shift_movement(
  shift_id uuid, movement_id text, by_name text)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  cur     jsonb;
  is_open boolean;
  old_m   jsonb;
begin
  select movements, closed_at is null into cur, is_open
  from cash_shifts where id = shift_id for update;
  if cur is null then
    raise exception 'shift not found';
  end if;

  select m into old_m from jsonb_array_elements(cur) m where m->>'id' = movement_id;
  if old_m is null then
    raise exception 'movement not found';
  end if;

  -- The entry leaves the list but survives in full inside the audit entry.
  update cash_shifts c set
    movements = (
      select coalesce(jsonb_agg(m order by ord), '[]'::jsonb)
      from jsonb_array_elements(cur) with ordinality t(m, ord)
      where m->>'id' <> movement_id),
    expected_cash = case when is_open then c.expected_cash
                         else c.expected_cash - (old_m->>'amount')::numeric end,
    edits = c.edits || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', by_name, 'action', 'movement_delete', 'from', old_m))
  where c.id = shift_id;
end;
$$;

-- Only the counted figures are correctable. expected_cash stays derived — if it
-- could be typed, the difference could be made to look clean, which is the one
-- thing the shift report exists to prevent.
create or replace function public.correct_shift_totals(
  shift_id uuid,
  new_counted_cash numeric, new_counted_card numeric, by_name text)
returns void
language plpgsql
set search_path to 'public'
as $$
declare
  s       cash_shifts%rowtype;
  entries jsonb := '[]'::jsonb;
begin
  select * into s from cash_shifts where id = shift_id for update;
  if s.id is null then
    raise exception 'shift not found';
  end if;
  if s.closed_at is null then
    raise exception 'shift is still open';
  end if;

  if new_counted_cash is distinct from s.counted_cash then
    entries := entries || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', by_name, 'action', 'totals_edit', 'field', 'countedCash',
      'from', s.counted_cash, 'to', new_counted_cash));
  end if;

  if new_counted_card is distinct from s.counted_card then
    entries := entries || jsonb_build_array(jsonb_build_object(
      'at', now(), 'by', by_name, 'action', 'totals_edit', 'field', 'countedCard',
      'from', s.counted_card, 'to', new_counted_card));
  end if;

  if jsonb_array_length(entries) = 0 then
    return;
  end if;

  update cash_shifts set
    counted_cash = new_counted_cash,
    counted_card = new_counted_card,
    edits = edits || entries
  where id = shift_id;
end;
$$;
