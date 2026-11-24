-- A cash return's line in Kassa is one side of the return: changed or deleted
-- there alone, the drawer no longer matched Tarixçə and Anbar (found in review,
-- 2026-11-24). Its amount stays and the line stays, whoever writes the shift.
-- The words beside it may still be corrected.

create or replace function public.keep_return_movement()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  if exists (
    select 1
      from jsonb_array_elements(coalesce(OLD.movements, '[]'::jsonb)) m
      join returns r
        on r.company_id = OLD.company_id
       and r.id = case when m->>'id' ~ '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then (m->>'id')::uuid end
     where not exists (
       select 1 from jsonb_array_elements(coalesce(NEW.movements, '[]'::jsonb)) n
        where n->>'id' = m->>'id' and (n->>'amount')::numeric = (m->>'amount')::numeric)
  ) then
    raise exception 'is_return';
  end if;
  return NEW;
end $function$;

revoke all on function public.keep_return_movement() from public, anon, authenticated;

drop trigger if exists keep_return_movement on public.cash_shifts;
create trigger keep_return_movement
  before update of movements on public.cash_shifts
  for each row
  when (OLD.movements is distinct from NEW.movements)
  execute function public.keep_return_movement();
