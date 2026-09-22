import { Loader2 } from 'lucide-react'

// Shown instantly while a page under the (app) layout is navigated to and its
// server-side data is still loading. Without this, every tab click (Orders,
// Outstanding, etc.) had no visual feedback at all until the destination
// page's full data fetch resolved, since every page opts into
// `force-dynamic`. This gives Next.js a Suspense boundary to stream into.
export default function AppLoading() {
  return (
    <div className="flex items-center justify-center py-24">
      <Loader2 size={28} className="animate-spin" style={{ color: 'var(--color-saffron)' }} />
    </div>
  )
}
