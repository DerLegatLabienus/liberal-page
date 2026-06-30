import { useTranslation } from 'react-i18next'
import { useDirection } from '@/hooks/useDirection'
import { onImageError } from '@/lib/image-fallback'
import aboutData from '@/data/about.json'
import type { AboutData } from '@/types'

const about = aboutData as AboutData

export default function AboutSection() {
  const { t, i18n } = useTranslation()
  const direction = useDirection()

  // Brief by design: the lead paragraph only — the rest is restated in the FAQ panel.
  const paragraphs = (t('about.paragraphs', { returnObjects: true }) as string[]).slice(0, 1)
  const values = t('about.values', { returnObjects: true }) as string[]

  return (
    <div dir={direction}>
      <h2 className="mb-8 text-start text-2xl font-bold text-foreground">
        {t('about.heading')}
      </h2>

      <div className="grid gap-12 md:grid-cols-2">
          <div className="space-y-4">
            {paragraphs.map((p, i) => (
              <p key={i} className="text-start leading-relaxed text-muted-foreground">
                {p}
              </p>
            ))}
            <div className="flex flex-wrap gap-2 justify-start pt-2">
              {values.map((value) => (
                <span
                  key={value}
                  className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-medium text-blue-700"
                >
                  {value}
                </span>
              ))}
            </div>
          </div>

          {about.leadership && about.leadership.length > 0 && (
            <div>
              <h3 className="mb-6 text-start text-base font-semibold text-muted-foreground uppercase tracking-wide">
                {t('about.leadership_heading')}
              </h3>
              <div className="space-y-4">
                {about.leadership.map((member) => (
                  <div key={member.name} className="flex items-center gap-4" dir={direction}>
                    <img
                      src={member.image}
                      alt={member.name}
                      className="h-14 w-14 shrink-0 rounded-full object-cover border-2 border-blue-100"
                      onError={onImageError}
                    />
                    <div>
                      <p className="text-start text-sm font-semibold text-foreground">{i18n.language === 'he' ? member.name : (member.nameEn ?? member.name)}</p>
                      <p className="text-start text-xs text-muted-foreground">{i18n.language === 'he' ? member.role : (member.roleEn ?? member.role)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
      </div>
    </div>
  )
}
