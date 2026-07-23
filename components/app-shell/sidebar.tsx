'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface NavItem {
  href: string
  label: string
  ownerOnly?: boolean
  notForRoles?: string[]
  icon: React.ReactNode
}

interface NavSection {
  label: string
  ownerOnly?: boolean
  items: NavItem[]
}

const NAV_SECTIONS: NavSection[] = [
  {
    label: 'Operations',
    items: [
      {
        href: '/orders',
        label: 'Orders',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
            <rect x="9" y="3" width="6" height="4" rx="1"/>
            <path d="M9 12h6M9 16h4"/>
          </svg>
        ),
      },
      {
        href: '/customers',
        label: 'Customers',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="9" cy="8" r="3.2"/>
            <path d="M3.5 20c0-3.2 2.8-5.2 5.5-5.2s5.5 2 5.5 5.2M17 9.5a2.6 2.6 0 1 0-2-4.5M16 14.6c2.4.3 4.5 1.8 4.5 4.4"/>
          </svg>
        ),
      },
      {
        href: '/menu',
        label: 'Menu',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M5 3v18M5 8h4M9 3v18M16 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4 2.5-1 2.5-4-1-5-2.5-5ZM16 16v5"/>
          </svg>
        ),
      },
      {
        href: '/fixed-menu',
        label: 'Fixed Menu',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="4" width="18" height="18" rx="2"/>
            <path d="M3 9h18M9 9v13M16 13h2M16 17h2"/>
          </svg>
        ),
      },
      {
        href: '/packing',
        label: 'Packing',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 8l9-5 9 5v8l-9 5-9-5V8Z"/>
            <path d="M3 8l9 5 9-5M12 13v8"/>
          </svg>
        ),
      },
      {
        href: '/deliveries',
        label: 'Deliveries',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="6" cy="18" r="2"/>
            <circle cx="17" cy="18" r="2"/>
            <path d="M2 5h11v13M13 9h5l3 4v5h-2"/>
          </svg>
        ),
      },
      {
        href: '/bills',
        label: 'A La Carte Bill',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 2h9l5 5v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1Z"/>
            <path d="M14 2v6h6M9 13h6M9 17h4"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Finance',
    items: [
      {
        href: '/payments',
        label: 'Payments',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="6" width="18" height="12" rx="2"/>
            <path d="M3 10h18M7 15h4"/>
          </svg>
        ),
      },
      {
        href: '/invoices',
        label: 'Invoices',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 4h16v16H4V4Z" rx="1"/>
            <path d="M4 8h16"/>
            <path d="M8 4v4"/>
            <path d="M8 13h8M8 17h5"/>
          </svg>
        ),
      },
      {
        href: '/cash-book',
        label: 'Cash Book',
        notForRoles: ['data_entry'],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="2" y="6" width="20" height="13" rx="2"/>
            <path d="M2 10h20"/>
            <circle cx="12" cy="15" r="2"/>
            <path d="M6 10V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v3"/>
          </svg>
        ),
      },
      {
        href: '/bank-book',
        label: 'Bank Book',
        notForRoles: ['data_entry'],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 9l9-6 9 6H3Z"/>
            <path d="M3 9v11h18V9"/>
            <path d="M9 9v11M15 9v11M3 15h18"/>
          </svg>
        ),
      },
      {
        href: '/outstanding',
        label: 'Outstanding',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="9"/>
            <path d="M12 8v4M12 16h.01"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Analytics',
    items: [
      {
        href: '/',
        label: 'Dashboard',
        notForRoles: ['data_entry'],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <rect x="3" y="3" width="7" height="9" rx="1.5"/>
            <rect x="14" y="3" width="7" height="5" rx="1.5"/>
            <rect x="14" y="12" width="7" height="9" rx="1.5"/>
            <rect x="3" y="16" width="7" height="5" rx="1.5"/>
          </svg>
        ),
      },
      {
        href: '/reports',
        label: 'Reports',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M4 19V5M4 19h16M8 16v-5M12 16V8M16 16v-8"/>
          </svg>
        ),
      },
    ],
  },
  {
    label: 'Admin',
    ownerOnly: true,
    items: [
      {
        href: '/approvals',
        label: 'Approvals',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M9 12l2 2 4-4"/>
            <circle cx="12" cy="12" r="9"/>
          </svg>
        ),
      },
      {
        href: '/staff',
        label: 'Staff',
        ownerOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 2a5 5 0 1 0 0 10A5 5 0 0 0 12 2Z"/>
            <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            <path d="M18 8l2 2 4-4"/>
          </svg>
        ),
      },
      {
        href: '/audit-trail',
        label: 'Audit Trail',
        ownerOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M12 8v4l3 3"/>
            <circle cx="12" cy="12" r="9"/>
            <path d="M3.6 9h.01M20.4 9h.01M3.6 15h.01M20.4 15h.01"/>
          </svg>
        ),
      },
      {
        href: '/settings',
        label: 'Settings',
        ownerOnly: true,
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>
          </svg>
        ),
      },
    ],
  },
]

interface SidebarProps {
  pendingApprovals?: number
  isOwner?: boolean
  userRole?: string
}

export function Sidebar({ pendingApprovals = 0, isOwner = false, userRole }: SidebarProps) {
  const pathname = usePathname()

  function isActive(href: string) {
    if (href === '/') return pathname === '/'
    return pathname === href || pathname.startsWith(href + '/')
  }

  const isPacker = userRole === 'packer'

  return (
    <aside className="hidden md:flex flex-col w-[216px] flex-shrink-0 sticky top-[64px] h-[calc(100vh-64px)] overflow-y-auto border-r border-border bg-cream z-20">
      <nav className="flex flex-col py-3 px-2.5 flex-1">
        {isPacker ? (
          <Link
            href="/packing"
            className={cn(
              'flex items-center gap-2.5 px-3 py-[9px] rounded-lg font-semibold text-[13.5px] transition-colors',
              isActive('/packing') ? 'bg-ink text-white' : 'text-muted hover:bg-ink/[.07] hover:text-ink'
            )}
          >
            <span className="w-[17px] h-[17px] flex-shrink-0">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M3 8l9-5 9 5v8l-9 5-9-5V8Z"/>
                <path d="M3 8l9 5 9-5M12 13v8"/>
              </svg>
            </span>
            Packing
          </Link>
        ) : (
          NAV_SECTIONS.map(section => {
            if (section.ownerOnly && !isOwner) return null
            const visibleItems = section.items.filter(item =>
              (!item.ownerOnly || isOwner) &&
              (!item.notForRoles || !item.notForRoles.includes(userRole ?? ''))
            )
            if (visibleItems.length === 0) return null
            return (
              <div key={section.label} className="mb-2">
                <p
                  className="px-3 pt-2 pb-1 text-[10px] font-bold uppercase tracking-widest select-none"
                  style={{ color: 'var(--color-muted)', opacity: 0.55, letterSpacing: '.1em' }}
                >
                  {section.label}
                </p>
                {visibleItems.map(item => {
                  const active = isActive(item.href)
                  const badge = item.href === '/approvals' && pendingApprovals > 0 ? pendingApprovals : 0
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        'flex items-center gap-2.5 px-3 py-[9px] rounded-lg font-semibold text-[13.5px] transition-colors mb-0.5',
                        active
                          ? 'bg-ink text-white'
                          : 'text-muted hover:bg-ink/[.07] hover:text-ink'
                      )}
                    >
                      <span className="w-[17px] h-[17px] flex-shrink-0">{item.icon}</span>
                      <span className="flex-1 leading-none">{item.label}</span>
                      {badge > 0 && (
                        <span className="text-[10px] font-bold rounded-full min-w-[18px] text-center leading-[18px] h-[18px] bg-red text-white px-1">
                          {badge}
                        </span>
                      )}
                    </Link>
                  )
                })}
              </div>
            )
          })
        )}
      </nav>
    </aside>
  )
}
