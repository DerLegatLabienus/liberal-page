import { useEffect, useRef, useState } from 'react'
import type { ChannelSend, RecipientSendLink } from '@/types'

export interface ChannelSendButtonProps {
  channel: ChannelSend
  /** Email only — opens the mailto: compose. */
  onPrimary: () => void
  /** Email only — opens the Gmail compose window. */
  onGmail: () => void
  /** Email only — copies the letter body. */
  onCopy: () => void
  /** SMS/WhatsApp only — opens that recipient's deep link. */
  onRecipient: (r: RecipientSendLink) => void
  /** Drives the transient "✓ הועתק" label on the copy menu item. */
  copied: boolean
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('')
}

/**
 * The single send control, identical in shape and position for every channel.
 * Email sends on the primary click and keeps Gmail/copy behind the caret. SMS and
 * WhatsApp have no sensible default recipient, so their primary click opens the same
 * recipient menu the caret would — one button either way.
 */
export default function ChannelSendButton({
  channel, onPrimary, onGmail, onCopy, onRecipient, copied,
}: ChannelSendButtonProps) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const isEmail = channel.kind === 'email'

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const handlePrimary = () => { if (isEmail) onPrimary(); else setOpen((v) => !v) }

  return (
    <div ref={wrap} className="relative inline-flex">
      <button
        ref={trigger}
        type="button"
        onClick={handlePrimary}
        aria-haspopup={isEmail ? undefined : 'menu'}
        aria-expanded={isEmail ? undefined : open}
        className={`inline-flex items-center gap-2 bg-primary px-5 py-2.5 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 ${
          isEmail ? 'rounded-s-lg' : 'rounded-lg'
        }`}
      >
        {isEmail ? 'שליחה במייל' : 'שליחה'}
      </button>

      {isEmail && (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="אפשרויות נוספות"
          aria-haspopup="menu"
          aria-expanded={open}
          className="rounded-e-lg border-s border-primary-foreground/25 bg-primary px-3 text-primary-foreground transition-colors hover:bg-primary/90"
        >
          ▾
        </button>
      )}

      {open && (
        <div
          role="menu"
          className="absolute bottom-[calc(100%+8px)] start-0 z-20 min-w-[240px] rounded-xl border border-border bg-card p-1.5 shadow-lg"
        >
          {isEmail ? (
            <>
              <button
                role="menuitem"
                type="button"
                onClick={() => { onGmail(); setOpen(false) }}
                className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-muted"
              >
                פתיחה ב-Gmail
              </button>
              <button
                role="menuitem"
                type="button"
                onClick={() => onCopy()}
                className="block w-full rounded-lg px-3 py-2 text-start text-sm hover:bg-muted"
              >
                {copied ? '✓ הועתק' : 'העתקת הטקסט'}
              </button>
              {/* The old page explained this up-front to everyone; it belongs here, at the
                  moment it's actually relevant. */}
              <p className="border-t border-border px-3 pb-1 pt-2 text-xs text-muted-foreground">
                אם תוכנת המייל לא נפתחת במחשב — השתמשו ב-Gmail.
              </p>
            </>
          ) : (
            (channel.recipients ?? []).map((r) => (
              <button
                key={r.contactId}
                role="menuitem"
                type="button"
                onClick={() => { onRecipient(r); setOpen(false) }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-start text-sm hover:bg-muted"
              >
                {r.photoUrl ? (
                  <img src={r.photoUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                ) : (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-[10px] font-bold">
                    {initials(r.displayName)}
                  </span>
                )}
                {r.displayName}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
