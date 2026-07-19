import type { ChannelSend } from '@/types'
import { buildLetterPreviewDoc } from '@/lib/letter-preview'

/**
 * One framed surface that changes form by channel: a letter sheet for email, a chat
 * bubble for SMS/WhatsApp. Keeping both in the same frame at the same position is what
 * makes switching tabs read as one object changing shape rather than three screens.
 */
export default function ChannelMessage({ channel }: { channel: ChannelSend }) {
  if (channel.kind === 'email') {
    return (
      <iframe
        srcDoc={buildLetterPreviewDoc(channel.renderedHtml ?? '')}
        title="תצוגת מכתב"
        className="h-[420px] w-full rounded-xl border border-border bg-background"
        sandbox="allow-same-origin"
      />
    )
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <p
        className={`max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border bg-muted/30 px-4 py-3 text-sm leading-relaxed ${
          channel.kind === 'whatsapp' ? 'border-emerald-500/40' : 'border-border'
        }`}
      >
        {channel.bodyText}
      </p>
    </div>
  )
}
