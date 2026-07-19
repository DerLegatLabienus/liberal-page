import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import LetterPrivacyNotice from '@/components/LetterPrivacyNotice'
import CopyShareLink from '@/components/letters/CopyShareLink'
import { api } from '@/lib/api-client'
import { buildLetterPreviewDoc } from '@/lib/letter-preview'
import { useAuth } from '@/contexts/AuthContext'
import type { LetterDetailResponse, ChannelSend, RecipientSendLink } from '@/types'

const CHANNEL_LABELS: Record<ChannelSend['kind'], string> = {
  email: 'דוא"ל',
  sms: 'SMS',
  whatsapp: 'WhatsApp',
}

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('')
}

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

  const emailChannel = data?.channels.find((c) => c.kind === 'email' && c.enabled)
  const previewHtml = emailChannel?.renderedHtml
  // Rendered through the shared preview shell so an untemplated letter (a bare body
  // fragment) still gets RTL + typography — identical to the composer's live preview.
  const previewDoc = previewHtml ? buildLetterPreviewDoc(previewHtml) : undefined

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

  // Open the rendered letter in a new tab. Uses a Blob URL rather than a data: URL —
  // Chrome and Firefox block top-level navigation to data: URLs. The object URL is
  // revoked after a delay so the opened tab has time to load it.
  const handleOpenInTab = useCallback(() => {
    if (!previewDoc) return
    const blob = new Blob([previewDoc], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [previewDoc])

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

        {data && (
          <div className="grid gap-8 md:grid-cols-[350px_1fr]">
            {/* Send Panel */}
            <div className="rounded-lg border bg-card p-6 shadow-sm">
              {/* Share control lives beside the title, not in the preview panel's action bar —
                  that bar only renders for letters with an email channel, so an SMS/WhatsApp-only
                  letter would otherwise have no way to copy its share link. */}
              <div className="mb-4 flex items-start justify-between gap-2">
                <h1 className="text-xl font-bold">{data.letter.title}</h1>
                {data.letter.shareUrl && (
                  <CopyShareLink
                    url={data.letter.shareUrl}
                    className="shrink-0 whitespace-nowrap text-xs text-primary hover:underline"
                  />
                )}
              </div>

              <div className="space-y-6">
                {data.channels.filter((c) => c.enabled).map((channel) => {
                  // Bind the narrowed kind so the recipient click closures keep the
                  // non-email type (publicSend rejects 'email').
                  const nonEmailKind: 'sms' | 'whatsapp' = channel.kind === 'whatsapp' ? 'whatsapp' : 'sms'
                  return (
                  <section key={channel.kind}>
                    <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
                      {CHANNEL_LABELS[channel.kind]}
                    </h2>

                    {channel.kind === 'email' ? (
                      <div>
                        <button
                          type="button"
                          onClick={() => handleMailto(channel)}
                          className="mb-2 w-full rounded bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
                        >
                          ✉️ שלח ממייל שלי
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGmail(channel)}
                          className="mb-3 w-full rounded border border-border px-4 py-2.5 font-medium hover:bg-muted"
                        >
                          פתח ב-Gmail
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopyHtml(channel)}
                          className="w-full rounded border border-border px-3 py-2 text-sm hover:bg-muted"
                        >
                          {copied ? '✓ הועתק!' : '📋 העתק גוף'}
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {channel.bodyText && (
                          <p className="whitespace-pre-wrap rounded border border-border bg-muted/40 p-3 text-sm">{channel.bodyText}</p>
                        )}
                        {(channel.recipients ?? []).map((r) => (
                          <button
                            key={r.contactId}
                            type="button"
                            onClick={() => handleRecipient(nonEmailKind, r)}
                            className="flex w-full items-center gap-3 rounded border border-border px-3 py-2 text-right hover:bg-muted"
                          >
                            {r.photoUrl ? (
                              <img src={r.photoUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                            ) : (
                              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-medium">
                                {initials(r.displayName)}
                              </span>
                            )}
                            <span className="text-sm font-medium">{r.displayName}</span>
                          </button>
                        ))}
                        {channel.unavailableCount > 0 && (
                          <p className="text-xs text-muted-foreground">
                            {channel.unavailableCount} נמענים אינם זמינים בערוץ זה.
                          </p>
                        )}
                      </div>
                    )}
                  </section>
                  )
                })}
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                &ldquo;שלח ממייל שלי&rdquo; פותח את תוכנת המייל שבמכשיר. במחשב, אם לא נפתח דבר,
                השתמשו ב&rdquo;פתח ב-Gmail&rdquo; לחלון חיבור ישירות בדפדפן.
              </p>

              <LetterPrivacyNotice className="mt-3 border-t border-border pt-3" />
            </div>

            {/* Preview Panel */}
            {previewHtml && (
              <div className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="flex items-center justify-between border-b px-4 py-2">
                  <span className="text-sm font-medium text-muted-foreground">תצוגה מקדימה</span>
                  <button
                    type="button"
                    onClick={handleOpenInTab}
                    className="text-xs text-primary hover:underline"
                  >
                    פתח בלשונית חדשה
                  </button>
                </div>
                <iframe
                  srcDoc={previewDoc}
                  title="תצוגת מכתב"
                  className="h-[600px] w-full border-0"
                  sandbox="allow-same-origin"
                />
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
