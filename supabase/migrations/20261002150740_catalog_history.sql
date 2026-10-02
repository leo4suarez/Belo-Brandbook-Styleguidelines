-- History: every saved version is kept so a change can be restored by hand.
create table public.doc_revisions (
  id bigint generated always as identity primary key,
  path text not null,
  data jsonb,
  version integer not null,
  saved_at timestamptz not null default now(),
  saved_by uuid,
  saved_by_name text
);
create index doc_revisions_path_idx on public.doc_revisions (path, id desc);
alter table public.doc_revisions enable row level security;
create policy "editors read history"
  on public.doc_revisions for select to authenticated using ((select private.is_editor()));

create or replace function private.keep_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.doc_revisions (path, data, version, saved_by, saved_by_name)
  values (new.path, new.data, new.version, new.updated_by, new.updated_by_name);
  return null;
end;
$$;
create trigger docs_keep_revision
  after insert or update on public.docs
  for each row execute function private.keep_revision();
