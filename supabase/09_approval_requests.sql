-- =============================================================================
-- TiffinOps — Approval Requests table
-- Run once in Supabase SQL Editor
-- =============================================================================

-- Enums
do $$ begin
  create type public.approval_request_type as enum ('delete', 'edit');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_status as enum ('pending', 'approved', 'rejected');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.approval_target as enum ('order', 'payment', 'invoice');
exception when duplicate_object then null; end $$;

-- Table
create table if not exists public.approval_requests (
  id               uuid        primary key default gen_random_uuid(),
  request_type     public.approval_request_type not null,
  target_table     public.approval_target       not null,
  target_id        uuid        not null,
  reason           text        not null,
  proposed_changes jsonb,
  status           public.approval_status not null default 'pending',
  requested_by     uuid        not null references public.users(id),
  requested_at     timestamptz not null default now(),
  resolved_by      uuid        references public.users(id),
  resolved_at      timestamptz,
  resolution_note  text
);

-- RLS
alter table public.approval_requests enable row level security;

drop policy if exists "owners and managers can read approval_requests" on public.approval_requests;
create policy "owners and managers can read approval_requests"
  on public.approval_requests for select
  using (public.has_role(array['owner','manager']::user_role[]));

drop policy if exists "active users can request approval" on public.approval_requests;
create policy "active users can request approval"
  on public.approval_requests for insert
  with check (public.is_active_user() and requested_by = auth.uid());

drop policy if exists "owners and managers can resolve approval_requests" on public.approval_requests;
create policy "owners and managers can resolve approval_requests"
  on public.approval_requests for update
  using (public.has_role(array['owner','manager']::user_role[]));
