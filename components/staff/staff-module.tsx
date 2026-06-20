'use client'

import { useState } from 'react'
import { Plus, X, Mail, Shield } from 'lucide-react'
import {
  inviteStaff,
  updateStaffRole,
  updateStaffStatus,
  updateStaffPermissions,
} from '@/lib/staff/actions'
import type { Tables, Enums } from '@/lib/supabase/types'

type User       = Tables<'users'>
type UserRole   = Enums<'user_role'>
type UserStatus = Enums<'user_status'>

// ── Role config ───────────────────────────────────────────────────────────────

const ROLE_CONFIG: Record<UserRole, { label: string; desc: string; bg: string; color: string }> = {
  owner:      { label: 'Owner',      desc: 'Full access + staff management',            bg: '#FEF3C7',                  color: '#92400E'             },
  manager:    { label: 'Manager',    desc: 'Full ops access, no staff management',       bg: 'var(--color-purple-soft)', color: 'var(--color-purple)' },
  accounts:   { label: 'Accounts',   desc: 'Payments, bills, reports & financials',      bg: 'var(--color-blue-soft)',   color: 'var(--color-blue)'   },
  data_entry: { label: 'Data Entry', desc: 'Customers, orders & packing. No financials', bg: 'var(--color-green-soft)', color: 'var(--color-green)'  },
  packer:     { label: 'Packer',     desc: 'Packing module only',                        bg: '#FFF7ED',                  color: '#C2410C'             },
  viewer:     { label: 'Viewer',     desc: 'Read-only access to all modules',            bg: 'var(--color-border)',     color: 'var(--color-muted)'  },
}

const ASSIGNABLE: UserRole[] = ['manager', 'accounts', 'data_entry', 'packer', 'viewer']

const STATUS_CONFIG: Record<UserStatus, { label: string; bg: string; color: string }> = {
  active:   { label: 'Active',   bg: 'var(--color-green-soft)', color: 'var(--color-green)' },
  pending:  { label: 'Pending',  bg: '#FEF3C7',                 color: '#92400E'            },
  inactive: { label: 'Inactive', bg: 'var(--color-border)',     color: 'var(--color-muted)' },
}

// ── Module access matrix (read-only info, shown in the role guide) ────────────

const MODULE_ACCESS: { module: string; owner: boolean; manager: boolean; accounts: boolean; data_entry: boolean; packer: boolean; viewer: boolean }[] = [
  { module: 'Customers',       owner: true,  manager: true,  accounts: false, data_entry: true,  packer: false, viewer: true  },
  { module: 'Orders',          owner: true,  manager: true,  accounts: false, data_entry: true,  packer: false, viewer: true  },
  { module: 'Menu',            owner: true,  manager: true,  accounts: false, data_entry: true,  packer: false, viewer: true  },
  { module: 'Fixed Menu',      owner: true,  manager: true,  accounts: false, data_entry: true,  packer: false, viewer: true  },
  { module: 'Packing',         owner: true,  manager: true,  accounts: false, data_entry: true,  packer: true,  viewer: true  },
  { module: 'Deliveries',      owner: true,  manager: true,  accounts: false, data_entry: true,  packer: false, viewer: true  },
  { module: 'Payments',        owner: true,  manager: true,  accounts: true,  data_entry: false, packer: false, viewer: false },
  { module: 'Reports',         owner: true,  manager: true,  accounts: true,  data_entry: false, packer: false, viewer: false },
  { module: 'A La Carte Bill', owner: true,  manager: true,  accounts: true,  data_entry: false, packer: false, viewer: false },
  { module: 'Staff Mgmt',      owner: true,  manager: false, accounts: false, data_entry: false, packer: false, viewer: false },
]

// ── Permission toggle ─────────────────────────────────────────────────────────

type PermValue = boolean | null

function PermToggle({
  value,
  label,
  onChange,
  disabled,
}: {
  value: PermValue
  label: string
  onChange: (next: PermValue) => void
  disabled?: boolean
}) {
  function cycle() {
    if (disabled) return
    // null → true → false → null
    if (value === null)  onChange(true)
    else if (value === true)  onChange(false)
    else onChange(null)
  }

  const bg    = value === true  ? 'var(--color-green-soft)'  :
                value === false ? 'var(--color-red-soft)'    : 'var(--color-border)'
  const color = value === true  ? 'var(--color-green)'       :
                value === false ? 'var(--color-red)'         : 'var(--color-muted)'
  const text  = value === true  ? '✓ Yes'                    :
                value === false ? '✗ No'                     : 'Auto'

  return (
    <button
      onClick={cycle}
      disabled={disabled}
      title={value === null ? `${label}: using role default` : `${label}: explicitly ${value ? 'enabled' : 'disabled'} (click to change)`}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-[6px] text-[11px] font-bold transition-colors disabled:cursor-not-allowed"
      style={{ background: bg, color }}
    >
      {text}
    </button>
  )
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({ onClose }: { onClose: () => void }) {
  const [fullName, setFullName] = useState('')
  const [email, setEmail]       = useState('')
  const [role, setRole]         = useState<UserRole>('data_entry')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [sent, setSent]         = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    const result = await inviteStaff({ email, full_name: fullName, role })
    setLoading(false)
    if (result.error) { setError(result.error); return }
    setSent(true)
    window.location.reload()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(34,26,19,.55)' }}
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <div
        className="relative w-full max-w-md rounded-[18px] p-6 shadow-xl"
        style={{ background: 'var(--color-surface)' }}
      >
        <button
          onClick={onClose}
          className="absolute right-4 top-4 w-8 h-8 flex items-center justify-center rounded-full"
          style={{ color: 'var(--color-muted)' }}
        >
          <X size={18} />
        </button>

        <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
          Staff
        </p>
        <h2 className="font-display font-bold text-[20px] mb-5" style={{ color: 'var(--color-ink)' }}>
          Invite Staff Member
        </h2>

        {sent ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: 'var(--color-green-soft)' }}>
              <Mail size={22} style={{ color: 'var(--color-green)' }} />
            </div>
            <p className="font-bold text-[15px] mb-1" style={{ color: 'var(--color-ink)' }}>Invite sent!</p>
            <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
              {fullName} will receive an email to set up their password.
            </p>
            <button
              onClick={onClose}
              className="mt-5 px-5 py-2 rounded-[10px] text-sm font-semibold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Full Name *
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="e.g. Ahmed Al-Rashid"
                required
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--color-muted)' }}>
                Email Address *
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="staff@example.com"
                required
                className="w-full rounded-[10px] px-3 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-saffron"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-ink)' }}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-2" style={{ color: 'var(--color-muted)' }}>
                Role *
              </label>
              <div className="space-y-2">
                {ASSIGNABLE.map(r => {
                  const cfg = ROLE_CONFIG[r]
                  const on  = role === r
                  return (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setRole(r)}
                      className="w-full flex items-start gap-3 px-3 py-2.5 rounded-[10px] text-left"
                      style={{
                        background: on ? cfg.bg : 'var(--color-cream)',
                        border: `1.5px solid ${on ? cfg.color : 'var(--color-border)'}`,
                      }}
                    >
                      <span
                        className="text-[11px] font-bold px-2 py-0.5 rounded-[6px] mt-0.5 flex-shrink-0"
                        style={{ background: cfg.bg, color: cfg.color }}
                      >
                        {cfg.label}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--color-muted)' }}>
                        {cfg.desc}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>

            {error && (
              <p className="text-sm font-semibold" style={{ color: 'var(--color-red)' }}>{error}</p>
            )}

            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 py-2.5 rounded-[10px] text-sm font-semibold"
                style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !email || !fullName}
                className="flex-1 py-2.5 rounded-[10px] text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-1.5"
                style={{ background: 'var(--color-saffron)', color: '#fff' }}
              >
                <Mail size={14} />
                {loading ? 'Sending…' : 'Send Invite'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}

// ── Staff row ─────────────────────────────────────────────────────────────────

function StaffRow({ user, isCurrentUser }: { user: User; isCurrentUser: boolean }) {
  const [roleError, setRoleError]     = useState<string | null>(null)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [permError, setPermError]     = useState<string | null>(null)
  const [busy, setBusy]               = useState(false)

  // Fallback so undefined role/status never crashes the render
  const roleCfg   = ROLE_CONFIG[user.role]   ?? ROLE_CONFIG.viewer
  const statusCfg = STATUS_CONFIG[user.status] ?? STATUS_CONFIG.inactive
  const isOwner   = user.role === 'owner'

  async function changeRole(newRole: UserRole) {
    if (busy) return
    setBusy(true)
    setRoleError(null)
    try {
      const result = await updateStaffRole(user.id, newRole)
      if (result?.error) { setRoleError(result.error); setBusy(false); return }
    } catch { /* ignore */ }
    window.location.reload()
  }

  async function toggleStatus() {
    if (busy) return
    setBusy(true)
    setStatusError(null)
    const next: UserStatus = user.status === 'active' ? 'inactive' : 'active'
    try {
      const result = await updateStaffStatus(user.id, next)
      if (result?.error) { setStatusError(result.error); setBusy(false); return }
    } catch { /* ignore */ }
    window.location.reload()
  }

  async function changePerm(field: 'can_record_payment' | 'can_see_financials' | 'can_export_reports', val: boolean | null) {
    if (busy) return
    setBusy(true)
    setPermError(null)
    try {
      const result = await updateStaffPermissions(user.id, {
        can_record_payment: field === 'can_record_payment' ? val : user.can_record_payment,
        can_see_financials: field === 'can_see_financials' ? val : user.can_see_financials,
        can_export_reports: field === 'can_export_reports' ? val : user.can_export_reports,
      })
      if (result?.error) { setPermError(result.error); setBusy(false); return }
    } catch { /* ignore */ }
    window.location.reload()
  }

  return (
    <div
      className="px-5 py-4"
      style={{ opacity: user.status === 'inactive' ? 0.6 : 1 }}
    >
      {/* Top row: name + email + status toggle */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-semibold text-sm" style={{ color: 'var(--color-ink)' }}>
              {user.full_name}
            </p>
            {isCurrentUser && (
              <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-[5px]" style={{ background: 'var(--color-saffron-soft)', color: 'var(--color-ember)' }}>
                You
              </span>
            )}
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded-[6px]"
              style={{ background: statusCfg.bg, color: statusCfg.color }}
            >
              {statusCfg.label}
            </span>
          </div>
          <p className="text-xs mt-0.5" style={{ color: 'var(--color-muted)' }}>{user.email}</p>
        </div>

        {/* Status toggle (not for owner or self) */}
        {!isOwner && !isCurrentUser && (
          <button
            onClick={toggleStatus}
            disabled={busy}
            className="flex-shrink-0 text-xs font-semibold px-2.5 py-1 rounded-[7px] disabled:opacity-50"
            style={{
              background: user.status === 'active' ? 'var(--color-red-soft)' : 'var(--color-green-soft)',
              color:      user.status === 'active' ? 'var(--color-red)'      : 'var(--color-green)',
              border:     `1px solid ${user.status === 'active' ? '#FECACA' : '#A7DFB8'}`,
            }}
          >
            {busy ? '…' : user.status === 'active' ? 'Deactivate' : 'Activate'}
          </button>
        )}
      </div>

      {/* Role selector */}
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>
          Role
        </p>
        {isOwner || isCurrentUser ? (
          <span
            className="inline-flex items-center gap-1 text-[11px] font-bold px-2 py-0.5 rounded-[6px]"
            style={{ background: roleCfg.bg, color: roleCfg.color }}
          >
            <Shield size={11} />
            {roleCfg.label}
          </span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {ASSIGNABLE.map(r => {
              const cfg = ROLE_CONFIG[r]
              const on  = user.role === r
              return (
                <button
                  key={r}
                  onClick={() => changeRole(r)}
                  disabled={busy}
                  className="text-[11px] font-bold px-2.5 py-1 rounded-[7px] disabled:opacity-50"
                  style={{
                    background: on ? cfg.bg : 'var(--color-cream)',
                    color:      on ? cfg.color : 'var(--color-muted)',
                    border:     `1.5px solid ${on ? cfg.color : 'var(--color-border)'}`,
                  }}
                >
                  {cfg.label}
                </button>
              )
            })}
          </div>
        )}
        {roleError && <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>{roleError}</p>}
      </div>

      {/* Permission overrides */}
      {!isOwner && (
        <div>
          <p className="text-[10px] font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Permission Overrides{' '}
            <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
              (Auto = role default)
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Record Payments</span>
              <PermToggle
                label="Record Payments"
                value={user.can_record_payment}
                onChange={v => changePerm('can_record_payment', v)}
                disabled={isCurrentUser || busy}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>See Financials</span>
              <PermToggle
                label="See Financials"
                value={user.can_see_financials}
                onChange={v => changePerm('can_see_financials', v)}
                disabled={isCurrentUser || busy}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[11px]" style={{ color: 'var(--color-muted)' }}>Export Reports</span>
              <PermToggle
                label="Export Reports"
                value={user.can_export_reports}
                onChange={v => changePerm('can_export_reports', v)}
                disabled={isCurrentUser || busy}
              />
            </div>
          </div>
          {permError && <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>{permError}</p>}
        </div>
      )}
      {statusError && <p className="text-xs font-semibold mt-1" style={{ color: 'var(--color-red)' }}>{statusError}</p>}
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export function StaffModule({ users }: { users: User[] }) {
  const [showInvite, setShowInvite]   = useState(false)
  const [showGuide, setShowGuide]     = useState(false)

  // The current user is the owner (page requires owner role)
  const ownerUser   = users.find(u => u.role === 'owner')
  const currentUser = ownerUser // on this page, the viewer is always the owner

  const activeCount   = users.filter(u => u.status === 'active').length
  const pendingCount  = users.filter(u => u.status === 'pending').length

  return (
    <div>
      {/* Page header */}
      <div className="flex items-start justify-between gap-3 mb-5">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest" style={{ color: 'var(--color-saffron)', letterSpacing: '.12em' }}>
            Admin
          </p>
          <h1 className="font-display font-bold text-[25px] mt-0.5" style={{ color: 'var(--color-ink)' }}>
            Staff & Access
          </h1>
        </div>
        <button
          onClick={() => setShowInvite(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-[10px] text-sm font-semibold flex-shrink-0 mt-1"
          style={{ background: 'var(--color-saffron)', color: '#fff' }}
        >
          <Plus size={15} />
          Invite Staff
        </button>
      </div>

      {/* Summary strip */}
      <div
        className="flex flex-wrap items-center gap-4 px-4 py-3 rounded-[12px] mb-5"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
      >
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Total Users</p>
          <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-ink)' }}>{users.length}</p>
        </div>
        <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Active</p>
          <p className="font-display font-bold text-[20px]" style={{ color: 'var(--color-green)' }}>{activeCount}</p>
        </div>
        {pendingCount > 0 && (
          <>
            <div className="w-px self-stretch" style={{ background: 'var(--color-border)' }} />
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Pending</p>
              <p className="font-display font-bold text-[20px]" style={{ color: '#92400E' }}>{pendingCount}</p>
            </div>
          </>
        )}
        <button
          onClick={() => setShowGuide(v => !v)}
          className="ml-auto text-xs font-semibold px-3 py-1.5 rounded-[8px]"
          style={{ background: 'var(--color-blue-soft)', color: 'var(--color-blue)', border: '1px solid var(--color-blue-soft)' }}
        >
          {showGuide ? 'Hide Role Guide' : 'Role Guide'}
        </button>
      </div>

      {/* Role guide (collapsible) */}
      {showGuide && (
        <div
          className="rounded-[14px] p-4 mb-5 overflow-x-auto"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)' }}
        >
          <p className="font-display font-bold text-[13px] mb-3" style={{ color: 'var(--color-ink)' }}>
            Module Access by Role
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 520 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-muted)', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                  Module
                </th>
                {(['owner', 'manager', 'accounts', 'data_entry', 'packer', 'viewer'] as UserRole[]).map(r => (
                  <th key={r} style={{ textAlign: 'center', padding: '4px 8px', color: ROLE_CONFIG[r].color, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                    {ROLE_CONFIG[r].label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MODULE_ACCESS.map((row, i) => (
                <tr key={row.module} style={{ background: i % 2 === 0 ? 'var(--color-cream)' : 'transparent' }}>
                  <td style={{ padding: '5px 8px', fontWeight: 600, color: 'var(--color-ink)' }}>{row.module}</td>
                  {(['owner', 'manager', 'accounts', 'data_entry', 'packer', 'viewer'] as const).map(r => (
                    <td key={r} style={{ textAlign: 'center', padding: '5px 8px' }}>
                      {row[r]
                        ? <span style={{ color: 'var(--color-green)', fontWeight: 700 }}>✓</span>
                        : <span style={{ color: 'var(--color-border)', fontWeight: 700 }}>—</span>
                      }
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] mt-3" style={{ color: 'var(--color-muted)' }}>
            Permission overrides (below each staff member) can grant or restrict individual access beyond their role.
          </p>
        </div>
      )}

      {/* Pending users notice */}
      {pendingCount > 0 && (
        <div
          className="rounded-[12px] px-4 py-3 mb-4 text-sm"
          style={{ background: '#FEF3C7', border: '1px solid #FCD34D', color: '#92400E' }}
        >
          <span className="font-bold">{pendingCount} pending account{pendingCount > 1 ? 's' : ''}:</span>{' '}
          These users signed up themselves and are waiting for approval. Activate them below to grant access.
        </div>
      )}

      {/* Staff list */}
      <div
        className="rounded-[14px] overflow-hidden"
        style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
      >
        {users.length === 0 ? (
          <div className="py-16 text-center">
            <p className="font-semibold text-sm mb-3" style={{ color: 'var(--color-muted)' }}>
              No staff members yet. Invite your first team member.
            </p>
            <button
              onClick={() => setShowInvite(true)}
              className="px-4 py-2 rounded-[8px] text-sm font-semibold"
              style={{ background: 'var(--color-saffron)', color: '#fff' }}
            >
              + Invite Staff
            </button>
          </div>
        ) : (
          users.map((u, i) => (
            <div key={u.id} style={{ borderTop: i > 0 ? '1px solid var(--color-border)' : undefined }}>
              <StaffRow
                user={u}
                isCurrentUser={u.id === ownerUser?.id && u.role === 'owner'}
              />
            </div>
          ))
        )}
      </div>

      {/* Invite modal */}
      {showInvite && <InviteModal onClose={() => setShowInvite(false)} />}
    </div>
  )
}
