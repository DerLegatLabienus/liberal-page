import { useDirection } from '@/hooks/useDirection'
import type { Committee } from '@/types'

interface CommitteeCardProps {
  committee: Committee
  onRemove?: (id: number) => void
}

export default function CommitteeCard({ committee, onRemove }: CommitteeCardProps) {
  const direction = useDirection()

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className="w-1 shrink-0 bg-blue-500" />
      <div className="flex-1 p-4">
        <p className="mb-1 text-sm font-semibold text-foreground">{committee.name}</p>
        {committee.chair && (
          <p className="mb-2 text-xs text-muted-foreground">יו"ר: {committee.chair}</p>
        )}
        {committee.lastSessionDate && (
          <p className="mb-2 text-xs text-muted-foreground">
            ישיבה אחרונה: {new Date(committee.lastSessionDate).toLocaleDateString('he-IL')}
          </p>
        )}
        {committee.lastSessionSummary && (
          <div className="mb-2 rounded-md bg-blue-50 p-2">
            <p className="mb-1 text-xs font-semibold text-blue-700">✦ סיכום ישיבה אחרונה (AI)</p>
            <p className="leading-relaxed text-xs text-muted-foreground">{committee.lastSessionSummary}</p>
          </div>
        )}
        <div className="flex items-center justify-between">
          {committee.sourceUrl && (
            <a href={committee.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">
              צפה במקור ↗
            </a>
          )}
          {onRemove && (
            <button onClick={() => onRemove(committee.id)}
              className="text-xs text-red-400 hover:text-red-600 ms-auto">
              הסר
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
