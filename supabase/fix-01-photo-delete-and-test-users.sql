-- One-time fix after the first setup. Paste into Supabase -> SQL Editor -> Run.

-- 1. Let people delete their own photos (Storage must be able to "see" the file to delete it).
create policy "read own review photos" on storage.objects for select to authenticated
  using (bucket_id = 'review-photos' and (storage.foldername(name))[1] = auth.uid()::text);

-- 2. Remove the two test accounts Claude created while testing (their profiles, circle links
--    and invite go with them).
delete from auth.users
where id in (select id from public.profiles where display_name in ('Claude test', 'Claude test 2'));
