import { analyzeSms } from '@/lib/sms-segments'

interface SmsBodyEditorProps {
  value: string
  onChange: (v: string) => void
  maxSegments?: number
  channelLabel: string
  mode?: 'sms' | 'whatsapp'
}

const WHATSAPP_MAX = 2000

export default function SmsBodyEditor({ value, onChange, maxSegments = 3, channelLabel, mode = 'sms' }: SmsBodyEditorProps) {
  const info = analyzeSms(value)
  const over = mode === 'sms' ? info.segments > maxSegments : value.length > WHATSAPP_MAX

  return (
    <div className="flex flex-col gap-1.5" dir="rtl">
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={5}
        className="w-full rounded-lg border border-slate-300 p-3 text-sm"
        aria-label={channelLabel}
      />
      <div className="flex items-center justify-between text-xs text-slate-500">
        {mode === 'sms' ? (
          <span>
            <span data-testid="sms-encoding">{info.encoding.toUpperCase()}</span>
            {' · '}{info.units} · {info.segments} מקטעים
          </span>
        ) : (
          <span>{value.length} / {WHATSAPP_MAX}</span>
        )}
        {over && (
          <span data-testid="sms-over-limit" className="font-semibold text-red-600">
            חורג מהמגבלה
          </span>
        )}
      </div>
    </div>
  )
}
