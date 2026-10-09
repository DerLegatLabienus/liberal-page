import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import type { Bill } from '@/types'

// 'בוועדה' (green) and 'הצבעה קרובה' (orange) have no matching design-system token
// (there is no success/warning token in src/index.css). They stay as palette classes
// pending a design decision (LibPage-025) and are pinned in BillCard.test.tsx.
const STATUS_BADGE: Record<string, string> = {
  'בוועדה': 'bg-green-100 text-green-700',
  'הצבעה קרובה': 'bg-orange-100 text-orange-700',
  'עבר': 'bg-muted text-muted-foreground',
  'נדחה': 'bg-destructive/10 text-destructive',
}

const STATUS_BAR: Record<string, string> = {
  'בוועדה': 'bg-green-500',
  'הצבעה קרובה': 'bg-orange-500',
  'עבר': 'bg-muted-foreground/60',
  'נדחה': 'bg-destructive/80',
}

interface BillCardProps {
  bill: Bill
  onRemove?: (id: number) => void
}

export default function BillCard({ bill, onRemove }: BillCardProps) {
  const { t } = useTranslation()
  const direction = useDirection()

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-card ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className={`w-1 shrink-0 ${STATUS_BAR[bill.status] ?? 'bg-border'}`} />
      <div className="flex-1 p-4" dir="rtl">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-right text-sm font-semibold leading-snug text-foreground">{bill.title}</p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[bill.status] ?? 'bg-secondary text-secondary-foreground'}`}>
            {bill.status}
          </span>
        </div>
        <p className="mb-2 text-right text-xs text-muted-foreground">
          {bill.number} · {bill.committee}
        </p>
        {bill.notes && (
          <div className="mb-2 rounded-md bg-primary/10 p-2">
            <p className="mb-1 text-right text-xs font-semibold text-primary">✦ סיכום</p>
            <p className="text-right leading-relaxed text-xs text-muted-foreground">{bill.notes}</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          {bill.lastPolledAt && (
            <p className="text-xs text-muted-foreground">
              עודכן: {new Date(bill.lastPolledAt).toLocaleDateString('he-IL')}
            </p>
          )}
          <div className="flex gap-2 ms-auto">
            {bill.sourceUrl && (
              <a href={bill.sourceUrl} target="_blank" rel="noopener noreferrer"
                className="text-xs text-primary hover:underline">
                {t('tracker.view_source')}
              </a>
            )}

            {onRemove && (
              <button onClick={() => onRemove(bill.id)}
                className="text-xs text-destructive/70 hover:text-destructive">
                הסר
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
