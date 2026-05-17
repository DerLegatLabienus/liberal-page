import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import type { Committee } from '@/types'

interface CommitteeCardProps {
  committee: Committee
  onRemove?: (id: number) => void
}

export default function CommitteeCard({ committee, onRemove }: CommitteeCardProps) {
  const { t } = useTranslation()
  const direction = useDirection()

  return (
    <div className={`relative flex overflow-hidden rounded-lg border border-border bg-white ${direction === 'rtl' ? 'flex-row' : 'flex-row-reverse'}`}>
      <div className="w-1 shrink-0 bg-blue-500" />
      <div className="flex-1 p-4" dir="rtl">
        <p className="mb-1 text-right text-sm font-semibold text-foreground">{committee.name}</p>
        {committee.chair && (
          <p className="mb-2 text-right text-xs text-muted-foreground">{t('tracker.chair_prefix')} {committee.chair}</p>
        )}
        {committee.lastSessionDate && (
          <p className="mb-2 text-right text-xs text-muted-foreground">
            {t('tracker.last_session_prefix')} {new Date(committee.lastSessionDate).toLocaleDateString('he-IL')}
          </p>
        )}
        {committee.lastSessionSummary && (
          <div className="mb-2 rounded-md bg-blue-50 p-2">
            <p className="mb-1 text-right text-xs font-semibold text-blue-700">{t('tracker.ai_session_summary')}</p>
            <p className="text-right leading-relaxed text-xs text-muted-foreground">{committee.lastSessionSummary}</p>
          </div>
        )}
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
