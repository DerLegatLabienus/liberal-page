import { useMkActivity } from '@/hooks/useMkActivity'
import MkCard from '@/components/parliament/MkCard'
import type { KnessetMember, Mk } from '@/types'

interface MkActivityCardProps {
  member: KnessetMember
  maxActivity?: number
}

export default function MkActivityCard({ member, maxActivity }: MkActivityCardProps) {
  const { activity, loading, error } = useMkActivity(member.siteId)

  if (error) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600">
        {error}
      </div>
    )
  }

  const mk: Mk = {
    id: member.siteId,
    oknesset_id: '',
    knesset_site_id: String(member.siteId),
    name: member.name,
    party: member.party,
    photoUrl: member.photoUrl,
    recentVotes: [],
    activity: activity ?? [],
    votingSummary: null,
    sourceUrl: `https://main.knesset.gov.il/mk/Apps/mk/mk-positions/${member.siteId}`,
    hasNewData: false,
    lastPolledAt: null,
  }

  return (
    <div className="relative">
      <MkCard mk={mk} maxActivity={maxActivity} />
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/70">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      )}
    </div>
  )
}
