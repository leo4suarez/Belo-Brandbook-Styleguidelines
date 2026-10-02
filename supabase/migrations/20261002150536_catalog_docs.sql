-- Documents: one JSON document per path (catalog/tree, pages/{subId}).
create table public.docs (
  path text primary key check (path ~ '^(catalog/tree|pages/[A-Za-z0-9_-]{1,64})$'),
  data jsonb not null check (octet_length(data::text) <= 2000000),
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  updated_by_name text
);
alter table public.docs enable row level security;

create policy "docs are readable by anyone with the link"
  on public.docs for select to anon, authenticated using (true);
create policy "editors insert docs"
  on public.docs for insert to authenticated with check ((select private.is_editor()));
create policy "editors update docs"
  on public.docs for update to authenticated using ((select private.is_editor())) with check ((select private.is_editor()));
create policy "editors delete docs"
  on public.docs for delete to authenticated using ((select private.is_editor()));

-- Saves a whole document only if it is still at p_expected (0 = it must not exist yet).
-- p_data null deletes it. Errors: PT403 'forbidden', PT409 'conflict'.
create or replace function public.save_doc(p_path text, p_data jsonb, p_expected integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  r public.docs;
  who text := coalesce(
    nullif(auth.jwt() -> 'user_metadata' ->> 'full_name', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'name', ''),
    auth.jwt() ->> 'email');
begin
  if not private.is_editor() then
    raise exception 'forbidden' using errcode = 'PT403';
  end if;

  if p_data is null then
    delete from public.docs d where d.path = p_path and d.version = p_expected;
    if not found and exists (select 1 from public.docs d where d.path = p_path) then
      raise exception 'conflict' using errcode = 'PT409';
    end if;
    return jsonb_build_object('version', 0);
  end if;

  if coalesce(p_expected, 0) = 0 then
    insert into public.docs (path, data, updated_by, updated_by_name)
    values (p_path, p_data, auth.uid(), who)
    on conflict (path) do nothing
    returning * into r;
  else
    update public.docs d
       set data = p_data, version = d.version + 1, updated_at = now(), updated_by = auth.uid(), updated_by_name = who
     where d.path = p_path and d.version = p_expected
    returning * into r;
  end if;
  if not found then
    raise exception 'conflict' using errcode = 'PT409';
  end if;
  return jsonb_build_object('version', r.version, 'updated_at', r.updated_at, 'updated_by', r.updated_by, 'updated_by_name', r.updated_by_name);
end;
$$;
revoke all on function public.save_doc(text, jsonb, integer) from public, anon;
grant execute on function public.save_doc(text, jsonb, integer) to authenticated;
