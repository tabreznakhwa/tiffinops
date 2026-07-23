'use client'

import { useState, useTransition } from 'react'
import { CustomerModal } from './customer-modal'
import { CustomerFormFields } from './customer-form-fields'
import type { ReferralCustomerOption } from './customer-form-fields'
import { Button } from '@/components/ui/button'
import { createCustomer } from '@/lib/customers/actions'

export function AddCustomerModal({
  open,
  onClose,
  onSuccess,
  referralCustomers = [],
}: {
  open: boolean
  onClose: () => void
  onSuccess: () => void
  referralCustomers?: ReferralCustomerOption[]
}) {
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const result = await createCustomer(formData)
      if (result?.error) {
        setError(result.error)
      } else {
        onSuccess()
        onClose()
      }
    })
  }

  return (
    <CustomerModal title="Add Customer" open={open} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        <CustomerFormFields referralCustomers={referralCustomers} />

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
            {isPending ? 'Saving…' : 'Add Customer'}
          </Button>
        </div>
      </form>
    </CustomerModal>
  )
}
