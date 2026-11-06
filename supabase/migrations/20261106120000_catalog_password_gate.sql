-- Password gate: the catalog is read only by editors and by visitors who entered the shared password in the last 24
-- hours. A visitor gets an anonymous session (Supabase Auth, "Allow anonymous sign-ins" must be on) and unlocks it with
-- public.unlock(password); the page asks public.site_access() whether it can show the catalog.
-- The password is never stored in the repository: set it in the SQL Editor with
--   select private.set_site_password('the password');
-- Setting it again changes it and sends everyone (but editors) back to the password screen.

create extension if not exists pgcrypto with schema extensions;

-- The password, hashed with bcrypt. One row; `generation` grows with every change and voids older unlocks.
create table private.site_password (
  id boolean primary key default true check (id),
  hash text not null,
  generation integer not null default 1,
  updated_at timestamptz not null default now()
);
-- Visitors who unlocked the catalog, with the password generation they used.
create table private.viewers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  generation integer not null,
  unlocked_at timestamptz not null default now()
);
-- Wrong passwords, to slow down guessing: 5 per session every 10 minutes.
create table private.unlock_attempts (
  user_id uuid not null references auth.users (id) on delete cascade,
  at timestamptz not null default now()
);
create index unlock_attempts_user_at_idx on private.unlock_attempts (user_id, at);
alter table private.site_password enable row level security;
alter table private.viewers enable row level security;
alter table private.unlock_attempts enable row level security;

-- True while the signed-in visitor's unlock is less than 24 hours old and was made with the current password.
create or replace function private.is_viewer()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from private.viewers v
      join private.site_password p on p.generation = v.generation
     where v.user_id = (select auth.uid())
       and v.unlocked_at > now() - interval '24 hours'
  );
$$;
revoke all on function private.is_viewer() from public;
grant execute on function private.is_viewer() to anon, authenticated;

-- What the page asks first: is the visitor an editor, and until when can it read the catalog with the password.
create or replace function public.site_access()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'editor', private.is_editor(),
    'until', (select v.unlocked_at + interval '24 hours'
                from private.viewers v
                join private.site_password p on p.generation = v.generation
               where v.user_id = (select auth.uid())
                 and v.unlocked_at > now() - interval '24 hours')
  );
$$;
revoke all on function public.site_access() from public;
grant execute on function public.site_access() to anon, authenticated;

-- Checks the password for the signed-in (anonymous) visitor. Returns { ok: true, until } or { ok: false, reason }
-- with reason 'wrong' or 'too_many'.
create or replace function public.unlock(p_password text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
  pw private.site_password;
  fails integer;
begin
  if me is null then
    raise exception 'sign in first' using errcode = 'PT401';
  end if;
  delete from private.unlock_attempts where at < now() - interval '1 day';
  select count(*) into fails from private.unlock_attempts where user_id = me and at > now() - interval '10 minutes';
  if fails >= 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_many');
  end if;
  select * into pw from private.site_password where id;
  if pw.hash is null or p_password is null or extensions.crypt(p_password, pw.hash) <> pw.hash then
    insert into private.unlock_attempts (user_id) values (me);
    return jsonb_build_object('ok', false, 'reason', 'wrong');
  end if;
  delete from private.unlock_attempts where user_id = me;
  delete from private.viewers where unlocked_at < now() - interval '2 days';
  insert into private.viewers (user_id, generation, unlocked_at)
  values (me, pw.generation, now())
  on conflict (user_id) do update set generation = excluded.generation, unlocked_at = excluded.unlocked_at;
  return jsonb_build_object('ok', true, 'until', now() + interval '24 hours');
end;
$$;
revoke all on function public.unlock(text) from public, anon;
grant execute on function public.unlock(text) to authenticated;

-- Sets or changes the password (SQL Editor only: the private schema is not exposed to the Data API).
create or replace function private.set_site_password(p_password text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(coalesce(p_password, '')) < 10 then
    raise exception 'The password needs at least 10 characters';
  end if;
  insert into private.site_password (id, hash, generation)
  values (true, extensions.crypt(p_password, extensions.gen_salt('bf', 10)), 1)
  on conflict (id) do update
    set hash = excluded.hash, generation = private.site_password.generation + 1, updated_at = now();
  return 'Password saved. Everyone but editors will be asked for it.';
end;
$$;
revoke all on function private.set_site_password(text) from public, anon, authenticated;

-- Reading the catalog: editors everything; visitors with the password the pages outside locked categories.
-- (the policy's name was cut to Postgres' 63 characters when it was given)
alter policy "docs are readable by anyone with the link, locked pages by edit" on public.docs
  using ((select private.is_editor()) or ((select private.is_viewer()) and not private.page_locked(path)));
alter policy "docs are readable by anyone with the link, locked pages by edit" on public.docs
  rename to "docs are readable by editors and by password visitors";
