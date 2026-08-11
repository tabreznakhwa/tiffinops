export const dynamic = 'force-dynamic'

import { requireAuth } from '@/lib/auth'
import { PasteOrdersModule } from '@/components/orders/paste-orders-module'

const WRITE_ROLES = ['owner', 'manager', 'data_entry']

export default async function PasteOrdersPage() {
  const user = await requireAuth()

  if (!WRITE_ROLES.includes(user.role)) {
    return (
      <div className="flex items-center justify-center h-48">
        <p className="text-sm font-semibold" style={{ color: 'var(--color-muted)' }}>
          You don&apos;t have permission to import orders.
        </p>
      </div>
    )
  }

  return <PasteOrdersModule />
}
