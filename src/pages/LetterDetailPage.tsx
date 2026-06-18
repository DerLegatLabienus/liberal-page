import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import LetterPrivacyNotice from '@/components/LetterPrivacyNotice'
import RecipientEditor from '@/components/letters/RecipientEditor'
import { buildMailtoUrl, buildGmailComposeUrl } from '@/lib/letter-urls'
import { api } from '@/lib/api-client'
import { useAuth } from '@/contexts/AuthContext'
import type { LetterDetailResponse, LetterAddress } from '@/types'

export default function LetterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { user, ready } = useAuth()
  const authed = ready && !!user
  const [data, setData] = useState<LetterDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'html' | 'addresses' | null>(null)
  const [extraTo, setExtraTo] = useState<LetterAddress[]>([])

  // Wait for session restore — the detail endpoint requires auth, so fetching before the
  // access token exists would 401 on a fresh load and flash "letter not found".
  useEffect(() => {
    if (!id || !authed) return
    setLoading(true)
    api.letters.detail(Number(id))
      .then((res) => { setData(res); setExtraTo([]) })
      .catch(() => setError('המכתב לא נמצא'))
      .finally(() => setLoading(false))
  }, [id, authed])

  const searchContacts = useCallback((q: string) => api.letters.contacts(q).then((r) => r.contacts), [])

  const mergedTo: LetterAddress[] = data ? [...data.letter.toAddresses, ...extraTo] : []
  const liveMailto = data
    ? buildMailtoUrl(mergedTo, data.letter.ccAddresses, data.letter.bccAddresses, data.letter.subject, data.letter.bodyPlain)
    : ''
  const liveGmail = data
    ? buildGmailComposeUrl(mergedTo, data.letter.ccAddresses, data.letter.bccAddresses, data.letter.subject, data.letter.bodyPlain)
    : ''

  const handleMailto = useCallback(() => {
    if (!data || !id) return
    // Navigate the current tab to the mailto: — window.open('_blank') leaves a blank tab
    // on desktop when no handler picks it up.
    window.location.href = liveMailto
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [data, id, liveMailto])

  const handleGmail = useCallback(() => {
    if (!data || !id) return
    window.open(liveGmail, '_blank', 'noopener,noreferrer')
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [data, id, liveGmail])

  const handleCopyHtml = useCallback(async () => {
    if (!data || !id) return
    // Copy as rich HTML wrapped in dir="rtl" so pasting into Gmail keeps right-aligned RTL
    // rendering (writeText pasted raw tags / lost direction). Fall back to plain text.
    const rtlHtml = `<div dir="rtl" style="text-align:right">${data.renderedHtml}</div>`
    try {
      if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/html': new Blob([rtlHtml], { type: 'text/html' }),
            'text/plain': new Blob([data.letter.bodyPlain], { type: 'text/plain' }),
          }),
        ])
      } else {
        await navigator.clipboard.writeText(data.letter.bodyPlain)
      }
      setCopied('html')
      setTimeout(() => setCopied(null), 2000)
      api.letters.recordSend(Number(id), 'copy').catch(() => {})
    } catch {
      await navigator.clipboard.writeText(data.letter.bodyPlain)
      setCopied('html')
      setTimeout(() => setCopied(null), 2000)
    }
  }, [data, id])

  const handleCopyAddresses = useCallback(async () => {
    if (!data) return
    const addresses = [...data.letter.toAddresses, ...extraTo].map((a) => a.email).join(', ')
    await navigator.clipboard.writeText(addresses)
    setCopied('addresses')
    setTimeout(() => setCopied(null), 2000)
  }, [data, extraTo])

  // Open the rendered letter in a new tab. Uses a Blob URL rather than a data: URL —
  // Chrome and Firefox block top-level navigation to data: URLs. The object URL is
  // revoked after a delay so the opened tab has time to load it.
  const handleOpenInTab = useCallback(() => {
    if (!data) return
    const blob = new Blob([data.renderedHtml], { type: 'text/html;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener,noreferrer')
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  }, [data])

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
              <h1 className="mb-4 text-xl font-bold">{data.letter.title}</h1>

              <div className="mb-4 space-y-2 text-sm">
                <div>
                  <span className="font-medium text-muted-foreground">נמענים: </span>
                  <RecipientEditor
                    label=""
                    value={extraTo}
                    onChange={setExtraTo}
                    search={searchContacts}
                    allowFreeForm={false}
                    lockedValue={data.letter.toAddresses}
                  />
                  <p className="mt-1 text-xs text-muted-foreground">ניתן להוסיף נמענים מספר הכתובות בלבד.</p>
                </div>
                {data.letter.ccAddresses.length > 0 && (
                  <div>
                    <span className="font-medium text-muted-foreground">CC: </span>
                    {data.letter.ccAddresses.map((a) => a.display_name).join(', ')}
                  </div>
                )}
                <div>
                  <span className="font-medium text-muted-foreground">נושא: </span>
                  {data.letter.subject}
                </div>
              </div>

              <button
                type="button"
                onClick={handleMailto}
                className="mb-2 w-full rounded bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                ✉️ שלח ממייל שלי
              </button>

              <button
                type="button"
                onClick={handleGmail}
                className="mb-3 w-full rounded border border-border px-4 py-2.5 font-medium hover:bg-muted"
              >
                פתח ב-Gmail
              </button>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={handleCopyHtml}
                  className="rounded border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  {copied === 'html' ? '✓ הועתק!' : '📋 העתק גוף'}
                </button>
                <button
                  type="button"
                  onClick={handleCopyAddresses}
                  className="rounded border border-border px-3 py-2 text-sm hover:bg-muted"
                >
                  {copied === 'addresses' ? '✓ הועתק!' : '📋 העתק כתובות'}
                </button>
              </div>

              <p className="mt-4 text-xs text-muted-foreground">
                &ldquo;שלח ממייל שלי&rdquo; פותח את תוכנת המייל שבמכשיר. במחשב, אם לא נפתח דבר,
                השתמשו ב&rdquo;פתח ב-Gmail&rdquo; לחלון חיבור ישירות בדפדפן.
              </p>

              <LetterPrivacyNotice className="mt-3 border-t border-border pt-3" />
            </div>

            {/* Preview Panel */}
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
                srcDoc={data.renderedHtml}
                title="תצוגת מכתב"
                className="h-[600px] w-full border-0"
                sandbox="allow-same-origin"
              />
            </div>
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
