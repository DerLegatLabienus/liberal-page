import { useMemo, useState } from 'react'
import { useDirection } from '@/hooks/useDirection'
import { ExternalLink, MessageCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type MembershipStatus = 'new' | 'renewal' | 'existing'
type JoinMode = 'individual' | 'couple'

const EFFECTIVE_SOFT_URLS: Record<MembershipStatus, Record<JoinMode, string>> = {
  new: {
    individual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal',
    couple: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal2',
  },
  renewal: {
    individual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal',
    couple: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal2',
  },
  existing: {
    individual: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal3',
    couple: 'https://effective-soft.co.il/XZone/pfo?uid=licudliberal4',
  },
}

const STATUS_OPTION_KEYS: Array<{ value: MembershipStatus; titleKey: string; descKey: string }> = [
  { value: 'new', titleKey: 'join.status_new_title', descKey: 'join.status_new_desc' },
  { value: 'renewal', titleKey: 'join.status_renewal_title', descKey: 'join.status_renewal_desc' },
  { value: 'existing', titleKey: 'join.status_existing_title', descKey: 'join.status_existing_desc' },
]

const MODE_OPTION_KEYS: Array<{ value: JoinMode; labelKey: string }> = [
  { value: 'individual', labelKey: 'join.individual' },
  { value: 'couple', labelKey: 'join.couple' },
]

const WHATSAPP_URL = 'https://wa.me/972528750238'

export default function JoinSelector() {
  const { t } = useTranslation()
  const direction = useDirection()
  const [status, setStatus] = useState<MembershipStatus | null>(null)
  const [mode, setMode] = useState<JoinMode | null>(null)

  const selectedUrl = status && mode ? EFFECTIVE_SOFT_URLS[status][mode] : null
  const selectedStatusKey = useMemo(
    () => STATUS_OPTION_KEYS.find((o) => o.value === status),
    [status]
  )
  const selectedModeKey = MODE_OPTION_KEYS.find((o) => o.value === mode)

  return (
    <div className="mx-auto max-w-3xl rounded-lg bg-white p-4 text-start text-slate-900 shadow-xl md:p-6" dir={direction}>
      <div className="mb-5">
        <p className="mb-2 text-sm font-semibold text-blue-700">{t('join.choose_path')}</p>
        <p className="text-sm leading-relaxed text-slate-600">{t('join.choose_subtitle')}</p>
      </div>

      <div className="space-y-5">
        <div>
          <p className="mb-2 text-sm font-semibold text-slate-800">{t('join.membership_status')}</p>
          <div className="grid gap-2 md:grid-cols-3">
            {STATUS_OPTION_KEYS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setStatus(option.value)}
                className={cn(
                  'min-h-28 rounded-lg border bg-white p-3 text-start transition-colors',
                  'hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  status === option.value && 'border-blue-600 bg-blue-50 ring-1 ring-blue-600'
                )}
                aria-pressed={status === option.value}
              >
                <span className="block text-sm font-semibold text-slate-900">{t(option.titleKey)}</span>
                <span className="mt-2 block text-xs leading-relaxed text-slate-600">{t(option.descKey)}</span>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-semibold text-slate-800">{t('join.join_type')}</p>
          <div className="grid grid-cols-2 gap-2">
            {MODE_OPTION_KEYS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setMode(option.value)}
                className={cn(
                  'rounded-lg border bg-white px-4 py-3 text-center text-sm font-semibold transition-colors',
                  'hover:border-blue-400 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500',
                  mode === option.value && 'border-blue-600 bg-blue-50 text-blue-700 ring-1 ring-blue-600'
                )}
                aria-pressed={mode === option.value}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-900">
            {selectedStatusKey && selectedModeKey
              ? `${t(selectedStatusKey.titleKey)} · ${t(selectedModeKey.labelKey)}`
              : t('join.summary_placeholder')}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-slate-600">{t('join.privacy_note')}</p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          {selectedUrl ? (
            <a
              href={selectedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                buttonVariants({ size: 'lg' }),
                'h-11 flex-1 gap-2 bg-blue-700 text-white hover:bg-blue-800'
              )}
            >
              {t('join.open_form')}
              <ExternalLink className="h-4 w-4" />
            </a>
          ) : (
            <Button size="lg" disabled className="h-11 flex-1">{t('join.open_form')}</Button>
          )}
          <a
            href={WHATSAPP_URL}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'h-11 gap-2')}
          >
            {t('join.whatsapp_help')}
            <MessageCircle className="h-4 w-4" />
          </a>
        </div>

        <div className="grid gap-2 border-t border-slate-200 pt-4 text-xs sm:grid-cols-2">
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.new.individual} target="_blank" rel="noopener noreferrer">
            {t('join.link_new_individual')}
          </a>
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.new.couple} target="_blank" rel="noopener noreferrer">
            {t('join.link_new_couple')}
          </a>
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.existing.individual} target="_blank" rel="noopener noreferrer">
            {t('join.link_existing_individual')}
          </a>
          <a className="text-blue-700 hover:underline" href={EFFECTIVE_SOFT_URLS.existing.couple} target="_blank" rel="noopener noreferrer">
            {t('join.link_existing_couple')}
          </a>
        </div>
      </div>
    </div>
  )
}

export { EFFECTIVE_SOFT_URLS }
