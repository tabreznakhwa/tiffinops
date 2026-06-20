-- Admin RPC functions for staff management.
-- Run as SECURITY DEFINER so they execute as the postgres superuser,
-- bypassing RLS entirely. Only callable by authenticated users (enforced
-- in the Next.js server action layer before these are invoked).

create or replace function public.admin_update_user_role(
  p_id   uuid,
  p_role user_role
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set role = p_role
  where id = p_id
    and role <> 'owner';
end;
$$;

create or replace function public.admin_update_user_status(
  p_id     uuid,
  p_status user_status
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set status = p_status
  where id = p_id
    and role <> 'owner';
end;
$$;

create or replace function public.admin_update_user_permissions(
  p_id                 uuid,
  p_can_record_payment boolean,
  p_can_see_financials boolean,
  p_can_export_reports boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.users
  set can_record_payment = p_can_record_payment,
      can_see_financials = p_can_see_financials,
      can_export_reports = p_can_export_reports
  where id = p_id
    and role <> 'owner';
end;
$$;
