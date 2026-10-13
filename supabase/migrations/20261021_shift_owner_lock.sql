-- Money that has reached Maliyyə changes only by the owner's hand.
--
-- Maliyyə keeps no copy of shift money: the cash and card lines are read from
-- the closed shift, and inkassasiya from the shift's movements (lib/finance.ts).
-- The till has to write cash_shifts, so any signed-in login of the restaurant
-- could update any shift, closed ones too. No screen lets a cashier do it, but
-- the database did not refuse, and the owner's balances would have moved.
--
-- A signed-in login that is not the owner may now only do what the till does:
-- open a shift, add a movement to an open one, and close it once. It cannot
-- touch a closed shift, change or remove a movement already written, or change
-- what the shift opened with. The owner and the superadmin are not limited
-- (corrections in admin Kassa), and neither is the server, which has already
-- checked the till's link and must still deliver a write that waited offline.

create or replace function public.cash_shift_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kept int;
begin
  -- The server, the owner of this restaurant, or the superadmin.
  -- (A cashier has no owner company: that comparison is null, and null is "no".)
  if auth.uid() is null
     or coalesce(new.company_id = get_my_owner_company_id(), false)
     or is_superadmin() then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.closed_at is not null or new.closed_by is not null
       or new.expected_cash is not null or new.counted_cash is not null
       or new.card_sales is not null or new.counted_card is not null
       or new.movements <> '[]'::jsonb or new.edits <> '[]'::jsonb then
      raise exception 'owner_only: a shift is opened empty' using errcode = '42501';
    end if;
    return new;
  end if;

  if old.closed_at is not null then
    raise exception 'owner_only: the shift is closed' using errcode = '42501';
  end if;
  if new.id is distinct from old.id or new.company_id is distinct from old.company_id
     or new.opened_at is distinct from old.opened_at or new.opened_by is distinct from old.opened_by
     or new.opening_cash is distinct from old.opening_cash or new.edits is distinct from old.edits then
    raise exception 'owner_only: only the owner corrects a shift' using errcode = '42501';
  end if;
  -- Movements are only added: every one already written stays as it is, in its place.
  kept := jsonb_array_length(old.movements);
  if jsonb_array_length(new.movements) < kept
     or coalesce((select jsonb_agg(m order by n) from jsonb_array_elements(new.movements) with ordinality t(m, n) where n <= kept), '[]'::jsonb)
        <> old.movements then
    raise exception 'owner_only: a written movement is not changed' using errcode = '42501';
  end if;
  return new;
end $$;

drop trigger if exists cash_shift_guard on public.cash_shifts;
create trigger cash_shift_guard before insert or update on public.cash_shifts
  for each row execute function public.cash_shift_guard();

revoke all on function public.cash_shift_guard() from public, anon, authenticated;
