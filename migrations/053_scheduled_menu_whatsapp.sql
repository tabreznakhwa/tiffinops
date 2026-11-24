-- Scheduled WhatsApp delivery of published meal menus to the owner/manager.
-- Messages are sent by Vercel cron through the existing DoubleTick integration.

alter table public.app_settings
  add column if not exists menu_whatsapp_enabled boolean not null default false,
  add column if not exists menu_whatsapp_from_number text,
  add column if not exists menu_whatsapp_owner_number text,
  add column if not exists menu_whatsapp_manager_number text;

create table if not exists public.menu_message_deliveries (
  id uuid primary key default gen_random_uuid(),
  menu_date date not null,
  meal_period meal_period not null,
  recipient_role text not null check (recipient_role in ('owner', 'manager')),
  recipient_phone text not null,
  status text not null default 'processing'
    check (status in ('processing', 'sent', 'skipped_session_expired', 'failed')),
  message_body text not null,
  error_detail text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (menu_date, meal_period, recipient_phone)
);

create index if not exists idx_menu_message_deliveries_recent
  on public.menu_message_deliveries(menu_date desc, meal_period, status);

alter table public.menu_message_deliveries enable row level security;

do $$ begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'menu_message_deliveries'
      and policyname = 'menu_message_deliveries_staff_read'
  ) then
    create policy menu_message_deliveries_staff_read
      on public.menu_message_deliveries
      for select to authenticated
      using (has_role(array['owner','manager']::user_role[]));
  end if;
end $$;
