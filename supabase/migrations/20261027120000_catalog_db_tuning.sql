-- Tuning after a review against Supabase's Postgres best practices (v1.1.1). Nothing here changes who can read or
-- write what.

-- 1. History stays bounded. Every save keeps a full copy of the document (up to 2 MB), so an active month of editing
--    could fill the project's database. Each document keeps its newest 20 versions always, any version from the last
--    60 days, and never more than its newest 200. Pruned on save, through the (path, id desc) index.
create or replace function private.keep_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  keep_all bigint;  -- the 20th newest revision of this path: it and the newer ones always stay
  keep_max bigint;  -- the 200th newest: older ones go, whatever their age
begin
  insert into public.doc_revisions (path, data, version, saved_by, saved_by_name)
  values (new.path, new.data, new.version, new.updated_by, new.updated_by_name);

  select r.id into keep_all from public.doc_revisions r where r.path = new.path order by r.id desc offset 19 limit 1;
  if keep_all is not null then
    select r.id into keep_max from public.doc_revisions r where r.path = new.path order by r.id desc offset 199 limit 1;
    delete from public.doc_revisions r
     where r.path = new.path
       and r.id < keep_all
       and (r.saved_at < now() - interval '60 days' or r.id < coalesce(keep_max, 0));
  end if;
  return null;
end;
$$;
revoke all on function private.keep_revision() from public, anon, authenticated;

-- 2. Locked pages: one JSON path test on the tree instead of expanding every category and section per row, and the
--    editor check (computed once per query) first, so editors skip the tree lookup.
create or replace function private.page_locked(p_path text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_path like 'pages/%' and exists (
    select 1
      from public.docs t
     where t.path = 'catalog/tree'
       and jsonb_path_exists(t.data, '$.categories[*] ? (@.locked == true || @.locked == "true").subs[*] ? (@.id == $id)',
                             jsonb_build_object('id', substr(p_path, 7)))
  );
$$;
revoke all on function private.page_locked(text) from public;
grant execute on function private.page_locked(text) to anon, authenticated;

-- (the name was cut to Postgres' 63 characters when it was given)
alter policy "docs are readable by anyone with the link, locked pages by edit" on public.docs
  using ((select private.is_editor()) or not private.page_locked(path));

-- 3. Foreign keys get an index (deleting an account looks up the documents it saved last).
create index if not exists docs_updated_by_idx on public.docs (updated_by);
