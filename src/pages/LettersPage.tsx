import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { api } from '@/lib/api-client'
import LetterPrivacyNotice from '@/components/LetterPrivacyNotice'
import { useFeatureFlags } from '@/hooks/useFeatureFlags'
import { useAuth } from '@/contexts/AuthContext'
import type { Letter, LetterIssueTag } from '@/types'

const PRIORITY_LABELS: Record<string, string> = { urgent: 'דחוף', high: 'גבוה', normal: '' }

export default function LettersPage() {
  const flags = useFeatureFlags()
  const { user, ready } = useAuth()
  const authed = ready && !!user
  const [letters, setLetters] = useState<Letter[]>([])
  const [tags, setTags] = useState<LetterIssueTag[]>([])
  const [selectedTags, setSelectedTags] = useState<number[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!authed) return
    api.letters.tags().then((r) => setTags(r.tags)).catch(() => {})
  }, [authed])

  // Only fetch once the session is restored — these endpoints require auth, so firing
  // before the access token exists would 401 on a fresh page load / deep link.
  useEffect(() => {
    if (!authed) return
    setLoading(true)
    api.letters.list(selectedTags.length ? selectedTags : undefined)
      .then((r) => setLetters(r.letters))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [selectedTags, authed])

  // Wait for session restore before deciding access, otherwise a fresh load flashes the
  // "members only" message while the refresh token is still being exchanged.
  if (!ready) {
    return (
      <div className="min-h-screen bg-background">
        <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
        <main className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">טוען…</p>
        </main>
        <Footer />
      </div>
    )
  }

  if (!flags?.lettersEnabled?.enabled || !user) {
    return (
      <div className="min-h-screen bg-background">
        <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
        <main className="flex min-h-[60vh] items-center justify-center">
          <p className="text-muted-foreground">הגישה לדף זה מוגבלת לחברים מורשים.</p>
        </main>
        <Footer />
      </div>
    )
  }

  const toggleTag = (id: number) =>
    setSelectedTags((prev) => prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id])

  return (
    <div className="min-h-screen bg-background">
      <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      <main className="mx-auto max-w-5xl px-4 py-10" dir="rtl">
        <h1 className="mb-2 text-2xl font-bold">מכתבים לנבחרי ציבור</h1>
        <LetterPrivacyNotice className="mb-6" />

        {tags.length > 0 && (
          <div className="mb-6 flex flex-wrap gap-2">
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggleTag(tag.id)}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${
                  selectedTags.includes(tag.id)
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-border bg-background text-foreground hover:bg-muted'
                }`}
              >
                {tag.name}
              </button>
            ))}
            {selectedTags.length > 0 && (
              <button type="button" onClick={() => setSelectedTags([])} className="text-sm text-muted-foreground underline">
                נקה סינון
              </button>
            )}
          </div>
        )}

        {loading && <p className="text-muted-foreground">טוען מכתבים...</p>}

        {!loading && letters.length === 0 && (
          <p className="text-muted-foreground">אין מכתבים זמינים כרגע.</p>
        )}

        <div className="space-y-4">
          {letters.map((letter) => (
            <div
              key={letter.id}
              className={`rounded-lg border bg-card p-5 shadow-sm ${letter.pinnedAt ? 'border-primary/50' : ''}`}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <div>
                  {letter.pinnedAt && (
                    <span className="mb-1 inline-block text-xs text-primary">📌 ממוקד</span>
                  )}
                  <h2 className="text-lg font-semibold">{letter.title}</h2>
                </div>
                <div className="flex items-center gap-2">
                  {PRIORITY_LABELS[letter.priority] && (
                    <span className="rounded bg-orange-100 px-2 py-0.5 text-xs text-orange-700">
                      {PRIORITY_LABELS[letter.priority]}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">{letter.activityScore} שליחות</span>
                </div>
              </div>

              {letter.issueTagIds.length > 0 && (
                <div className="mb-3 flex flex-wrap gap-1">
                  {letter.issueTagIds.map((tagId) => {
                    const tag = tags.find((t) => t.id === tagId)
                    return tag ? (
                      <span key={tagId} className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                        {tag.name}
                      </span>
                    ) : null
                  })}
                </div>
              )}

              <Link
                to={`/letters/${letter.id}`}
                className="inline-block rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                פתח מכתב
              </Link>
            </div>
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
