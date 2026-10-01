-- A note can go to the kitchen on its own. A waiter edits an open order, adds
-- nothing and takes nothing off, and only writes "BALİ" in the note. Before
-- this, the button stayed grey with an empty cart and the kitchen never heard.
--
-- No trigger this time. A note also changes alongside an append (the ƏLAVƏ
-- ticket already carries it) and before removals (the LƏĞV slip carries it), so
-- "the note changed" alone would print it twice. The edit screen knows when the
-- note was the whole edit, so it asks for the slip explicitly.

alter table public.print_jobs drop constraint if exists print_jobs_kind_check;
alter table public.print_jobs add constraint print_jobs_kind_check
  check (kind = any (array['new'::text, 'append'::text, 'cancel'::text, 'move'::text, 'note'::text]));

-- One 'note' slip per station that already holds a ticket for the order, the
-- same stations a move slip goes to: a station that never saw the order has no
-- food to apply the note to. An order nothing was printed for yet sends it to
-- the first station, so the note is never silently dropped.
--
-- p_printed names the stations the desktop till already printed to, as in
-- 20261002_till_printed_tickets.sql: their job is recorded printed, not queued.
create or replace function public.enqueue_note_ticket(p_order_id text, p_printed uuid[] default '{}')
returns void language plpgsql security definer set search_path to 'public' as $function$
declare
  o public.orders;
begin
  select * into o from public.orders where id = p_order_id;
  if not found then return; end if;
  -- coalesce: with no session get_my_company_id() is null, and `not null` would let it through.
  if not coalesce(auth.role() = 'service_role' or o.company_id = get_my_company_id() or is_superadmin(), false) then
    raise exception 'forbidden';
  end if;
  if o.note is null or btrim(o.note) = '' then return; end if;

  insert into public.print_jobs (company_id, station_id, order_id, kind, payload, status, printed_at)
  select o.company_id, st.id, o.id, 'note',
         public.build_ticket(o, st.name, '[]'::jsonb, 'note'),
         case when st.id = any(coalesce(p_printed, '{}')) then 'printed' else 'pending' end,
         case when st.id = any(coalesce(p_printed, '{}')) then now() end
    from public.stations st
   where st.company_id = o.company_id
     and (
       exists (select 1 from public.print_jobs pj
                where pj.order_id = o.id and pj.station_id = st.id and pj.kind in ('new','append'))
       or (
         not exists (select 1 from public.print_jobs pj
                      where pj.order_id = o.id and pj.kind in ('new','append'))
         and st.id = (select s2.id from public.stations s2
                       where s2.company_id = o.company_id
                       order by s2.position, s2.created_at limit 1)
       )
     );
end $function$;

revoke all on function public.enqueue_note_ticket(text, uuid[]) from public, anon;
grant execute on function public.enqueue_note_ticket(text, uuid[]) to authenticated, service_role;
