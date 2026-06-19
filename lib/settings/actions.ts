'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAuth } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

export type SettingsActionResult = { error?: string }

const GULF_COUNTRIES = ['UAE', 'Saudi Arabia', 'Bahrain', 'Oman', 'Kuwait', 'Qatar'] as const

const SettingsSchema = z.object({
  business_name:     z.string().min(1, 'Business name is required').max(120),
  contact_phone:     z.string().max(30).nullable().optional(),
  contact_email:     z.string().email('Enter a valid email address').max(120).nullable().optional(),
  country:           z.enum(GULF_COUNTRIES, { message: 'Select a valid country' }),
  vat_percent:       z.coerce.number().min(0, 'VAT cannot be negative').max(100, 'VAT cannot exceed 100%'),
  currency:          z.string().min(1, 'Currency is required').max(10),
  bank_account_name: z.string().max(120).optional().default(''),
  bank_iban:         z.string().max(80).optional().default(''),
  bank_name:         z.string().max(120).optional().default(''),
  invoice_prefix:    z.string().min(1, 'Invoice prefix is required').max(20),
  order_prefix:      z.string().min(1, 'Order prefix is required').max(20),
  payment_prefix:    z.string().min(1, 'Payment prefix is required').max(20),
  customer_prefix:   z.string().min(1, 'Customer prefix is required').max(20),
  default_billing_day: z.coerce.number().int().min(1).max(28),
})

export type UpdateSettingsInput = z.input<typeof SettingsSchema>

export async function updateSettings(input: UpdateSettingsInput): Promise<SettingsActionResult> {
  const caller = await requireAuth()
  if (caller.role !== 'owner') return { error: 'Only the owner can update settings' }

  const parsed = SettingsSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? 'Invalid input' }

  const {
    vat_percent,
    contact_phone,
    contact_email,
    bank_account_name,
    bank_iban,
    bank_name,
    ...rest
  } = parsed.data

  const admin = createAdminClient()
  const { error } = await admin
    .from('app_settings')
    .update({
      ...rest,
      vat_percent:       String(vat_percent),
      contact_phone:     contact_phone ?? null,
      contact_email:     contact_email ?? null,
      bank_account_name: bank_account_name ?? '',
      bank_iban:         bank_iban ?? '',
      bank_name:         bank_name ?? '',
      updated_at:        new Date().toISOString(),
    })
    .eq('id', 1)

  if (error) return { error: error.message }

  revalidatePath('/settings')
  revalidatePath('/')
  return {}
}
