import { useDirection } from '@/hooks/useDirection'
import type { Bill } from '@/types'

const STATUS_BADGE: Record<Bill['status'], string> = {
  'בוועדה': 'bg-green-100 text-green-700',
  'הצבעה קרובה': 'bg-orange-100 text-orange-700',
  'עבר': 'bg-slate-100 text-slate-600',
  'נדחה': 'bg-red-100 text-red-600',
}

const STATUS_BAR: Record<Bill['status'], string> = {
  'בוועדה': 'bg-green-500',
  'הצבעה קרובה': 'bg-orange-500',
  'עבר': 'bg-slate-400',
  'נדחה': 'bg-red-400',
}

interface BillCardProps {
  bill: Bill
  onRemove?: (id: number) => void
}

export default function BillCard({ bill, onRemove }: BillCardProps) {
  const direction = useDirection()

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className={`w-1 shrink-0 ${STATUS_BAR[bill.status]}`} />
      <div className="flex-1 p-4">
        <div className="mb-2 flex items-start justify-between gap-2">
          <p className="text-sm font-semibold leading-snug text-foreground">{bill.title}</p>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE[bill.status]}`}>
            {bill.status}
          </span>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          {bill.number} · {bill.committee}
        </p>
        {bill.notes && (
          <div className="mb-2 rounded-md bg-blue-50 p-2">
            <p className="mb-1 text-xs font-semibold text-blue-700">✦ סיכום</p>
            <p className="leading-relaxed text-xs text-muted-foreground">{bill.notes}</p>
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
                צפה במקור ↗
              </a>
            )}
            {onRemove && (
              <button onClick={() => onRemove(bill.id)}
                className="text-xs text-red-400 hover:text-red-600">
                הסר
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
