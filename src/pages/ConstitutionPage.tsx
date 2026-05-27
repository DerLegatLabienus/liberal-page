import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import Header from '@/components/layout/Header'
import Footer from '@/components/layout/Footer'
import { CONSTITUTION_CHAPTERS } from '@/data/constitution'
import ConstitutionChapterCard from '@/components/constitution/ConstitutionChapterCard'
import TranslationDisclaimer from '@/components/constitution/TranslationDisclaimer'

export default function ConstitutionPage() {
  const { i18n } = useTranslation()
  const direction = useDirection()
  const lang = i18n.language === 'en' ? 'en' : 'he'

  return (
    <div className="min-h-screen bg-background" dir={direction}>
      <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      <main className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="mb-2 text-3xl font-bold text-foreground">
          {lang === 'en' ? 'Movement Organizational Structure — Likud' : 'מבנה ארגוני — הליכוד'}
        </h1>
        <p className="mb-6 text-sm text-muted-foreground">
          {lang === 'en'
            ? 'A national liberal movement — institutions, powers, and election flow. Charter in force since 1 July 2015.'
            : 'תנועה לאומית ליברלית — מוסדות, סמכויות וזרימת בחירות. חוקת התנועה — תוקף מיום 1 ביולי 2015.'}
        </p>
        {lang === 'en' && <TranslationDisclaimer />}
        <div className="grid gap-4 md:grid-cols-2">
          {CONSTITUTION_CHAPTERS.map((ch) => (
            <ConstitutionChapterCard key={ch.key} chapter={ch} lang={lang} />
          ))}
        </div>
      </main>
      <Footer />
    </div>
  )
}
