import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useDirection } from '@/hooks/useDirection'
import AddTrackingInput from '@/components/parliament/AddTrackingInput'
import BillCard from '@/components/parliament/BillCard'
import CommitteeCard from '@/components/parliament/CommitteeCard'
import MkCard from '@/components/parliament/MkCard'
import type { Bill, Committee, Mk } from '@/types'

interface ParliamentDrawerProps {
  open: boolean
  onClose: () => void
  bills: Bill[]
  committees: Committee[]
  mks: Mk[]
  loading: boolean
  lastSyncedAt: string | null
  onRefresh: () => void
  onAdd: () => void
  onRemoveBill: (id: number) => void
  onRemoveCommittee: (id: number) => void
  onRemoveMk: (id: number) => void
}

export default function ParliamentDrawer({
  open, onClose, bills, committees, mks,
  loading, lastSyncedAt, onRefresh, onAdd,
  onRemoveBill, onRemoveCommittee, onRemoveMk,
}: ParliamentDrawerProps) {
  const { t, i18n } = useTranslation()
  const direction = useDirection()

  const lastSyncedLabel = lastSyncedAt
    ? `${t('ui.drawer_last_synced')}: ${new Date(lastSyncedAt).toLocaleTimeString(i18n.language === 'he' ? 'he-IL' : 'en-US')}`
    : t('ui.drawer_not_synced')

  return (
    <Sheet open={open} onOpenChange={(v: boolean) => !v && onClose()}>
      <SheetContent
        side={direction === 'rtl' ? 'right' : 'left'}
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
      >
        <SheetHeader className="bg-primary px-4 py-3">
          <SheetTitle className="text-white">{t('ui.drawer_title')}</SheetTitle>
        </SheetHeader>

        <div className="border-b border-border bg-blue-50 px-4 py-3">
          <AddTrackingInput onAdd={onAdd} />
        </div>

        <Tabs defaultValue="bills" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="w-full rounded-none border-b border-border">
            <TabsTrigger value="bills" className="flex-1">{t('ui.drawer_bills_tab')}</TabsTrigger>
            <TabsTrigger value="committees" className="flex-1">{t('ui.drawer_committees_tab')}</TabsTrigger>
            <TabsTrigger value="mks" className="flex-1">{t('ui.drawer_mks_tab')}</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="bills" className="m-0 space-y-3 p-4">
              {bills.map((bill) => (
                <BillCard key={bill.id} bill={bill} onRemove={onRemoveBill} />
              ))}
              {bills.length === 0 && (
                <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_bills')}</p>
              )}
            </TabsContent>

            <TabsContent value="committees" className="m-0 space-y-3 p-4">
              {committees.map((c) => (
                <CommitteeCard key={c.id} committee={c} onRemove={onRemoveCommittee} />
              ))}
              {committees.length === 0 && (
                <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_committees')}</p>
              )}
            </TabsContent>

            <TabsContent value="mks" className="m-0 space-y-3 p-4">
              {mks.map((mk) => (
                <MkCard key={mk.id} mk={mk} onRemove={onRemoveMk} />
              ))}
              {mks.length === 0 && (
                <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_mks')}</p>
              )}
            </TabsContent>
          </div>
        </Tabs>

        <div className="flex items-center justify-between border-t border-border bg-slate-50 px-4 py-2">
          <p className="text-xs text-muted-foreground">{lastSyncedLabel}</p>
          <Button size="sm" variant="outline" onClick={onRefresh} disabled={loading} className="gap-1 text-xs">
            <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
            {t('ui.drawer_refresh')}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
