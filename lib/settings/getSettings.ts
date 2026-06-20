import { createAdminClient } from '@/lib/supabase/admin'

export type AppSettings = {
  id: number
  business_name: string
  currency: string
  timezone: string
  default_billing_day: number
  invoice_prefix: string
  order_prefix: string
  payment_prefix: string
  customer_prefix: string
  vat_percent: string
  contact_phone: string | null
  contact_email: string | null
  country: string
  bank_account_name: string
  bank_iban: string
  bank_name: string
  updated_at: string
}

export const FALLBACK: AppSettings = {
  id: 1,
  business_name: 'Apna Chulha Restaurant LLC',
  currency: 'AED',
  timezone: 'Asia/Dubai',
  default_billing_day: 1,
  invoice_prefix: 'INV-',
  order_prefix: 'ORD-',
  payment_prefix: 'PAY-',
  customer_prefix: 'AC-',
  vat_percent: '5',
  contact_phone: null,
  contact_email: null,
  country: 'UAE',
  bank_account_name: 'Apna Chulha Restaurant LLC',
  bank_iban: 'AE330860000009271445425',
  bank_name: 'WIO BANK',
  updated_at: new Date().toISOString(),
}

export async function getSettings(): Promise<AppSettings> {
  const admin = createAdminClient()
  const { data } = await admin.from('app_settings').select('*').eq('id', 1).single()
  return (data as AppSettings | null) ?? FALLBACK
}

// VAT back-calculation: total × rate / (100 + rate)
// All prices are VAT-inclusive — never add VAT on top
export function extractVAT(
  totalInclVAT: number,
  vatRatePercent: number
): { exclVAT: number; vatAmount: number } {
  const divisor = 100 + vatRatePercent
  const exclVAT = (totalInclVAT * 100) / divisor
  return { exclVAT, vatAmount: totalInclVAT - exclVAT }
}
