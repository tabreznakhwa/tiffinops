'use client'

import { useEffect } from 'react'
import { Printer, X } from 'lucide-react'

const PRINT_CSS = `
  @media print {
    .no-print { display: none !important; }
    @page { margin: 12mm 15mm; size: A4 portrait; }
    body { background: white !important; }
    .bill-line { break-inside: avoid; }
  }
`

export function BillPrintSetup() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 700)
    return () => clearTimeout(t)
  }, [])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_CSS }} />
      <div
        className="no-print"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 20,
          padding: '10px 14px',
          borderRadius: 12,
          background: '#FBF6EE',
          border: '1px solid #ECE2D3',
        }}
      >
        <button
          onClick={() => window.print()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '7px 16px', borderRadius: 8,
            background: '#E76F2A', color: 'white',
            fontWeight: 700, fontSize: 13, border: 'none', cursor: 'pointer',
          }}
        >
          <Printer size={14} />
          Print / Save PDF
        </button>
        <button
          onClick={() => window.close()}
          style={{
            display: 'flex', alignItems: 'center', gap: 5,
            padding: '7px 14px', borderRadius: 8,
            background: 'transparent', color: '#7C7063',
            fontWeight: 600, fontSize: 13,
            border: '1px solid #ECE2D3', cursor: 'pointer',
          }}
        >
          <X size={13} />
          Close
        </button>
        <p style={{ marginLeft: 'auto', fontSize: 12, color: '#7C7063' }}>
          Print dialog opens automatically
        </p>
      </div>
    </>
  )
}
