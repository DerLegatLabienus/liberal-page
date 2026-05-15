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
  const activeBills = bills.filter((b) => b.status !== 'עבר' && b.status !== 'נדחה').slice(0, 3)

  return (
    <section className="border-b border-border bg-white py-4">
      <div className="container mx-auto px-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">📊 עדכוני כנסת אחרונים</h2>
          <button
            onClick={onOpenDrawer}
            className="text-xs text-primary hover:underline"
          >
            לכל הנתונים ←
          </button>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {activeBills.map((bill) => (
            <div
              key={bill.id}
              className={`min-w-[160px] shrink-0 rounded-md border border-s-4 px-3 py-2 ${STATUS_COLORS[bill.status] ?? 'border-slate-300 bg-slate-50'}`}
            >
              <p className="mb-1 text-xs text-muted-foreground">הצ"ח פעילה</p>
              <p className="mb-1 line-clamp-2 text-sm font-medium leading-snug text-foreground">
                {bill.title}
              </p>
              <p className={`text-xs font-medium ${STATUS_DOT[bill.status] ?? ''}`}>
                ● {bill.status}
              </p>
            </div>
          ))}
          {committees.slice(0, 1).map((c) => (
            <div
              key={c.id}
              className="min-w-[160px] shrink-0 rounded-md border border-s-4 border-blue-500 bg-blue-50 px-3 py-2"
            >
              <p className="mb-1 text-xs text-muted-foreground">ועדה במעקב</p>
              <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground">
                {c.name}
              </p>
              {c.lastSessionDate && (
                <p className="mt-1 text-xs text-green-600">
                  ● ישיבה: {new Date(c.lastSessionDate).toLocaleDateString('he-IL')}
                </p>
              )}
            </div>
          ))}
          <button
            onClick={onOpenDrawer}
            className="flex min-w-[100px] shrink-0 items-center justify-center rounded-md border border-dashed border-primary/40 px-3 py-2 text-sm text-primary hover:bg-primary/5"
          >
            + עוד נתונים
          </button>
        </div>
      </div>
    </section>
  )
}
