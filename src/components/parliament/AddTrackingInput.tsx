import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api-client'
import type { TrackingType } from '@/types'

const RAW_ID_RE = /^\d+$/

interface AddTrackingInputProps {
  onAdd: () => void
}

export default function AddTrackingInput({ onAdd }: AddTrackingInputProps) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [selectedType, setSelectedType] = useState<TrackingType | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const TYPE_OPTIONS: { value: TrackingType; label: string }[] = [
    { value: 'bill', label: t('tracker.tab_bill') },
    { value: 'committee', label: t('tracker.tab_committee') },
  ]

  const trimmed = value.trim()
  const isRawId = RAW_ID_RE.test(trimmed) && trimmed.length > 0
  const needsTypeSelector = isRawId
  const canSubmit = trimmed && (!needsTypeSelector || selectedType)

  const handleSubmit = async () => {
    if (!canSubmit) return
    setLoading(true)
    setError(null)
    try {
      if (isRawId && selectedType) {
        await api.tracking.add({ rawId: trimmed, type: selectedType })
      } else {
        await api.tracking.add({ url: trimmed })
      }
      setValue('')
      setSelectedType(null)
      onAdd()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('tracker.error_generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2" dir="rtl">
      <p className="text-right text-xs font-semibold text-primary">{t('tracker.add_new')}</p>
      <div className="flex gap-2">
        <Input
          placeholder={t('tracker.placeholder')}
          value={value}
          onChange={(e) => { setValue(e.target.value); setSelectedType(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          className="text-xs"
          dir="ltr"
        />
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || loading}>
          {loading ? '...' : t('tracker.add_button')}
        </Button>
      </div>
      {needsTypeSelector && (
        <div className="flex gap-2">
          {TYPE_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelectedType(opt.value)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                selectedType === opt.value
                  ? 'border-primary bg-primary text-white'
                  : 'border-border text-muted-foreground hover:border-primary'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">oknesset.org · knesset.gov.il · gov.il</p>
    </div>
  )
}
