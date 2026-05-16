import { useMemo, useState } from 'react'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type MembershipStatus = 'new' | 'renewal' | 'existing'
type JoinMode = 'individual' | 'couple'

const EFFECTIVE_SOFT_URLS: Record<MembershipStatus, Record<JoinMode, string>> = {
  new: {
    individual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal',
    couple: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal2',
  },
  renewal: {
    individual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal',
    couple: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal2',
  },
  existing: {
    individual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal3',
    couple: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal4',
  },
}

const STATUS_OPTIONS: Array<{
  value: MembershipStatus
  title: string
  description: string
}> = [
  {
    value: 'new',
    title: 'מעולם לא הייתי חבר/ת ליכוד',
    description: 'להתפקדות חדשה לליכוד והצטרפות לתא הליברלי.',
  },
  {
    value: 'renewal',
    title: 'הייתי בעבר / חידוש / קוד 99',
    description: 'לחידוש חברות או השלמת התפקדות מחדש.',
  },
  {
    value: 'existing',
    title: 'אני כבר חבר/ת ליכוד',
    description: 'להצטרפות לקבוצת הליברלים ללא פרטי אשראי.',
  },
]

const MODE_OPTIONS: Array<{ value: JoinMode; label: string }> = [
  { value: 'individual', label: 'יחיד' },
  { value: 'couple', label: 'זוגי' },
]

const WHATSAPP_URL = 'https://wa.me/972528750238'

export default function JoinSelector() {
  const [status, setStatus] = useState<MembershipStatus | null>(null)
  const [mode, setMode] = useState<JoinMode | null>(null)

  const selectedUrl = status && mode ? EFFECTIVE_SOFT_URLS[status][mode] : null
  const selectedStatus = useMemo(
    () => STATUS_OPTIONS.find((option) => option.value === status),
    [status]
  )
  const selectedMode = MODE_OPTIONS.find((option) => option.value === mode)

  return (
    <div className="mx-auto max-w-3xl rounded-lg bg-white p-4 text-right text-slate-900 shadow-xl md:p-6" dir="rtl">
      <div className="mb-5">
        <p className="mb-2 text-sm font-semibold text-blue-700">בחרו את המסלול המתאים</p>
        <p className="text-sm leading-relaxed text-slate-600">
          אחרי הבחירה תעברו לטופס הרשמי במערכת המאובטחת של הליברלים בליכוד.
        </p>
      </div>

      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-800">סטטוס חברות</p>
          <div className="grid gap-2 md:grid-cols-3">
            {STATUS_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={cn(
                  'min-h-28 rounded-lg border bg-white p-3 text-right transition-colors',
                  'hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  status === option.value && 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                )}
                aria-pressed={status === option.value}
              >
                <span className="block text-sm font-semibold text-slate-900">{option.title}</span>
                <span className="mt-2 block text-xs leading-relaxed text-slate-600">
                  {option.description}
                </span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-800">סוג הצטרפות</p>
          <div className="grid grid-cols-2 gap-2">
            {MODE_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  'rounded-lg border bg-white px-4 py-3 text-center text-sm font-semibold transition-colors',
                  'hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  mode === option.value && 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600'
                )}
                aria-pressed={mode === option.value}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">
            {selectedStatus && selectedMode
              ? `${selectedStatus.title} · ${selectedMode.label}`
              : 'בחרו סטטוס וסוג הצטרפות כדי לפתוח את הטופס המתאים'}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">
            פרטי הזיהוי, החתימה והתשלום מוזנים רק במערכת effective-soft ולא נשמרים באתר הזה.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {selectedUrl ? (
            <a
              href={selectedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'h-11 flex-1 gap-2 bg-blue-700 text-white hover:bg-blue-800'
              )}
            >
              פתחו את הטופס הרשמי
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <Button size="lg" disabled className="h-11 flex-1">
              פתחו את הטופס הרשמי
            </Button>
          )}
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 gap-2')}
          >
            עזרה בוואטסאפ
            <MessageCircle className="h-4 w-4" />
          </a>
        </div>

        <div className="grid gap-2 border-t border-slate-200 pt-4 text-xs sm:grid-cols-2">
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.new.individual} target="_blank" rel="noopener noreferrer">
            התפקדות יחיד
          </a>
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.new.couple} target="_blank" rel="noopener noreferrer">
            התפקדות זוגית
          </a>
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.existing.individual} target="_blank" rel="noopener noreferrer">
            חבר ליכוד קיים - יחיד
          </a>
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.existing.couple} target="_blank" rel="noopener noreferrer">
            חברי ליכוד קיימים - זוגי
          </a>
        </div>
      </div>
    </div>
  )
}

export { EFFECTIVE_SOFT_URLS }
