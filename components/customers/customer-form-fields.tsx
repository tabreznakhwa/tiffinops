'use client'

import type { Tables } from '@/lib/supabase/types'

type Customer = Tables<'customers'>

const inputBase =
  'mt-1 w-full rounded-[11px] px-3 py-2.5 text-sm bg-surface text-ink focus:outline-none focus:ring-1 focus:ring-saffron'
const inputStyle = {
  border: '1px solid var(--color-border)',
} as const

export function CustomerFormFields({
  defaultValues,
}: {
  defaultValues?: Partial<Customer>
}) {
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
