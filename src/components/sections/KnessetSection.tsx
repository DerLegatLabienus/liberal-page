import type { Bill, Committee } from '@/types'
import ParliamentStrip from '@/components/sections/ParliamentStrip'
import KnessetBillsOverview from '@/components/sections/KnessetBillsOverview'

interface KnessetSectionProps {
  bills: Bill[]
  committees: Committee[]
  onOpenDrawer: () => void
  error?: boolean
  onRetry?: () => void
}

/**
 * Consolidated Knesset block (Hebrew only): the group's tracked items as a
 * teaser row on top (ParliamentStrip), the all-bills browser below
 * (KnessetBillsOverview) — two purposes, one section.
 */
export default function KnessetSection({ bills, committees, onOpenDrawer, error, onRetry }: KnessetSectionProps) {
  return (
    <section className="border-y border-border bg-blue-50/40 py-12" dir="rtl">
      <div className="container mx-auto max-w-4xl space-y-8 px-4">
        {error && (
          <div className="rounded bg-destructive/10 px-4 py-2 text-center text-sm text-destructive">
            שגיאה בטעינת נתוני הכנסת —{' '}
            <button type="button" onClick={onRetry} className="underline">
              נסה שוב
            </button>
          </div>
        )}
        <ParliamentStrip bills={bills} committees={committees} onOpenDrawer={onOpenDrawer} />
        <KnessetBillsOverview />
      </div>
    </section>
  )
}
