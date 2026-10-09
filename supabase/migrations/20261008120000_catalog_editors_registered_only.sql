-- Editors: only the accounts that already exist. A domain no longer grants access by itself,
-- and nobody can create a new account unless their email was added to private.editors first.

-- Everyone who can edit today keeps it, now listed by email.
insert into private.editors (email)
select lower(u.email)
  from auth.users u
 where u.email is not null
   and u.email_confirmed_at is not null
   and split_part(lower(u.email), '@', 2) in (select d.domain from private.editor_domains d)
on conflict do nothing;

-- New accounts from these domains no longer become editors.
delete from private.editor_domains;

-- Sign-ups are closed: Auth fails to create a user whose email is not listed in private.editors.
-- (Google sign-in comes back with error_description "Database error saving new user".)
create or replace function private.block_unlisted_signups()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is null or not exists (select 1 from private.editors e where e.email = lower(new.email)) then
    raise exception 'sign-ups are closed for %', coalesce(new.email, 'this account');
  end if;
  return new;
end;
$$;
revoke all on function private.block_unlisted_signups() from public;

create trigger auth_users_block_unlisted_signups
  before insert on auth.users
  for each row execute function private.block_unlisted_signups();
