import { useTranslation } from 'react-i18next'
import { Button, buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

interface HeroSectionProps {
  onOpenDrawer: () => void
  trackerEnabled?: boolean
}

export default function HeroSection({ onOpenDrawer, trackerEnabled = true }: HeroSectionProps) {
  const { t } = useTranslation()

  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600 px-4 py-24 text-center text-white">
      <div className="relative mx-auto max-w-4xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-blue-200">
          {site.cellSubtitle}
        </p>
        <h1 className="mb-4 text-4xl font-bold leading-tight md:text-6xl">
          {t('hero.headline')}
        </h1>
        <p className="mx-auto mb-10 max-w-xl text-lg text-blue-100 leading-relaxed">
          {t('hero.tagline')}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <a
            href="#join"
            className={cn(
              buttonVariants({ size: 'lg' }),
              'bg-white text-blue-700 hover:bg-blue-50 shadow-lg'
            )}
          >
            {t('hero.cta_join')}
          </a>
          {trackerEnabled && (
            <Button
              variant="outline"
              size="lg"
              onClick={onOpenDrawer}
              className="border-white/50 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
            >
              {t('hero.cta_tracker')}
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
