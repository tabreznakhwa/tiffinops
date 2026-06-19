'use client'

import { useState, useTransition } from 'react'
import { CustomerModal } from './customer-modal'
import { CustomerFormFields } from './customer-form-fields'
import { Button } from '@/components/ui/button'
import { updateCustomer } from '@/lib/customers/actions'
import type { Tables } from '@/lib/supabase/types'

type Customer = Tables<'customers'>

export function EditCustomerModal({
  customer,
  open,
  onClose,
  onSuccess,
}: {
  customer: Customer
  open: boolean
  onClose: () => void
  onSuccess: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await updateCustomer(customer.id, formData)
      if (result?.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  return (
    <CustomerModal title="Edit Customer" open={open} onClose={onClose}>
      {/* Read-only code chip */}
      <div
        className="mb-4 px-3 py-2 rounded-[10px] flex items-center gap-2"
        style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}
      >
        <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>
          Code
        </span>
        <span className="font-display font-bold text-sm" style={{ color: 'var(--color-ink)' }}>
          {customer.customer_code}
        </span>
      </div>

      <form onSubmit={handleSubmit}>
        <CustomerFormFields defaultValues={customer} />

        {error && (
          <p className="mt-4 text-sm font-semibold" style={{ color: 'var(--color-red)' }}>
            {error}
          </p>
        )}

        <div className="mt-5 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            onClick={onClose}
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={isPending}
            className="w-full sm:w-auto"
          >
            {isPending ? 'Saving…' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </CustomerModal>
  )
}
