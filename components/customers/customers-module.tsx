'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Plus, Search, Edit2, Eye } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { AddCustomerModal } from './add-customer-modal'
import { EditCustomerModal } from './edit-customer-modal'
import { useAppSettings } from '@/components/settings/settings-context'
import type { Tables, Enums } from '@/lib/supabase/types'
import type { ReferralCustomerOption } from './customer-form-fields'

type Customer = Tables<'customers'>

// ── Badge helpers ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  Enums<'customer_status'>,
  { label: string; bg: string; color: string }
> = {
  active:      { label: 'Active',      bg: 'var(--color-green-soft)',  color: 'var(--color-green)'  },
  paused:      { label: 'Paused',      bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  inactive:    { label: 'Inactive',    bg: 'var(--color-border)',      color: 'var(--color-muted)'  },
  blacklisted: { label: 'Blacklisted', bg: 'var(--color-red-soft)',    color: 'var(--color-red)'    },
}

const PLAN_CONFIG: Record<
  Enums<'customer_type'>,
  { label: string; bg: string; color: string }
> = {
  a_la_carte: { label: 'A La Carte',  bg: 'var(--color-saffron-soft)', color: 'var(--color-ember)'  },
  fixed_menu: { label: 'Fixed Menu',  bg: 'var(--color-purple-soft)',  color: 'var(--color-purple)' },
  hybrid:     { label: 'Hybrid',      bg: 'var(--color-blue-soft)',    color: 'var(--color-blue)'   },
}

function StatusBadge({ status }: { status: Enums<'customer_status'> }) {
  const cfg = STATUS_CONFIG[status]
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

function PlanBadge({ type }: { type: Enums<'customer_type'> }) {
  const cfg = PLAN_CONFIG[type]
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-pill text-[11px] font-bold"
      style={{ background: cfg.bg, color: cfg.color }}
    >
      {cfg.label}
    </span>
  )
}

// ── Select helper ─────────────────────────────────────────────────────────────

function FilterSelect({
  value,
  onChange,
  children,
}: {
  value: string
  onChange: (v: string) => void
  children: React.ReactNode
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm rounded-[10px] px-3 py-2 cursor-pointer focus:outline-none"
      style={{
        background: 'var(--color-surface)',
        border: '1px solid var(--color-border)',
        color: 'var(--color-ink)',
      }}
    >
      {children}
    </select>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function CustomersModule({
  customers,
  canWrite,
  balances = {},
  referralCustomers,
}: {
  customers: Customer[]
  canWrite: boolean
  balances?: Record<string, number>
  referralCustomers?: ReferralCustomerOption[]
}) {
  const router = useRouter()
  const { currency } = useAppSettings()
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterArea, setFilterArea] = useState('all')
  const [addOpen, setAddOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null)

  const areas = useMemo(
    () =>
      [...new Set(customers.map((c) => c.area).filter(Boolean) as string[])].sort(),
    [customers]
  )
  const referralOptions = useMemo<ReferralCustomerOption[]>(
    () => referralCustomers ?? customers.map(c => ({
      id: c.id,
      full_name: c.full_name,
      customer_code: c.customer_code,
      mobile_number: c.mobile_number,
    })),
    [customers, referralCustomers]
  )

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    return customers.filter((c) => {
      if (filterStatus !== 'all' && c.status !== filterStatus) return false
      if (filterType !== 'all' && c.customer_type !== filterType) return false
      if (filterArea !== 'all' && c.area !== filterArea) return false
      if (q) {
        return (
          c.full_name.toLowerCase().includes(q) ||
          c.customer_code.toLowerCase().includes(q) ||
          c.mobile_number.includes(q) ||
          (c.area?.toLowerCase() ?? '').includes(q)
        )
      }
      return true
    })
  }, [customers, search, filterStatus, filterType, filterArea])

  function handleDone() {
    router.refresh()
  }

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p
            className="text-xs font-bold uppercase tracking-widest"
            style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}
          >
            Customers
          </p>
          <h1
            className="font-display font-bold text-[25px] mt-0.5"
            style={{ color: 'var(--color-ink)' }}
          >
            {filtered.length}
            {filtered.length !== customers.length && (
              <span className="text-[16px] font-semibold ml-1.5" style={{ color: 'var(--color-muted)' }}>
                of {customers.length}
              </span>
            )}
          </h1>
        </div>
        {canWrite && (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setAddOpen(true)}
            className="flex-shrink-0 mt-1"
          >
            <Plus size={15} />
            Add Customer
          </Button>
        )}
      </div>

      {/* Search + filters */}
      <div className="space-y-3 mb-5">
        <div className="relative">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--color-muted)' }}
          />
          <input
            type="search"
            placeholder="Search name, code, or phone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 text-sm rounded-[11px] focus:outline-none"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-ink)',
            }}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <FilterSelect value={filterStatus} onChange={setFilterStatus}>
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="paused">Paused</option>
            <option value="inactive">Inactive</option>
            <option value="blacklisted">Blacklisted</option>
          </FilterSelect>

          <FilterSelect value={filterType} onChange={setFilterType}>
            <option value="all">All Plans</option>
            <option value="a_la_carte">A La Carte</option>
            <option value="fixed_menu">Fixed Menu</option>
            <option value="hybrid">Hybrid</option>
          </FilterSelect>

          {areas.length > 0 && (
            <FilterSelect value={filterArea} onChange={setFilterArea}>
              <option value="all">All Areas</option>
              {areas.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </FilterSelect>
          )}
        </div>
      </div>

      {/* Table */}
      {filtered.length === 0 ? (
        <div className="py-16 text-center" style={{ color: 'var(--color-muted)' }}>
          <p className="font-semibold text-[15px]">No customers found</p>
          <p className="text-sm mt-1">Try adjusting your search or filters</p>
        </div>
      ) : (
        <div
          className="rounded-[14px] overflow-hidden"
          style={{
            border: '1px solid var(--color-border)',
            background: 'var(--color-surface)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[520px]">
              <thead>
                <tr style={{ background: 'var(--color-cream)', borderBottom: '1px solid var(--color-border)' }}>
                  {['Customer', 'Phone', 'Area', 'Plan', 'Balance', 'Status', ''].map((h, i) => (
                    <th
                      key={i}
                      className={`text-left px-4 py-3 text-[11px] font-bold uppercase tracking-wide ${
                        h === 'Phone' ? 'hidden sm:table-cell' :
                        h === 'Area'  ? 'hidden md:table-cell' :
                        h === 'Balance' ? 'hidden sm:table-cell' :
                        h === 'Status'  ? 'hidden sm:table-cell' : ''
                      }`}
                      style={{ color: 'var(--color-muted)' }}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((c, i) => (
                  <tr
                    key={c.id}
                    className="transition-colors hover:bg-cream"
                    style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}
                  >
                    {/* Customer */}
                    <td className="px-4 py-3">
                      <div className="font-semibold" style={{ color: 'var(--color-ink)' }}>
                        {c.full_name}
                      </div>
                      <div className="text-[11px] font-mono mt-0.5" style={{ color: 'var(--color-muted)' }}>
                        {c.customer_code}
                      </div>
                    </td>
                    {/* Phone */}
                    <td className="hidden sm:table-cell px-4 py-3" style={{ color: 'var(--color-muted)' }}>
                      {c.mobile_number}
                    </td>
                    {/* Area */}
                    <td className="hidden md:table-cell px-4 py-3" style={{ color: 'var(--color-muted)' }}>
                      {c.area || '—'}
                    </td>
                    {/* Plan */}
                    <td className="px-4 py-3">
                      <PlanBadge type={c.customer_type} />
                    </td>
                    {/* Balance */}
                    <td className="hidden sm:table-cell px-4 py-3 text-right num font-semibold">
                      {(() => {
                        const bal = balances[c.id]
                        if (bal === undefined || bal === 0) {
                          return <span style={{ color: 'var(--color-muted)' }}>{currency} 0.00</span>
                        }
                        if (bal > 0) {
                          return (
                            <span style={{ color: 'var(--color-red)' }}>
                              {currency} {bal.toFixed(2)}
                            </span>
                          )
                        }
                        return (
                          <span style={{ color: 'var(--color-green)', fontSize: 11 }}>
                            CR {Math.abs(bal).toFixed(2)}
                          </span>
                        )
                      })()}
                    </td>
                    {/* Status */}
                    <td className="hidden sm:table-cell px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && (
                          <button
                            onClick={() => setEditingCustomer(c)}
                            className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-cream"
                            title="Edit"
                            aria-label={`Edit ${c.full_name}`}
                          >
                            <Edit2 size={14} style={{ color: 'var(--color-muted)' }} />
                          </button>
                        )}
                        <Link
                          href={`/customers/${c.id}`}
                          className="h-8 w-8 flex items-center justify-center rounded-lg transition-colors hover:bg-cream"
                          title="View"
                          aria-label={`View ${c.full_name}`}
                        >
                          <Eye size={14} style={{ color: 'var(--color-muted)' }} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add modal */}
      <AddCustomerModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSuccess={handleDone}
        referralCustomers={referralOptions}
      />

      {/* Edit modal */}
      {editingCustomer && (
        <EditCustomerModal
          customer={editingCustomer}
          open
          onClose={() => setEditingCustomer(null)}
          onSuccess={() => {
            handleDone()
            setEditingCustomer(null)
          }}
          referralCustomers={referralOptions}
        />
      )}
    </div>
  )
}
