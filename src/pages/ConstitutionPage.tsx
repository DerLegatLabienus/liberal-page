import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { CONSTITUTION_CHAPTERS } from '@/data/constitution'
import ConstitutionChapterCard from '@/components/constitution/ConstitutionChapterCard'
import ConstitutionIframe from '@/components/constitution/ConstitutionIframe'
import TranslationDisclaimer from '@/components/constitution/TranslationDisclaimer'

type ConstitutionView = 'original' | 'reader'

export default function ConstitutionPage() {
  const { i18n } = useTranslation()
  const direction = useDirection()
  const lang = i18n.language === 'en' ? 'en' : 'he'
  const [view, setView] = useState<ConstitutionView>('original')

  const labels = {
    title: lang === 'en' ? 'Movement Organizational Structure — Likud' : 'מבנה ארגוני — הליכוד',
    subtitle:
      lang === 'en'
        ? 'A national liberal movement — institutions, powers, and election flow. Charter in force since 1 July 2015.'
        : 'תנועה לאומית ליברלית — מוסדות, סמכויות וזרימת בחירות. חוקת התנועה — תוקף מיום 1 ביולי 2015.',
    rich: lang === 'en' ? 'Rich design' : 'עיצוב מלא',
    reader: lang === 'en' ? 'Reader view' : 'תצוגת קריאה',
  }

  return (
    <div className="min-h-screen bg-background" dir={direction}>
      <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      <main className="container mx-auto max-w-6xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-bold text-foreground">{labels.title}</h1>
        <p className="mb-6 text-sm text-muted-foreground">{labels.subtitle}</p>

        <div className="mb-6 inline-flex rounded-lg border border-border p-1" role="group">
          <button
            type="button"
            onClick={() => setView('original')}
            aria-pressed={view === 'original'}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === 'original' ? 'bg-primary text-white' : 'text-muted-foreground'
            }`}
          >
            {labels.rich}
          </button>
          <button
            type="button"
            onClick={() => setView('reader')}
            aria-pressed={view === 'reader'}
            className={`rounded-md px-3 py-1.5 text-sm font-medium ${
              view === 'reader' ? 'bg-primary text-white' : 'text-muted-foreground'
            }`}
          >
            {labels.reader}
          </button>
        </div>

        {view === 'original' ? (
          <ConstitutionIframe lang={lang} />
        ) : (
          <>
            {lang === 'en' && <TranslationDisclaimer />}
            <div className="grid gap-4 md:grid-cols-2">
              {CONSTITUTION_CHAPTERS.map((ch) => (
                <ConstitutionChapterCard key={ch.key} chapter={ch} lang={lang} />
              ))}
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
