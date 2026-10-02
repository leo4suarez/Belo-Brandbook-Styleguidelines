-- Editors. Helpers live in a schema the Data API does not expose.
create schema if not exists private;
grant usage on schema private to anon, authenticated;

create table private.editor_domains (
  domain text primary key check (domain = lower(domain))
);
create table private.editors (
  email text primary key check (email = lower(email))
);
alter table private.editor_domains enable row level security;
alter table private.editors enable row level security;

insert into private.editor_domains (domain) values ('paisanoscreando.com');

-- True when the signed-in user has a confirmed email that is listed in
-- private.editors or whose domain is listed in private.editor_domains.
create or replace function private.is_editor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select u.email_confirmed_at is not null
       and (exists (select 1 from private.editors e where e.email = lower(u.email))
            or exists (select 1 from private.editor_domains d where d.domain = split_part(lower(u.email), '@', 2)))
      from auth.users u
     where u.id = auth.uid()
  ), false);
$$;
revoke all on function private.is_editor() from public;
grant execute on function private.is_editor() to anon, authenticated;

-- Lets the page ask whether the current user can edit.
create or replace function public.can_edit()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$ select private.is_editor(); $$;
grant execute on function public.can_edit() to anon, authenticated;
