-- =============================================================================
-- TiffinOps — Required SQL fixes (run once in Supabase SQL editor)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- FIX 1: Add SECURITY DEFINER to the RLS helper functions.
--
-- Without it, is_active_user() and has_role() query public.users while being
-- called FROM a policy on public.users. PostgreSQL detects the recursion and
-- can return false for the whole policy, making every user's own row invisible
-- even though "auth.uid() = id" should grant access. SECURITY DEFINER makes
-- the functions run as the definer (postgres), bypassing RLS inside them.
-- ---------------------------------------------------------------------------

create or replace function public.is_active_user()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and status = 'active'
  )
$$;

create or replace function public.has_role(roles user_role[])
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.users
    where id = auth.uid()
      and status = 'active'
      and role = any(roles)
  )
$$;

-- Also fix current_app_user which has the same issue.
create or replace function public.current_app_user()
returns public.users
language sql stable security definer
set search_path = public
as $$
  select * from public.users where id = auth.uid()
$$;


-- ---------------------------------------------------------------------------
-- FIX 2: Auth trigger — auto-create public.users row on first Google sign-in.
--
-- Without this, if the app server doesn't have SUPABASE_SERVICE_ROLE_KEY set
-- (or the callback fails for any reason), the user gets stuck with no row.
-- This trigger fires on every INSERT into auth.users and is idempotent.
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, role, status)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    'viewer',
    'pending'
  )
  on conflict (id) do nothing;   -- idempotent: existing rows are untouched
  return new;
end;
$$;

-- Drop and re-create so this is safe to run multiple times.
drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_auth_user();
