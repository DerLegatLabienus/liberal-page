import { useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { useDirection } from '@/hooks/useDirection'
import { api } from '@/lib/api-client'
import AddTrackingInput from '@/components/parliament/AddTrackingInput'
import BillCard from '@/components/parliament/BillCard'
import CommitteeCard from '@/components/parliament/CommitteeCard'
import MkCombobox from '@/components/parliament/MkCombobox'
import MkActivityCard from '@/components/parliament/MkActivityCard'
import MkCard from '@/components/parliament/MkCard'
import BillSearchCombobox from '@/components/parliament/BillSearchCombobox'
import CommitteeCombobox from '@/components/parliament/CommitteeCombobox'
import type { Bill, Committee, Mk, KnessetMember } from '@/types'
import type { TrackScope } from '@/lib/api-client'

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
  scope: TrackScope
  onScopeChange: (s: TrackScope) => void
  canEdit: boolean
  isLoggedIn: boolean
}

export default function ParliamentDrawer({
  open, onClose, bills, committees, mks,
  loading, lastSyncedAt, onRefresh, onAdd,
  onRemoveBill, onRemoveCommittee, onRemoveMk,
  scope, onScopeChange, canEdit, isLoggedIn,
}: ParliamentDrawerProps) {
  const { t, i18n } = useTranslation()
  const direction = useDirection()

  const lastSyncedLabel = lastSyncedAt
    ? `${t('ui.drawer_last_synced')}: ${new Date(lastSyncedAt).toLocaleTimeString(i18n.language === 'he' ? 'he-IL' : 'en-US')}`
    : t('ui.drawer_not_synced')

  const [selectedMk, setSelectedMk] = useState<KnessetMember | null>(null)

  const handleSelectMk = (member: KnessetMember) => {
    setSelectedMk(member)
    // Track in background if not already tracked
    const alreadyTracked = mks.some((m) => m.knesset_site_id === String(member.siteId))
    if (!alreadyTracked && canEdit) {
      const url = `https://www.knesset.gov.il/mk/Apps/mk/mk-positions/${member.siteId}`
      api.tracking.add({ url }, scope).then(() => onAdd()).catch(() => {/* silently ignore */})
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v: boolean) => !v && onClose()}>
      <SheetContent
        side={direction === 'rtl' ? 'right' : 'left'}
        className="flex w-full flex-col gap-0 bg-white bg-clip-border p-0 text-slate-900 sm:max-w-md"
      >
        <SheetHeader className="bg-primary px-4 py-3">
          <SheetTitle className="text-white">{t('ui.drawer_title')}</SheetTitle>
        </SheetHeader>

        {isLoggedIn && (
          <div className="flex gap-1 border-b border-border bg-slate-50 px-4 py-2">
            <button
              onClick={() => onScopeChange('group')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${scope === 'group' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-slate-100'}`}
            >
              {t('tracker.group_list')}
            </button>
            <button
              onClick={() => onScopeChange('personal')}
              className={`flex-1 rounded px-3 py-1.5 text-sm font-medium transition-colors ${scope === 'personal' ? 'bg-primary text-white' : 'text-muted-foreground hover:bg-slate-100'}`}
            >
              {t('tracker.my_list')}
            </button>
          </div>
        )}

        {canEdit && (
          <div className="border-b border-border bg-blue-50 px-4 py-3">
            <AddTrackingInput onAdd={onAdd} scope={scope} />
          </div>
        )}

        <Tabs defaultValue="bills" className="flex flex-1 flex-col overflow-hidden">
          <TabsList className="w-full rounded-none border-b border-border">
            <TabsTrigger value="bills" className="flex-1">{t('ui.drawer_bills_tab')}</TabsTrigger>
            <TabsTrigger value="committees" className="flex-1">{t('ui.drawer_committees_tab')}</TabsTrigger>
            <TabsTrigger value="mks" className="flex-1">{t('ui.drawer_mks_tab')}</TabsTrigger>
          </TabsList>

          <div className="flex-1 overflow-y-auto">
            <TabsContent value="bills" className="m-0 space-y-3 p-4">
              {canEdit && <BillSearchCombobox onAdd={onAdd} scope={scope} />}
              {bills.map((bill) => (
                <BillCard key={bill.id} bill={bill} onRemove={canEdit ? onRemoveBill : undefined} />
              ))}
              {bills.length === 0 && (
                <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_bills')}</p>
              )}
            </TabsContent>

            <TabsContent value="committees" className="m-0 space-y-3 p-4">
              {canEdit && <CommitteeCombobox onAdd={onAdd} scope={scope} />}
              {committees.map((c) => (
                <CommitteeCard key={c.id} committee={c} onRemove={canEdit ? onRemoveCommittee : undefined} trackedMks={mks} />
              ))}
              {committees.length === 0 && (
                <p className="py-8 text-right text-sm text-muted-foreground">{t('ui.drawer_empty_committees')}</p>
              )}
            </TabsContent>

            <TabsContent value="mks" className="m-0 space-y-3 p-4">
              {canEdit && <MkCombobox onSelect={handleSelectMk} selectedSiteId={selectedMk?.siteId ?? null} />}
              {selectedMk && <MkActivityCard member={selectedMk} />}
              {mks.length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide text-start pt-2">
                    {t('ui.drawer_mks_tab')}
                  </p>
                  {mks.map((mk) => (
                    <MkCard key={mk.id} mk={mk} onRemove={canEdit ? onRemoveMk : undefined} />
                  ))}
                </div>
              )}
              {!selectedMk && mks.length === 0 && (
                <p className="py-8 text-start text-sm text-muted-foreground">{t('ui.drawer_empty_mks')}</p>
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
