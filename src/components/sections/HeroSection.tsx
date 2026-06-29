import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export default function HeroSection() {
  const { t } = useTranslation()

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600 px-4 py-16 text-center text-white">
      <div className="relative mx-auto max-w-4xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-blue-200">
          {t('site.cell_subtitle')}
        </p>
        <h1 className="mb-4 text-4xl font-bold leading-tight md:text-6xl">
          {t('hero.headline')}
        </h1>
        <p className="mx-auto mb-8 max-w-xl text-lg leading-relaxed text-blue-100">
          {t('hero.tagline')}
        </p>
        <div className="flex flex-col items-center gap-4">
          <a
            href="#join"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-white text-blue-700 shadow-lg hover:bg-blue-50'
            )}
          >
            {t('hero.cta_join')}
          </a>
          <Link
            to="/constitution"
            className="text-sm text-blue-100 underline-offset-4 hover:text-white hover:underline"
          >
            📜 {t('hero.cta_constitution')}
          </Link>
        </div>
      </div>
    </section>
  )
}
