import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import { useMkList } from '@/hooks/useMkList'
import MkActivityCard from '@/components/parliament/MkActivityCard'

export default function LiberalsShowcase() {
  const { t } = useTranslation()
  const direction = useDirection()
  const { mks } = useMkList()

  const annotated = mks.filter((m) => m.isLiberal || m.isSupporter)
  if (!annotated.length) return null

  return (
    <section id="liberals" className="bg-slate-50 py-16" dir={direction}>
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-8 text-start text-2xl font-bold text-foreground">
          {t('showcase.heading')}
        </h2>
        <div className="grid gap-4 md:grid-cols-2">
          {annotated.map((mk) => (
            <MkActivityCard key={mk.siteId} member={mk} />
          ))}
        </div>
      </div>
    </section>
  )
}
