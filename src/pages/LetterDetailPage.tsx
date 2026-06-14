import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { api } from '@/lib/api-client'
import type { LetterDetailResponse } from '@/types'

export default function LetterDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [data, setData] = useState<LetterDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState<'html' | 'addresses' | null>(null)

  useEffect(() => {
    if (!id) return
    setLoading(true)
    api.letters.detail(Number(id))
      .then(setData)
      .catch(() => setError('המכתב לא נמצא'))
      .finally(() => setLoading(false))
  }, [id])

  const handleMailto = useCallback(() => {
    if (!data || !id) return
    window.open(data.mailtoUrl, '_blank')
    api.letters.recordSend(Number(id), 'mailto').catch(() => {})
  }, [data, id])

  const handleCopyHtml = useCallback(async () => {
    if (!data || !id) return
    await navigator.clipboard.writeText(data.renderedHtml)
    setCopied('html')
    setTimeout(() => setCopied(null), 2000)
    api.letters.recordSend(Number(id), 'copy').catch(() => {})
  }, [data, id])

  const handleCopyAddresses = useCallback(async () => {
    if (!data) return
    const addresses = data.letter.toAddresses.map((a) => a.email).join(', ')
    await navigator.clipboard.writeText(addresses)
    setCopied('addresses')
    setTimeout(() => setCopied(null), 2000)
  }, [data])

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

        {loading && <p className="text-muted-foreground">טוען...</p>}
        {error && <p className="text-destructive">{error}</p>}

        {data && (
          <div className="grid gap-8 md:grid-cols-[350px_1fr]">
            {/* Send Panel */}
            <div className="rounded-lg border bg-card p-6 shadow-sm">
              <h1 className="mb-4 text-xl font-bold">{data.letter.title}</h1>

              <div className="mb-4 space-y-2 text-sm">
                <div>
                  <span className="font-medium text-muted-foreground">נמענים: </span>
                  {data.letter.toAddresses.map((a) => a.display_name).join(', ')}
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
                className="mb-3 w-full rounded bg-primary px-4 py-2.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                ✉️ שלח ממייל שלי
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
                &ldquo;שלח ממייל שלי&rdquo; פותח את תוכנת המייל שלך עם הפרטים ממולאים מראש.
              </p>
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
