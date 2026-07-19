import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import LetterPrivacyNotice from '@/components/LetterPrivacyNotice'
import CopyShareLink from '@/components/letters/CopyShareLink'
import ChannelTabs from '@/components/letters/ChannelTabs'
import ChannelMessage from '@/components/letters/ChannelMessage'
import ChannelSendButton from '@/components/letters/ChannelSendButton'
import { api } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import type { LetterDetailResponse, ChannelSend, RecipientSendLink, ChannelKind } from '@/types'

export default function LetterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, ready } = useAuth()
  const authed = ready && !!user
  const [data, setData] = useState<LetterDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Wait for session restore — the detail endpoint requires auth, so fetching before the
  // access token exists would 401 on a fresh load and flash "letter not found".
  useEffect(() => {
    if (!id || !authed) return
    setLoading(true)
    api.letters.detail(Number(id))
      .then((res) => setData(res))
      .catch(() => setError('המכתב לא נמצא'))
      .finally(() => setLoading(false))
  }, [id, authed])

  // Tabs show one channel at a time. Default to email when the letter has one (it's the
  // richest surface), otherwise the first enabled channel — so an SMS-only letter opens
  // straight onto its message instead of an empty pane.
  const [tab, setTab] = useState<ChannelKind | null>(null)
  const enabled = data ? data.channels.filter((c) => c.enabled) : []
  const kinds = enabled.map((c) => c.kind)
  const active = enabled.find((c) => c.kind === tab)
    ?? enabled.find((c) => c.kind === 'email')
    ?? enabled[0]

  const handleMailto = useCallback((channel: ChannelSend) => {
    if (!id || !channel.mailtoUrl) return
    // Navigate the current tab to the mailto: — window.open('_blank') leaves a blank tab
    // on desktop when no handler picks it up.
    window.location.href = channel.mailtoUrl
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [id])

  const handleGmail = useCallback((channel: ChannelSend) => {
    if (!id || !channel.gmailUrl) return
    window.open(channel.gmailUrl, '_blank', 'noopener,noreferrer')
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [id])

  const handleCopyHtml = useCallback(async (channel: ChannelSend) => {
    if (!id) return
    // Copy as rich HTML wrapped in dir="rtl" so pasting into Gmail keeps right-aligned RTL
    // rendering (writeText pasted raw tags / lost direction). Fall back to plain text.
    const rtlHtml = `<div dir="rtl" style="text-align:right">${channel.renderedHtml ?? ''}</div>`
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([rtlHtml], { type: 'text/html' }),
            'text/plain': new Blob([channel.bodyText], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(channel.bodyText)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      api.letters.recordSend(Number(id), 'copy').catch(() => {})
    } catch {
      await navigator.clipboard.writeText(channel.bodyText)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [id])

  const handleRecipient = useCallback((kind: 'sms' | 'whatsapp', r: RecipientSendLink) => {
    if (kind === 'whatsapp') {
      window.open(r.url, '_blank', 'noopener,noreferrer')
    } else {
      // sms: — navigate the current tab so the device's messaging app takes over.
      window.location.href = r.url
    }
    api.letters.publicSend(Number(id), kind, r.contactId).catch(() => {})
  }, [id])

  return (
    <div className="min-h-screen bg-background">
      <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      <main className="mx-auto max-w-6xl px-4 py-10" dir="rtl">
        <Link to="/letters" className="mb-6 inline-block text-sm text-muted-foreground hover:underline">
          ← חזרה למכתבים
        </Link>

        {ready && !user && <p className="text-muted-foreground">הגישה לדף זה מוגבלת לחברים מורשים.</p>}
        {(!ready || (authed && loading)) && <p className="text-muted-foreground">טוען...</p>}
        {authed && error && <p className="text-destructive">{error}</p>}

        {data && active && (
          <div className="mx-auto max-w-3xl overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-start justify-between gap-3 px-5 pb-4 pt-5">
              <h1 className="text-xl font-bold">{data.letter.title}</h1>
              {data.letter.shareUrl && (
                <CopyShareLink
                  url={data.letter.shareUrl}
                  className="shrink-0 whitespace-nowrap rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                />
              )}
            </div>

            <ChannelTabs kinds={kinds} selected={active.kind} onSelect={setTab} />

            <div className="px-5 py-5">
              <ChannelMessage channel={active} />
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-4">
              <ChannelSendButton
                channel={active}
                copied={copied}
                onPrimary={() => handleMailto(active)}
                onGmail={() => handleGmail(active)}
                onCopy={() => handleCopyHtml(active)}
                onRecipient={(r) => handleRecipient(active.kind === 'whatsapp' ? 'whatsapp' : 'sms', r)}
              />
              {active.unavailableCount > 0 && (
                <p className="text-xs text-amber-700">
                  {active.unavailableCount} נמענים אינם זמינים בערוץ זה.
                </p>
              )}
            </div>
          </div>
        )}

        {data && <LetterPrivacyNotice className="mx-auto mt-4 max-w-3xl" />}
      </main>
      <Footer />
    </div>
  )
}
