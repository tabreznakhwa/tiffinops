'use client'

// AI Cost Advisor card shown at the top of /inventory/insights.
// Renders the latest saved report and lets owner/manager generate a fresh
// one on demand (each run costs an API call, so no auto-refresh).

import { useState, useTransition } from 'react'
import { Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { generateInventoryInsights } from '@/lib/inventory/ai-insights'
import type { InsightReportRow } from '@/lib/inventory/ai-insights'
import { useAppSettings } from '@/components/settings/settings-context'

const CATEGORY_LABELS: Record<string, string> = {
  price_rise: 'Price Rise',
  supplier_switch: 'Cheaper Supplier',
  wastage: 'Wastage',
  overstock: 'Overstock',
  consumption: 'Consumption',
  low_stock: 'Low Stock',
  other: 'Tip',
}

const SEVERITY_STYLES: Record<string, { border: string; chipBg: string; chipColor: string; label: string }> = {
  high:   { border: 'var(--color-red)',    chipBg: 'var(--color-red-soft)',   chipColor: 'var(--color-red)',   label: 'Act now' },
  medium: { border: 'var(--color-gold)',   chipBg: '#FEF3C7',                 chipColor: 'var(--color-gold)',  label: 'This month' },
  info:   { border: 'var(--color-border)', chipBg: 'var(--color-cream)',      chipColor: 'var(--color-muted)', label: 'Good to know' },
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function AIAdvisor({
  initialReport,
  canGenerate,
}: {
  initialReport: InsightReportRow | null
  canGenerate: boolean
}) {
  const { currency } = useAppSettings()
  const [report, setReport] = useState<InsightReportRow | null>(initialReport)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function generate() {
    setError(null)
    startTransition(async () => {
      const res = await generateInventoryInsights()
      if (res.error) setError(res.error)
      else if (res.report) setReport(res.report)
    })
  }

  const totalSavings = report
    ? report.report.insights.reduce((s, i) => s + (i.potential_monthly_saving_aed ?? 0), 0)
    : 0

  return (
    <div
      className="rounded-[14px] p-4 sm:p-5 mb-5"
      style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-card)' }}
    >
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          <div
            className="h-9 w-9 rounded-[10px] flex items-center justify-center flex-shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--color-saffron), var(--color-ember))' }}
          >
            <Sparkles size={17} color="#fff" />
          </div>
          <div>
            <p className="font-display font-bold text-[17px] leading-tight" style={{ color: 'var(--color-ink)' }}>AI Cost Advisor</p>
            <p className="text-[11px]" style={{ color: 'var(--color-muted)' }}>
              {report
                ? `Last analysis ${fmtDateTime(report.created_at)} · last 90 days`
                : 'Finds price rises, cheaper suppliers, wastage and idle stock'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {report && totalSavings > 0 && (
            <div className="text-right">
              <p className="text-[10px] font-bold uppercase tracking-wide" style={{ color: 'var(--color-muted)' }}>Potential savings</p>
              <p className="font-display font-extrabold text-[18px] num leading-tight" style={{ color: 'var(--color-green)' }}>
                ≈ {currency} {totalSavings.toFixed(0)}/mo
              </p>
            </div>
          )}
          {canGenerate && (
            <button
              onClick={generate}
              disabled={isPending}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-[10px] text-sm font-bold transition-opacity disabled:opacity-60"
              style={{ background: 'var(--color-ink)', color: 'var(--color-cream)' }}
            >
              {isPending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
              {isPending ? 'Analysing…' : report ? 'Refresh Analysis' : 'Generate Analysis'}
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm font-semibold mb-3" style={{ color: 'var(--color-red)' }}>{error}</p>}

      {!report ? (
        <p className="text-sm py-2" style={{ color: 'var(--color-muted)' }}>
          {canGenerate
            ? 'No analysis yet. Click Generate Analysis to have AI review the last 90 days of purchases, consumption and wastage for cost-saving opportunities.'
            : 'No analysis yet. The owner or manager can generate one.'}
        </p>
      ) : (
        <>
          <p className="text-sm mb-4" style={{ color: 'var(--color-ink)' }}>{report.report.summary}</p>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
            {report.report.insights.map((ins, i) => {
              const sev = SEVERITY_STYLES[ins.severity] ?? SEVERITY_STYLES.info
              return (
                <div
                  key={i}
                  className="rounded-[12px] p-3.5 relative overflow-hidden"
                  style={{ background: 'var(--color-cream)', border: '1px solid var(--color-border)' }}
                >
                  <div className="absolute left-0 top-0 bottom-0 w-1" style={{ background: sev.border }} />
                  <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-pill text-[10px] font-bold"
                      style={{ background: sev.chipBg, color: sev.chipColor }}
                    >
                      {sev.label}
                    </span>
                    <span
                      className="inline-flex items-center px-2 py-0.5 rounded-pill text-[10px] font-bold"
                      style={{ background: 'var(--color-surface)', color: 'var(--color-muted)', border: '1px solid var(--color-border)' }}
                    >
                      {CATEGORY_LABELS[ins.category] ?? ins.category}
                    </span>
                    {ins.potential_monthly_saving_aed != null && ins.potential_monthly_saving_aed > 0 && (
                      <span
                        className="inline-flex items-center px-2 py-0.5 rounded-pill text-[10px] font-bold num"
                        style={{ background: 'var(--color-green-soft)', color: 'var(--color-green)' }}
                      >
                        save ≈ {currency} {ins.potential_monthly_saving_aed.toFixed(0)}/mo
                      </span>
                    )}
                  </div>
                  <p className="font-bold text-sm" style={{ color: 'var(--color-ink)' }}>{ins.title}</p>
                  <p className="text-[13px] mt-0.5 leading-snug" style={{ color: 'var(--color-muted)' }}>{ins.detail}</p>
                  {ins.item_names.length > 0 && (
                    <p className="text-[11px] font-semibold mt-1.5" style={{ color: 'var(--color-saffron)' }}>
                      {ins.item_names.join(' · ')}
                    </p>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
