import { Button } from '@/components/ui/button'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

interface HeroSectionProps {
  onOpenDrawer: () => void
}

export default function HeroSection({ onOpenDrawer }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600 px-4 py-20 text-center text-white">
      <div className="relative mx-auto max-w-2xl">
        <p className="mb-2 text-xs uppercase tracking-widest text-blue-200">
          {site.cellSubtitle}
        </p>
        <h1 className="mb-3 text-4xl font-bold leading-tight md:text-5xl">
          {site.heroHeadline}
        </h1>
        <p className="mb-8 text-lg text-blue-100">{site.heroTagline}</p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            asChild
            size="lg"
            className="bg-white text-blue-700 hover:bg-blue-50"
          >
            <a href={site.joinFormUrl || '#join'} target="_blank" rel="noopener noreferrer">
              הצטרפו לליכוד ←
            </a>
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onOpenDrawer}
            className="border-white/60 bg-white/10 text-white hover:bg-white/20"
          >
            📊 מעקב כנסת
          </Button>
        </div>
      </div>
    </section>
  )
}
