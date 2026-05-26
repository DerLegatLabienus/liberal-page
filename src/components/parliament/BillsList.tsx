import type { TabState } from '@/hooks/useBillsOverview'
import BillOverviewRow from './BillOverviewRow'

export default function BillsList({ tab }: { tab: TabState }) {
  if (tab.loading) return <p className="py-4 text-center text-muted-foreground">טוען…</p>
  if (tab.error) {
    return (
      <div className="py-4 text-center">
        <p className="text-destructive">שגיאה בטעינת הצעות החוק</p>
        <button type="button" onClick={() => void tab.retry()} className="mt-2 text-primary underline">
          נסה שוב
        </button>
      </div>
    )
  }
  if (tab.items.length === 0) return <p className="py-4 text-center text-muted-foreground">אין הצעות חוק להצגה</p>

  return (
    <ul className="max-h-[28rem] overflow-y-auto" dir="rtl">
      {tab.items.map((bill) => (
        <BillOverviewRow key={bill.billId} bill={bill} />
      ))}
    </ul>
  )
}
