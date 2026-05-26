export type BillsTabId = 'recent' | 'trending' | 'policy'

const LABELS: Record<BillsTabId, string> = {
  recent: 'חדשות',
  trending: 'בולטות',
  policy: 'ליברליות',
}

export default function BillsTabs({
  active,
  tabs,
  onChange,
}: {
  active: BillsTabId
  tabs: BillsTabId[]
  onChange: (id: BillsTabId) => void
}) {
  return (
    <div className="flex gap-2 border-b border-border" role="tablist" dir="rtl">
      {tabs.map((id) => (
        <button
          key={id}
          role="tab"
          aria-selected={active === id}
          onClick={() => onChange(id)}
          className={`px-4 py-2 text-sm font-medium ${
            active === id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground'
          }`}
        >
          {LABELS[id]}
        </button>
      ))}
    </div>
  )
}
