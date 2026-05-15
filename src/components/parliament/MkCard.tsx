import { useDirection } from '@/hooks/useDirection'
import type { Mk } from '@/types'

const VOTE_COLORS: Record<string, string> = {
  'בעד': 'text-green-600',
  'נגד': 'text-red-500',
  'נמנע': 'text-yellow-600',
  'נעדר': 'text-slate-400',
}

interface MkCardProps {
  mk: Mk
  onRemove?: (id: number) => void
}

export default function MkCard({ mk, onRemove }: MkCardProps) {
  const direction = useDirection()

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className="w-1 shrink-0 bg-purple-500" />
      <div className="flex-1 p-4">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">{mk.name || 'ח"כ לא מוגדר'}</p>
          <span className="text-xs text-muted-foreground">{mk.party}</span>
        </div>
        {mk.votingSummary && (
          <div className="mb-2 rounded-md bg-purple-50 p-2">
            <p className="mb-1 text-xs font-semibold text-purple-700">✦ סיכום הצבעות (AI)</p>
            <p className="leading-relaxed text-xs text-muted-foreground">{mk.votingSummary}</p>
          </div>
        )}
        {mk.recentVotes.length > 0 && (
          <div className="mb-2">
            <p className="mb-1 text-xs font-medium text-muted-foreground">הצבעות אחרונות:</p>
            <div className="space-y-1">
              {mk.recentVotes.slice(0, 3).map((vote, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span className={`font-medium ${VOTE_COLORS[vote.vote] ?? ''}`}>{vote.vote}</span>
                  <span className="truncate text-muted-foreground">{vote.billTitle}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center justify-between">
          {mk.sourceUrl && (
            <a href={mk.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">
              צפה במקור ↗
            </a>
          )}
          {onRemove && (
            <button onClick={() => onRemove(mk.id)}
              className="text-xs text-red-400 hover:text-red-600 ltr:ml-auto rtl:mr-auto">
              הסר
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
