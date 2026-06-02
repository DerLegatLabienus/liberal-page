import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import { Badge } from '@/components/ui/badge'
import type { Committee } from '@/types'

interface CommitteeCardProps {
  committee: Committee
  onRemove?: (id: number) => void
  trackedMks: { knesset_site_id?: string; name: string }[]
}

export default function CommitteeCard({ committee, onRemove, trackedMks: _trackedMks }: CommitteeCardProps) {
  const { t } = useTranslation()
  const direction = useDirection()

  const sessions = committee.recentSessions ?? []
  const [extended, ...compactSessions] = sessions

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className="w-1 shrink-0 bg-blue-500" />
      <div className="flex-1 p-4" dir="rtl">
        <div className="mb-1 flex items-center gap-2">
          <p className="text-right text-sm font-semibold text-foreground">{committee.name}</p>
          {committee.inactive && (
            <Badge variant="secondary">{t('tracker.closed')}</Badge>
          )}
        </div>
        {committee.chair && (
          <p className="mb-2 text-right text-xs text-muted-foreground">{t('tracker.chair_prefix')} {committee.chair}</p>
        )}

        {extended && (
          <div className="mb-3 rounded-md border border-slate-100 bg-slate-50 p-2">
            <div className="mb-1 flex items-start justify-between gap-2">
              <p className="flex-1 text-right text-xs font-medium text-foreground line-clamp-2">{extended.title}</p>
              <a href={extended.sessionUrl} target="_blank" rel="noopener noreferrer"
                className="shrink-0 text-xs text-primary hover:underline">↗</a>
            </div>
            <p className="mb-1 text-right text-xs text-muted-foreground">
              {new Date(extended.date).toLocaleDateString('he-IL')}
            </p>

            {extended.aiSummary && (
              <div className="rounded-md bg-blue-50 px-2 py-1">
                <p className="text-right text-xs font-semibold text-blue-700 mb-0.5">{t('tracker.ai_session_summary')}</p>
                <p className="text-right text-xs text-muted-foreground leading-snug">{extended.aiSummary}</p>
              </div>
            )}
          </div>
        )}

        {compactSessions.slice(0, 3).map((compact) => (
          <div key={compact.sessionId} className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <span className="shrink-0">{new Date(compact.date).toLocaleDateString('he-IL')}</span>
            <span className="mx-1">·</span>
            <a href={compact.sessionUrl} target="_blank" rel="noopener noreferrer"
              className="flex-1 text-right text-primary hover:underline line-clamp-1">
              {compact.title}
            </a>
          </div>
        ))}

        <div className="flex items-center justify-between">
          {committee.sourceUrl && (
            <a href={committee.sourceUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline">
              {t('tracker.view_source')}
            </a>
          )}
          {onRemove && (
            <button onClick={() => onRemove(committee.id)}
              className="text-xs text-red-400 hover:text-red-600 ms-auto">
              {t('tracker.remove')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
