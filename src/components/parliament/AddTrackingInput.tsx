import { useState } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api-client'
import type { TrackingType } from '@/types'

const RAW_ID_RE = /^\d+$/

const TYPE_OPTIONS: { value: TrackingType; label: string }[] = [
  { value: 'bill', label: 'הצ"ח' },
  { value: 'committee', label: 'ועדה' },
  { value: 'mk', label: 'ח"כ' },
]

interface AddTrackingInputProps {
  onAdd: () => void
}

export default function AddTrackingInput({ onAdd }: AddTrackingInputProps) {
  const [value, setValue] = useState('')
  const [selectedType, setSelectedType] = useState<TrackingType | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      setError(err instanceof Error ? err.message : 'שגיאה')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-primary">+ הוסף מעקב חדש</p>
      <div className="flex gap-2">
        <Input
          placeholder="הדבק קישור מאתר הכנסת..."
          value={value}
          onChange={(e) => { setValue(e.target.value); setSelectedType(null) }}
          onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          className="text-xs"
          dir="ltr"
        />
        <Button size="sm" onClick={handleSubmit} disabled={!canSubmit || loading}>
          {loading ? '...' : 'הוסף'}
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
