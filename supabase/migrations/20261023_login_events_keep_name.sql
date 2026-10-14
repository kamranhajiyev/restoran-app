-- Deleting a person keeps their logins (Test Restoran, 2026-10-14).
--
-- Rasim, a kitchen employee, could not be deleted: Girişlər had two logins of
-- his from July, each linked to his profile, and the database refused to
-- delete a profile that rows still point to.
--
-- A login now carries the name it was made under. Deleting the person unlinks
-- their logins instead of being refused, and Girişlər still shows "Rasim".

alter table public.login_events
  add column if not exists name text,
  add column if not exists username text,
  add column if not exists role text;

update public.login_events e
set name = p.name, username = p.username, role = p.role
from public.profiles p
where p.id = e.user_id and e.name is null;

alter table public.login_events alter column user_id drop not null;
alter table public.login_events drop constraint if exists login_events_user_id_fkey;
alter table public.login_events add constraint login_events_user_id_fkey
  foreign key (user_id) references public.profiles(id) on delete set null;

-- The name is copied by the database, so no writer can forget it.
create or replace function public.login_event_name()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  select p.name, p.username, p.role
    into new.name, new.username, new.role
  from profiles p where p.id = new.user_id;
  return new;
end
$function$;

drop trigger if exists trg_login_event_name on public.login_events;
create trigger trg_login_event_name
  before insert on public.login_events
  for each row execute function public.login_event_name();

revoke all on function public.login_event_name() from public, anon, authenticated;
