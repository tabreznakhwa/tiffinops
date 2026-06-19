-- Add Gulf country configuration and bank detail fields to app_settings.
-- Allows each restaurant deployment to configure their own country, tax rate,
-- currency, and bank details without touching the code.

alter table public.app_settings
  add column if not exists country           text not null default 'UAE',
  add column if not exists bank_account_name text not null default 'Apna Chulha Restaurant LLC',
  add column if not exists bank_iban         text not null default 'AE330860000009271445425',
  add column if not exists bank_name         text not null default 'WIO BANK';
