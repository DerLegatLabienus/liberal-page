import { useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { useTranslation } from 'react-i18next'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useToastOptional } from '@/contexts/ToastContext'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { api, type ActiveMeeting } from '@/lib/api-client'

declare global {
  interface Window { Calendly?: { initPopupWidget: (opts: { url: string }) => void } }
}

const CALENDLY_WIDGET_JS = 'https://assets.calendly.com/assets/external/widget.js'
const CALENDLY_WIDGET_CSS = 'https://assets.calendly.com/assets/external/widget.css'

// Load Calendly's embed assets once, on first use.
let widgetLoading: Promise<void> | null = null
function loadCalendlyWidget(): Promise<void> {
  if (window.Calendly) return Promise.resolve()
  if (widgetLoading) return widgetLoading
  widgetLoading = new Promise((resolve, reject) => {
    const css = document.createElement('link')
    css.rel = 'stylesheet'; css.href = CALENDLY_WIDGET_CSS
    document.head.appendChild(css)
    const s = document.createElement('script')
    s.src = CALENDLY_WIDGET_JS; s.async = true
    s.onload = () => resolve(); s.onerror = () => reject(new Error('calendly widget failed to load'))
    document.head.appendChild(s)
  })
  return widgetLoading
}

/**
 * Outreach section for EXTERNAL visitors (e.g. politicians): verify a Google identity,
 * then book a meeting with the cell via a single-use Calendly link. Hidden for signed-in
 * members (they are the hosts) and when the meetUs flag is off. Stores nothing.
 */
export default function MeetUsSection() {
  const { t } = useTranslation()
  const auth = useAuthOptional()
  const toastCtx = useToastOptional()
  const flags = useFeatureFlags()
  const [existing, setExisting] = useState<ActiveMeeting | null>(null)
  const [booked, setBooked] = useState(false)

  const enabled = flags['meetUs']?.enabled ?? false
  if (!enabled || auth?.user) return null

  const handleVerified = async (idToken: string) => {
    try {
      const { status, body } = await api.meetings.bookingLink(idToken)
      if (status === 200 && body.bookingUrl) {
        try {
          await loadCalendlyWidget()
          const sep = body.bookingUrl.includes('?') ? '&' : '?'
          const url = `${body.bookingUrl}${sep}name=${encodeURIComponent(body.name)}&email=${encodeURIComponent(body.email)}`
          // Confirmation state when Calendly's embed reports the booking.
          const onMessage = (e: MessageEvent) => {
            if (typeof e.origin === 'string' && e.origin.includes('calendly.com')
              && (e.data as { event?: string })?.event === 'calendly.event_scheduled') {
              setBooked(true)
              window.removeEventListener('message', onMessage)
            }
          }
          window.addEventListener('message', onMessage)
          window.Calendly?.initPopupWidget({ url })
        } catch {
          toastCtx?.toast(t('meetus.failed'), 'error')
        }
      } else if (status === 409 && body.meeting) {
        setExisting(body.meeting)
      } else if (status === 429) {
        toastCtx?.toast(t('meetus.rate_limited'), 'error')
      } else {
        toastCtx?.toast(t('meetus.failed'), 'error')
      }
    } catch {
      toastCtx?.toast(t('meetus.failed'), 'error')
    }
  }

  return (
    <section id="meet-us" className="bg-slate-50 py-12">
      <div className="container mx-auto max-w-4xl px-4 text-center">
        <h2 className="mb-2 text-2xl font-bold text-foreground">{t('meetus.title')}</h2>
        <p className="mb-6 text-muted-foreground">{t('meetus.blurb')}</p>

        {booked ? (
          <p className="font-medium text-green-700">{t('meetus.booked')}</p>
        ) : existing ? (
          <div className="space-y-2">
            <p className="font-medium text-foreground">
              {t('meetus.existing', { date: new Date(existing.startTime).toLocaleString() })}
            </p>
            <p className="flex justify-center gap-4 text-sm">
              <a href={existing.cancelUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {t('meetus.cancel')}
              </a>
              <a href={existing.rescheduleUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline">
                {t('meetus.reschedule')}
              </a>
            </p>
            <p className="text-xs text-muted-foreground">{t('meetus.cancel_note')}</p>
          </div>
        ) : (
          <div className="flex justify-center">
            <GoogleLogin
              onSuccess={(cred) => { if (cred.credential) void handleVerified(cred.credential) }}
              onError={() => toastCtx?.toast(t('meetus.failed'), 'error')}
              useOneTap={false}
              shape="pill"
              size="large"
              text="continue_with"
            />
          </div>
        )}
      </div>
    </section>
  )
}
