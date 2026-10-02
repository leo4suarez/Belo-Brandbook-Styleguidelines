-- Files: public bucket. Anyone can load a file by its URL; only editors can upload, list or remove.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('assets', 'assets', true, 52428800,
        array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml', 'video/mp4', 'video/webm']);

create policy "editors upload assets"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'assets' and (select private.is_editor()));
create policy "editors list assets"
  on storage.objects for select to authenticated
  using (bucket_id = 'assets' and (select private.is_editor()));
create policy "editors remove assets"
  on storage.objects for delete to authenticated
  using (bucket_id = 'assets' and (select private.is_editor()));
