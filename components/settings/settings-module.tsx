'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { updateSettings } from '@/lib/settings/actions'
import type { AppSettings } from '@/lib/settings/getSettings'

// ── Gulf VAT / Currency map ───────────────────────────────────────────────────

const GULF_MAP: Record<string, { vat: string; currency: string }> = {
  'UAE':          { vat: '5',  currency: 'AED' },
  'Saudi Arabia': { vat: '15', currency: 'SAR' },
  'Bahrain':      { vat: '10', currency: 'BHD' },
  'Oman':         { vat: '5',  currency: 'OMR' },
  'Kuwait':       { vat: '0',  currency: 'KWD' },
  'Qatar':        { vat: '0',  currency: 'QAR' },
}

const GULF_COUNTRIES = Object.keys(GULF_MAP)

// ── Shared input style ────────────────────────────────────────────────────────

const inputClass =
  'w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-2 transition-shadow'
const inputStyle = {
  background: 'var(--color-cream)',
  border: '1px solid var(--color-border)',
  color: 'var(--color-ink)',
  '--tw-ring-color': 'var(--color-saffron)',
} as React.CSSProperties

// ── Field ─────────────────────────────────────────────────────────────────────

function Field({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div>
      <label
        className="block text-xs font-semibold mb-1.5"
        style={{ color: 'var(--color-muted)' }}
      >
        {label}
      </label>
      {children}
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}

// ── Section card ──────────────────────────────────────────────────────────────

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className="rounded-[14px] overflow-hidden"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center justify-between px-5 py-4 text-left"
      >
        <h2 className="font-display font-bold text-[16px]" style={{ color: 'var(--color-ink)' }}>
          {title}
        </h2>
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="w-4 h-4 flex-shrink-0 transition-transform"
          style={{
            color: 'var(--color-muted)',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          className="px-5 pb-5 grid gap-4"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <div className="pt-1" />
          {children}
        </div>
      )}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function SettingsModule({ settings }: { settings: AppSettings }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  // Form state — initialise from settings prop
  const [businessName,    setBusinessName]    = useState(settings.business_name)
  const [contactPhone,    setContactPhone]    = useState(settings.contact_phone ?? '')
  const [contactEmail,    setContactEmail]    = useState(settings.contact_email ?? '')

  const [country,         setCountry]         = useState(settings.country)
  const [vatPercent,      setVatPercent]      = useState(settings.vat_percent)
  const [currency,        setCurrency]        = useState(settings.currency)

  const [bankAccountName, setBankAccountName] = useState(settings.bank_account_name)
  const [bankIban,        setBankIban]        = useState(settings.bank_iban)
  const [bankName,        setBankName]        = useState(settings.bank_name)

  const [invoicePrefix,   setInvoicePrefix]   = useState(settings.invoice_prefix)
  const [orderPrefix,     setOrderPrefix]     = useState(settings.order_prefix)
  const [paymentPrefix,   setPaymentPrefix]   = useState(settings.payment_prefix)
  const [customerPrefix,  setCustomerPrefix]  = useState(settings.customer_prefix)
  const [billingDay,      setBillingDay]      = useState(String(settings.default_billing_day))

  const [success,  setSuccess]  = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // When country changes, auto-fill VAT and currency
  function handleCountryChange(newCountry: string) {
    setCountry(newCountry)
    const cfg = GULF_MAP[newCountry]
    if (cfg) {
      setVatPercent(cfg.vat)
      setCurrency(cfg.currency)
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSuccess(false)
    setErrorMsg('')

    startTransition(async () => {
      const result = await updateSettings({
        business_name:       businessName,
        contact_phone:       contactPhone || null,
        contact_email:       contactEmail || null,
        country: country as 'UAE' | 'Saudi Arabia' | 'Bahrain' | 'Oman' | 'Kuwait' | 'Qatar',
        vat_percent:         vatPercent,
        currency,
        bank_account_name:   bankAccountName,
        bank_iban:           bankIban,
        bank_name:           bankName,
        invoice_prefix:      invoicePrefix,
        order_prefix:        orderPrefix,
        payment_prefix:      paymentPrefix,
        customer_prefix:     customerPrefix,
        default_billing_day: billingDay,
      })

      if (result.error) {
        setErrorMsg(result.error)
        return
      }

      setSuccess(true)
      router.refresh()
    })
  }

  return (
    <form onSubmit={handleSubmit}>
      {/* Page header */}
      <div className="mb-6">
        <p
          className="text-xs font-bold uppercase tracking-widest"
          style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
        >
          Admin
        </p>
        <h1
          className="font-display font-bold text-[25px] mt-0.5"
          style={{ color: 'var(--color-ink)' }}
        >
          Settings
        </h1>
      </div>

      <div className="space-y-4">
        {/* ── Section 1: Business Info ──────────────────────────────────────── */}
        <Section title="Business Info">
          <Field label="Business Name *">
            <input
              type="text"
              value={businessName}
              onChange={e => setBusinessName(e.target.value)}
              required
              placeholder="e.g. Apna Chulha Restaurant LLC"
              className={inputClass}
              style={inputStyle}
            />
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Contact Phone">
              <input
                type="tel"
                value={contactPhone}
                onChange={e => setContactPhone(e.target.value)}
                placeholder="+971 50 123 4567"
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field label="Contact Email">
              <input
                type="email"
                value={contactEmail}
                onChange={e => setContactEmail(e.target.value)}
                placeholder="hello@restaurant.com"
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>
        </Section>

        {/* ── Section 2: Location & Tax ────────────────────────────────────── */}
        <Section title="Location &amp; Tax">
          <Field label="Country *">
            <select
              value={country}
              onChange={e => handleCountryChange(e.target.value)}
              required
              className={inputClass}
              style={inputStyle}
            >
              {GULF_COUNTRIES.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>

          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="VAT Rate" hint="% (inclusive pricing — VAT is already in the price)">
              <input
                type="number"
                value={vatPercent}
                onChange={e => setVatPercent(e.target.value)}
                min="0"
                max="100"
                step="0.01"
                required
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field label="Currency" hint="Auto-filled from country; can override">
              <input
                type="text"
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                maxLength={10}
                placeholder="AED"
                required
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>
        </Section>

        {/* ── Section 3: Bank Details ───────────────────────────────────────── */}
        <Section title="Bank Details" defaultOpen={false}>
          <div
            className="text-xs px-3 py-2 rounded-[8px]"
            style={{
              background: 'var(--color-blue-soft, #EFF6FF)',
              color: 'var(--color-blue)',
              border: '1px solid #BFDBFE',
            }}
          >
            These appear on every printed invoice and bill.
          </div>

          <Field label="Account Name">
            <input
              type="text"
              value={bankAccountName}
              onChange={e => setBankAccountName(e.target.value)}
              placeholder="Apna Chulha Restaurant LLC"
              className={inputClass}
              style={inputStyle}
            />
          </Field>

          <Field label="IBAN">
            <input
              type="text"
              value={bankIban}
              onChange={e => setBankIban(e.target.value)}
              placeholder="AE33 0860 0000 0927 1445 425"
              className={inputClass}
              style={inputStyle}
            />
          </Field>

          <Field label="Bank Name">
            <input
              type="text"
              value={bankName}
              onChange={e => setBankName(e.target.value)}
              placeholder="WIO Bank"
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </Section>

        {/* ── Section 4: Number Prefixes ────────────────────────────────────── */}
        <Section title="Number Prefixes" defaultOpen={false}>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Invoice Prefix *">
              <input
                type="text"
                value={invoicePrefix}
                onChange={e => setInvoicePrefix(e.target.value)}
                placeholder="INV-"
                required
                maxLength={20}
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field label="Order Prefix *">
              <input
                type="text"
                value={orderPrefix}
                onChange={e => setOrderPrefix(e.target.value)}
                placeholder="ORD-"
                required
                maxLength={20}
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field label="Payment Prefix *">
              <input
                type="text"
                value={paymentPrefix}
                onChange={e => setPaymentPrefix(e.target.value)}
                placeholder="PAY-"
                required
                maxLength={20}
                className={inputClass}
                style={inputStyle}
              />
            </Field>

            <Field label="Customer Prefix *">
              <input
                type="text"
                value={customerPrefix}
                onChange={e => setCustomerPrefix(e.target.value)}
                placeholder="AC-"
                required
                maxLength={20}
                className={inputClass}
                style={inputStyle}
              />
            </Field>
          </div>

          <Field label="Default Billing Day" hint="Day of month invoices are generated (1–28)">
            <input
              type="number"
              value={billingDay}
              onChange={e => setBillingDay(e.target.value)}
              min="1"
              max="28"
              required
              className={inputClass}
              style={inputStyle}
            />
          </Field>
        </Section>

        {/* ── Save bar ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={isPending}
            className="px-6 py-2.5 rounded-[10px] text-sm font-semibold disabled:opacity-60 transition-opacity"
            style={{ background: 'var(--color-saffron)', color: '#fff' }}
          >
            {isPending ? 'Saving…' : 'Save Settings'}
          </button>

          {success && !isPending && (
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--color-green)' }}
            >
              Settings saved
            </span>
          )}

          {errorMsg && !isPending && (
            <span
              className="text-sm font-semibold"
              style={{ color: 'var(--color-red)' }}
            >
              {errorMsg}
            </span>
          )}
        </div>
      </div>
    </form>
  )
}
