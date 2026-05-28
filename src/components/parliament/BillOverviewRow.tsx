import { useState } from 'react'
import type { KnessetBillOverviewItem } from '@/types'

export default function BillOverviewRow({ bill }: { bill: KnessetBillOverviewItem }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <li className="border-b border-border py-3" dir="rtl">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex w-full items-center justify-between gap-2 text-right"
      >
        <span className="flex-1 min-w-0 truncate font-medium">{bill.title}</span>
        {bill.status && (
          <span className="shrink-0 rounded bg-muted px-2 py-0.5 text-xs">{bill.status}</span>
        )}
      </button>

      {expanded && (
        <div className="mt-2 space-y-2 text-sm text-muted-foreground">
          {bill.committee && <p className="max-w-[10rem] truncate">{bill.committee}</p>}
          {bill.summary && <p>{bill.summary}</p>}
          {bill.reason && <p className="font-medium text-foreground">{bill.reason}</p>}
          {bill.lastUpdatedDate && <p className="text-xs">עודכן: {bill.lastUpdatedDate}</p>}
          <a
            href={bill.knessetUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-primary underline"
          >
            קישור לכנסת ↗
          </a>
        </div>
      )}
    </li>
  )
}
