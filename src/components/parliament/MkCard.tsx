import { useDirection } from '@/hooks/useDirection'
import type { Mk } from '@/types'
import type { MkActivity } from '@/types'

const VOTE_COLORS: Record<string, string> = {
  'בעד': 'text-green-600',
  'נגד': 'text-red-500',
  'נמנע': 'text-yellow-600',
  'נעדר': 'text-slate-400',
}

const ACTIVITY_ICONS: Record<string, string> = {
  bill_initiated: '📋',
  vote: '🗳',
  duty_change: '🔄',
  question: '❓',
}

interface MkCardProps {
  mk: Mk
  onRemove?: (id: number) => void
}

function ActivityItem({ item }: { item: MkActivity }) {
  const voteColorKey = item.type === 'vote' && item.detail
    ? Object.keys(VOTE_COLORS).find((k) => item.detail!.includes(k))
    : undefined
  const detailColor = voteColorKey ? VOTE_COLORS[voteColorKey] : 'text-muted-foreground'

  return (
    <div className="flex items-start gap-2 text-xs" dir="rtl">
      <span className="shrink-0 mt-0.5">{ACTIVITY_ICONS[item.type] ?? '•'}</span>
      <div className="flex-1 min-w-0">
        <p className="text-right text-foreground leading-snug line-clamp-2">{item.title}</p>
        <p className={`text-right ${detailColor}`}>
          {item.detail ? `${item.detail} · ` : ''}{new Date(item.date).toLocaleDateString('he-IL')}
        </p>
      </div>
      {item.sourceUrl && (
        <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer"
          className="shrink-0 text-primary hover:underline">↗</a>
      )}
    </div>
  )
}

export default function MkCard({ mk, onRemove }: MkCardProps) {
  const direction = useDirection()
  const activity = mk.activity ?? []
  const photoUrl = mk.photoUrl

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className="w-1 shrink-0 bg-purple-500" />
      <div className="flex-1 p-4" dir="rtl">

        {/* Header: photo + name + party */}
        <div className="mb-3 flex items-center gap-3">
          {photoUrl && (
            <img
              src={photoUrl}
              alt={mk.name}
              className="h-10 w-10 shrink-0 rounded-full object-cover border border-slate-200"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          )}
          <div className="min-w-0">
            <p className="text-right text-sm font-semibold text-foreground leading-tight">
              {mk.name || 'ח"כ לא מוגדר'}
            </p>
            {mk.party && (
              <p className="text-right text-xs text-muted-foreground">{mk.party}</p>
            )}
          </div>
        </div>

        {/* AI voting summary */}
        {mk.votingSummary && (
          <div className="mb-3 rounded-md bg-purple-50 p-2">
            <p className="mb-1 text-right text-xs font-semibold text-purple-700">✦ סיכום הצבעות (AI)</p>
            <p className="text-right leading-relaxed text-xs text-muted-foreground">{mk.votingSummary}</p>
          </div>
        )}

        {/* Activity feed */}
        {activity.length > 0 && (
          <div className="mb-3 space-y-2">
            <p className="text-right text-xs font-medium text-muted-foreground uppercase tracking-wide">פעילות אחרונה</p>
            {activity.slice(0, 4).map((item, i) => (
              <ActivityItem key={i} item={item} />
            ))}
          </div>
        )}

        {/* Legacy recentVotes fallback */}
        {activity.length === 0 && mk.recentVotes.length > 0 && (
          <div className="mb-3">
            <p className="mb-1 text-right text-xs font-medium text-muted-foreground">הצבעות אחרונות:</p>
            <div className="space-y-1">
              {mk.recentVotes.slice(0, 3).map((vote, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className="truncate text-muted-foreground">{vote.billTitle}</span>
                  <span className={`shrink-0 font-medium ${VOTE_COLORS[vote.vote] ?? ''}`}>{vote.vote}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between">
          {mk.sourceUrl && (
            <a href={mk.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">
              צפה במקור ↗
            </a>
          )}
          {onRemove && (
            <button onClick={() => onRemove(mk.id)}
              className="text-xs text-red-400 hover:text-red-600 ms-auto">
              הסר
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
