-- The photo bucket was open to the public anon key: anyone could upload, replace
-- or delete any restaurant's dish photos and logos (the logo shows on the
-- public QR menu), and upload files of any size or type (code review,
-- 2026-10-08).
--
-- Now a photo is written under its company's folder (lib/store imagePath), and
-- only that company's signed-in users can add, replace or delete files there.
-- Reading a photo by its public URL needs no policy: the bucket stays public.
-- Files uploaded before this sit outside any company folder; nobody but the
-- server can change or delete them any more, which only means they stay.

drop policy if exists "Anon upload menu images" on storage.objects;
drop policy if exists "Anon update menu images" on storage.objects;
drop policy if exists "Anon delete menu images" on storage.objects;
-- Let anyone list every file in the bucket. Public URLs do not need it.
drop policy if exists "Public read menu images" on storage.objects;

create policy "menu images: company reads" on storage.objects
  for select to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = public.get_my_company_id()::text);

create policy "menu images: company uploads" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'menu-images' and (storage.foldername(name))[1] = public.get_my_company_id()::text);

create policy "menu images: company replaces" on storage.objects
  for update to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = public.get_my_company_id()::text)
  with check (bucket_id = 'menu-images' and (storage.foldername(name))[1] = public.get_my_company_id()::text);

create policy "menu images: company deletes" on storage.objects
  for delete to authenticated
  using (bucket_id = 'menu-images' and (storage.foldername(name))[1] = public.get_my_company_id()::text);

-- Photos only, and nothing a phone camera would not produce.
update storage.buckets
  set file_size_limit = 5242880,
      allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'image/heif']
  where id = 'menu-images';
