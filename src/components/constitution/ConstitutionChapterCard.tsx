import { useState } from 'react'
import type { ConstitutionChapter, ConstitutionColor } from '@/data/constitution'
import ChapterPdfLink from './ChapterPdfLink'

const ACCENT: Record<ConstitutionColor, string> = {
  blue: 'border-s-4 border-blue-500',
  gold: 'border-s-4 border-amber-600',
  teal: 'border-s-4 border-teal-600',
  red: 'border-s-4 border-red-600',
  green: 'border-s-4 border-green-600',
  purple: 'border-s-4 border-violet-600',
  orange: 'border-s-4 border-orange-600',
  navy: 'border-s-4 border-indigo-800',
}

export default function ConstitutionChapterCard({
  chapter,
  lang,
}: {
  chapter: ConstitutionChapter
  lang: 'he' | 'en'
}) {
  const [open, setOpen] = useState(false)
  const c = lang === 'en' ? chapter.en : chapter.he
  return (
    <section className={`rounded-xl border border-border bg-card p-5 ${ACCENT[chapter.color]}`}>
      <h3 className="mb-1 text-lg font-bold text-foreground">{c.title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{c.summary}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-3 text-xs font-semibold text-primary"
      >
        {open
          ? lang === 'en' ? 'Hide details' : 'הסתר פרטים'
          : lang === 'en' ? 'Show details' : 'הצג פרטים'}
      </button>
      {open && (
        <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
          {c.bullets.map((b, i) => (
            <li key={i} className="leading-relaxed">• {b}</li>
          ))}
        </ul>
      )}
      <ChapterPdfLink page={chapter.pdfPage} lang={lang} />
    </section>
  )
}
