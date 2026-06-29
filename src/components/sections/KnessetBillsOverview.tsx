import { useState } from 'react'
import { useBillsOverview } from '@/hooks/useBillsOverview'
import BillsTabs, { type BillsTabId } from '@/components/parliament/BillsTabs'
import BillsList from '@/components/parliament/BillsList'

export default function KnessetBillsOverview() {
  const { recent, trending, policyAligned, policyEnabled } = useBillsOverview()
  const [active, setActive] = useState<BillsTabId>('recent')

  const tabs: BillsTabId[] = policyEnabled ? ['recent', 'trending', 'policy'] : ['recent', 'trending']
  const tabState = active === 'recent' ? recent : active === 'trending' ? trending : policyAligned

  return (
    <div dir="rtl">
      <h2 className="mb-1 text-start text-2xl font-bold">מה קורה בכנסת</h2>
      <p className="mb-4 text-start text-sm text-muted-foreground">הצעות חוק מרחבי הכנסת</p>
      <BillsTabs active={active} tabs={tabs} onChange={setActive} />
      <div className="mt-2">
        <BillsList tab={tabState} />
      </div>
    </div>
  )
}
