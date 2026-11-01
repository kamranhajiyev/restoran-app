-- One owner, several məkans. A company can sit inside another one (parent_id):
-- the parent's owner logs in once and switches to any of its children from the
-- admin header (lib/switch-company). Each child keeps its own owner login for
-- its own tills; switching signs this device in as that login, so every rule
-- that reads profiles.company_id stays as it is.
--
-- One level only: a child has no children of its own. Only the superadmin sets
-- it (companies_update is is_superadmin()).

alter table public.companies
  add column if not exists parent_id uuid references public.companies(id) on delete set null;

alter table public.companies drop constraint if exists companies_parent_not_self;
alter table public.companies add constraint companies_parent_not_self check (parent_id <> id);

-- companies is granted column by column (20261008_hide_seller_token.sql), so
-- a new column is unreadable until named here. Without it the superadmin's list
-- read failed and showed no companies at all.
grant select (parent_id) on public.companies to authenticated;

create index if not exists companies_parent_id_idx on public.companies(parent_id);

create or replace function public.companies_one_level()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.parent_id is null then return new; end if;
  if exists (select 1 from companies where id = new.parent_id and parent_id is not null) then
    raise exception 'Bu şirkət özü başqa şirkətin içindədir';
  end if;
  if exists (select 1 from companies where parent_id = new.id) then
    raise exception 'Bu şirkətin içində şirkətlər var';
  end if;
  return new;
end;
$$;

drop trigger if exists companies_one_level on public.companies;
create trigger companies_one_level
  before insert or update of parent_id on public.companies
  for each row execute function public.companies_one_level();
