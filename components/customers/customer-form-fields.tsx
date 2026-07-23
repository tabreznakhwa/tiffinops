'use client'

import { useState } from 'react'
import type { Tables } from '@/lib/supabase/types'

type Customer = Tables<'customers'>

export type ReferralCustomerOption = {
  id: string
  full_name: string
  customer_code: string
  mobile_number: string
}

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = {
  border: '1px solid var(--color-border)',
} as const

export function CustomerFormFields({
  defaultValues,
  referralCustomers = [],
}: {
  defaultValues?: Partial<Customer>
  referralCustomers?: ReferralCustomerOption[]
}) {
  const selectedReferralCustomer = referralCustomers.find(c => c.id === defaultValues?.referred_by_customer_id) ?? null
  const hasExternalReferral = !!(defaultValues?.referrer_name || defaultValues?.referrer_phone)
  const [referralSource, setReferralSource] = useState<'none' | 'customer' | 'external'>(
    hasExternalReferral ? 'external' : defaultValues?.referred_by_customer_id ? 'customer' : 'none'
  )
  const [referralQuery, setReferralQuery] = useState('')
  const [selectedReferralCustomerId, setSelectedReferralCustomerId] = useState(defaultValues?.referred_by_customer_id ?? '')
  const [showReferralList, setShowReferralList] = useState(false)

  const filteredReferralCustomers = referralCustomers
    .filter(c => c.id !== defaultValues?.id)
    .filter(c => {
      const q = referralQuery.toLowerCase().trim()
      if (!q) return true
      return (
        c.full_name.toLowerCase().includes(q) ||
        c.customer_code.toLowerCase().includes(q) ||
        c.mobile_number.includes(q)
      )
    })

  return (
    <div className="space-y-4">
      {/* Full name */}
      <div>
        <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          Full Name <span style={{ color: 'var(--color-red)' }}>*</span>
        </label>
        <input
          name="full_name"
          defaultValue={defaultValues?.full_name ?? ''}
          required
          className={inputBase}
          style={inputStyle}
          placeholder="e.g. Ahmed Al Mansoori"
        />
      </div>

      {/* Mobile + WhatsApp */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            Mobile <span style={{ color: 'var(--color-red)' }}>*</span>
          </label>
          <input
            name="mobile_number"
            type="tel"
            defaultValue={defaultValues?.mobile_number ?? ''}
            required
            className={inputBase}
            style={inputStyle}
            placeholder="+971 50 XXX XXXX"
          />
        </div>
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            WhatsApp
          </label>
          <input
            name="whatsapp_number"
            type="tel"
            defaultValue={defaultValues?.whatsapp_number ?? ''}
            className={inputBase}
            style={inputStyle}
            placeholder="Leave blank if same as mobile"
          />
        </div>
      </div>

      {/* Plan type + Area */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            Plan Type <span style={{ color: 'var(--color-red)' }}>*</span>
          </label>
          <select
            name="customer_type"
            defaultValue={defaultValues?.customer_type ?? 'a_la_carte'}
            required
            className={inputBase}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="a_la_carte">A La Carte</option>
            <option value="fixed_menu">Fixed Menu (Tiffin)</option>
            <option value="hybrid">Hybrid</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            Area / Zone
          </label>
          <input
            name="area"
            defaultValue={defaultValues?.area ?? ''}
            className={inputBase}
            style={inputStyle}
            placeholder="e.g. Business Bay"
          />
        </div>
      </div>

      {/* Email */}
      <div>
        <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          Email
        </label>
        <input
          name="email"
          type="email"
          defaultValue={defaultValues?.email ?? ''}
          className={inputBase}
          style={inputStyle}
          placeholder="optional"
        />
      </div>

      {/* Referral */}
      <div className="space-y-3 rounded-[12px] p-3" style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}>
        <div>
          <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
            Referred By
          </label>
          <select
            name="referral_source"
            value={referralSource}
            onChange={e => {
              const next = e.target.value as 'none' | 'customer' | 'external'
              setReferralSource(next)
              setShowReferralList(false)
              if (next !== 'customer') setSelectedReferralCustomerId('')
            }}
            className={inputBase}
            style={{ ...inputStyle, cursor: 'pointer' }}
          >
            <option value="none">No referral</option>
            <option value="customer">Existing customer</option>
            <option value="external">Non-customer / outside person</option>
          </select>
        </div>

        {referralSource === 'customer' && (
          <div>
            <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
              Select Customer
            </label>
            <input type="hidden" name="referred_by_customer_id" value={selectedReferralCustomerId} />
            {selectedReferralCustomerId ? (
              <div
                className="mt-1 flex items-center justify-between gap-3 rounded-[11px] px-3 py-2.5"
                style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
              >
                <div>
                  <p className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                    {(referralCustomers.find(c => c.id === selectedReferralCustomerId) ?? selectedReferralCustomer)?.full_name}
                  </p>
                  <p className="text-xs" style={{ color: 'var(--color-muted)' }}>
                    {(referralCustomers.find(c => c.id === selectedReferralCustomerId) ?? selectedReferralCustomer)?.customer_code} · {(referralCustomers.find(c => c.id === selectedReferralCustomerId) ?? selectedReferralCustomer)?.mobile_number}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReferralCustomerId('')
                    setReferralQuery('')
                    setShowReferralList(true)
                  }}
                  className="text-xs font-bold"
                  style={{ color: 'var(--color-ember)' }}
                >
                  Change
                </button>
              </div>
            ) : (
              <div className="relative">
                <input
                  type="search"
                  value={referralQuery}
                  onChange={e => { setReferralQuery(e.target.value); setShowReferralList(true) }}
                  onFocus={() => setShowReferralList(true)}
                  className={inputBase}
                  style={inputStyle}
                  placeholder="Search by name, code or phone…"
                  required
                />
                {showReferralList && (
                  <div
                    className="absolute z-20 w-full mt-1 rounded-[10px] overflow-auto shadow-lg"
                    style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', maxHeight: 220 }}
                  >
                    {filteredReferralCustomers.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm" style={{ color: 'var(--color-muted)' }}>
                        No matching customers
                      </div>
                    ) : filteredReferralCustomers.slice(0, 10).map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setSelectedReferralCustomerId(c.id)
                          setReferralQuery('')
                          setShowReferralList(false)
                        }}
                        className="w-full flex flex-col px-3 py-2.5 text-left hover:bg-cream"
                        style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}
                      >
                        <span className="text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>{c.full_name}</span>
                        <span className="text-xs" style={{ color: 'var(--color-muted)' }}>{c.customer_code} · {c.mobile_number}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {referralSource === 'external' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                Referrer Name <span style={{ color: 'var(--color-red)' }}>*</span>
              </label>
              <input
                name="referrer_name"
                defaultValue={defaultValues?.referrer_name ?? ''}
                className={inputBase}
                style={inputStyle}
                placeholder="e.g. Sameer Khan"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
                Referrer Phone
              </label>
              <input
                name="referrer_phone"
                type="tel"
                defaultValue={defaultValues?.referrer_phone ?? ''}
                className={inputBase}
                style={inputStyle}
                placeholder="optional"
              />
            </div>
          </div>
        )}

        {referralSource !== 'none' && (
          <div>
            <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
              Referral Reward / Month
            </label>
            <input
              name="referral_reward_amount"
              type="number"
              min="0"
              step="0.01"
              defaultValue={defaultValues?.referral_reward_amount ?? '0.00'}
              className={inputBase}
              style={inputStyle}
              placeholder="0.00"
            />
            <p className="text-[11px] mt-1" style={{ color: 'var(--color-muted)' }}>
              Cash amount payable each active tiffin month.
            </p>
          </div>
        )}
      </div>

      {/* Delivery address */}
      <div>
        <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          Delivery Address
        </label>
        <textarea
          name="delivery_address"
          defaultValue={defaultValues?.delivery_address ?? ''}
          rows={2}
          className={`${inputBase} resize-none`}
          style={inputStyle}
          placeholder="Flat, building, street…"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="block text-sm font-semibold" style={{ color: 'var(--color-ink)' }}>
          Notes
        </label>
        <textarea
          name="notes"
          defaultValue={defaultValues?.notes ?? ''}
          rows={2}
          className={`${inputBase} resize-none`}
          style={inputStyle}
          placeholder="Allergy info, special requests…"
        />
      </div>
    </div>
  )
}
