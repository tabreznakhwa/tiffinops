import Image from 'next/image'
import type { AppUser } from '@/lib/auth'
import { formatInTimeZone } from 'date-fns-tz'

interface TopbarProps {
  user: AppUser
}

export function Topbar({ user }: TopbarProps) {
  const todayLabel = formatInTimeZone(new Date(), 'Asia/Dubai', 'EEE, d MMM yyyy')
  const initials = user.full_name
    .split(' ')
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  const roleLabel: Record<AppUser['role'], string> = {
    owner: 'Owner',
    manager: 'Manager',
    data_entry: 'Data Entry',
    accounts: 'Accounts',
    packer: 'Packer',
    viewer: 'Viewer',
  }

  return (
    <header className="sticky top-0 z-40 flex items-center gap-3 px-4 py-3 bg-ink">
      {/* Logo */}
      <div style={{ position: 'relative', width: 110, height: 36, flexShrink: 0 }}>
        <Image
          src="/Apna%20Chulha%20Logo%20White.png"
          alt="Apna Chulha"
          fill
          sizes="110px"
          style={{ objectFit: 'contain', objectPosition: 'left center' }}
          priority
        />
      </div>

      {/* App name */}
      <div className="flex flex-col leading-tight">
        <span className="font-display font-extrabold text-[17px] text-white">TiffinOps</span>
        <span className="text-[10.5px] hidden sm:block" style={{ color: '#C9BEB1', letterSpacing: '.03em' }}>
          Internal Ops Platform
        </span>
      </div>

      <div className="flex-1" />

      {/* Today pill */}
      <div
        className="items-center gap-[7px] text-[12px] hidden sm:flex"
        style={{ color: '#D8CEC1' }}
      >
        <span
          className="w-[7px] h-[7px] rounded-full inline-block"
          style={{ background: 'var(--color-green)', boxShadow: '0 0 0 3px rgba(46,125,79,.3)' }}
        />
        {todayLabel}
      </div>

      {/* User chip */}
      <div className="flex items-center gap-2">
        <div className="w-[30px] h-[30px] rounded-full flex items-center justify-center font-bold text-[12px] text-white flex-shrink-0 bg-ember">
          {initials}
        </div>
        <div className="hidden sm:flex flex-col leading-tight">
          <span className="text-[13px] font-semibold text-white">{user.full_name.split(' ')[0]}</span>
          <span className="text-[11px]" style={{ color: '#C9BEB1' }}>{roleLabel[user.role]}</span>
        </div>
      </div>
    </header>
  )
}
