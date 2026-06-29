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
    <div dir={direction}>
      <h3 className="mb-6 text-start text-lg font-semibold text-foreground">
        {t('showcase.heading')}
      </h3>
      <div className="grid gap-4 md:grid-cols-2">
        {annotated.map((mk) => (
          <MkActivityCard key={mk.siteId} member={mk} />
        ))}
      </div>
    </div>
  )
}
