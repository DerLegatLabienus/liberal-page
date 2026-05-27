import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import type { Bill, Committee } from '@/types'

const STATUS_COLORS: Record<string, string> = {
  'בוועדה': 'border-green-500 bg-green-50',
  'הצבעה קרובה': 'border-orange-500 bg-orange-50',
  'עבר': 'border-slate-400 bg-slate-50',
  'נדחה': 'border-red-400 bg-red-50',
}

const STATUS_DOT: Record<string, string> = {
  'בוועדה': 'text-green-600',
  'הצבעה קרובה': 'text-orange-500',
  'עבר': 'text-slate-500',
  'נדחה': 'text-red-500',
}

interface ParliamentStripProps {
  bills: Bill[]
  committees: Committee[]
  onOpenDrawer: () => void
}

export default function ParliamentStrip({ bills, committees, onOpenDrawer }: ParliamentStripProps) {
  const { t } = useTranslation()
  const direction = useDirection()
  const activeBills = bills.filter((b) => b.status !== 'עבר' && b.status !== 'נדחה')

  return (
    <section className="border-y border-border bg-blue-50/60 py-8" dir={direction}>
      <div className="container mx-auto max-w-4xl px-4">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-right text-sm font-semibold uppercase tracking-wide text-blue-700">
            {t('ui.strip_heading')}
          </h2>
          <button onClick={onOpenDrawer} className="text-xs font-medium text-primary hover:underline">
            {t('ui.strip_see_all')}
          </button>
        </div>
        <div className="flex flex-wrap gap-3">
          {activeBills.map((bill) => (
            <div
              key={bill.id}
              dir={direction}
              className={`min-w-[180px] shrink-0 rounded-lg border border-s-4 bg-white px-4 py-3 text-right shadow-sm ${STATUS_COLORS[bill.status] ?? 'border-slate-300 bg-slate-50'}`}
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t('ui.strip_active_bill')}</p>
              <p className="mb-2 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{bill.title}</p>
              <p className={`text-xs font-medium ${STATUS_DOT[bill.status] ?? ''}`}>● {bill.status}</p>
            </div>
          ))}
          {committees.map((c) => (
            <div
              key={c.id}
              dir={direction}
              className="min-w-[180px] shrink-0 rounded-lg border border-s-4 border-blue-500 bg-white px-4 py-3 text-right shadow-sm"
            >
              <p className="mb-1 text-xs font-medium text-muted-foreground">{t('ui.strip_tracked_committee')}</p>
              <p className="mb-2 line-clamp-2 text-sm font-semibold leading-snug text-foreground">{c.name}</p>
              {c.lastSessionDate && (
                <p className="text-xs text-green-600">
                  ● ישיבה: {new Date(c.lastSessionDate).toLocaleDateString('he-IL')}
                </p>
              )}
            </div>
          ))}
          <button
            onClick={onOpenDrawer}
            className="flex min-w-[120px] shrink-0 items-center justify-center rounded-lg border border-dashed border-primary/40 bg-white px-4 py-3 text-sm font-medium text-primary shadow-sm hover:bg-primary/5"
          >
            {t('ui.strip_more')}
          </button>
        </div>
      </div>
    </section>
  )
}
