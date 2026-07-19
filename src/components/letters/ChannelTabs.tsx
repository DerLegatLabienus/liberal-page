import type { ChannelKind } from '@/types'

const LABELS: Record<ChannelKind, string> = { email: 'מייל', sms: 'SMS', whatsapp: 'וואטסאפ' }
const DOT: Record<ChannelKind, string> = {
  email: 'bg-primary',
  sms: 'bg-slate-500',
  whatsapp: 'bg-emerald-500',
}

/**
 * Tab bar for a letter's enabled channels. Renders nothing when there's only one —
 * a lone tab is chrome. Channel colour appears only as the small dot, never as a
 * full-colour control. RTL arrow keys mirror HomePanels: in RTL, Left = forward.
 */
export default function ChannelTabs({ kinds, selected, onSelect }: {
  kinds: ChannelKind[]
  selected: ChannelKind
  onSelect: (k: ChannelKind) => void
}) {
  if (kinds.length <= 1) return null

  const move = (delta: number) => {
    const i = kinds.indexOf(selected)
    const next = kinds[Math.min(Math.max(i + delta, 0), kinds.length - 1)]
    if (next) onSelect(next)
  }

  return (
    <div
      role="tablist"
      className="flex gap-1 border-b border-border px-5"
      onKeyDown={(e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); move(1) }
        else if (e.key === 'ArrowRight') { e.preventDefault(); move(-1) }
      }}
    >
      {kinds.map((k) => (
        <button
          key={k}
          role="tab"
          type="button"
          aria-selected={k === selected}
          tabIndex={k === selected ? 0 : -1}
          onClick={() => onSelect(k)}
          className={`-mb-px inline-flex items-center gap-2 border-b-2 px-4 py-3 text-sm font-semibold transition-colors ${
            k === selected
              ? 'border-primary text-foreground'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${DOT[k]}`} />
          {LABELS[k]}
        </button>
      ))}
    </div>
  )
}
