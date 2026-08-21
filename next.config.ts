import type { NextConfig } from 'next'
import path from 'path'

const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(__dirname),
  },
  experimental: {
    serverActions: {
      // Default 1 MB rejects phone photos of bills sent to scanReceipt()
      bodySizeLimit: '8mb',
    },
  },
  async headers() {
    return [
      {
        // Dashboard — never cache at edge so invoice/payment data is always live
        source: '/',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ]
  },
}

export default nextConfig
