import { Button } from '@/components/ui/button'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

interface HeroSectionProps {
  onOpenDrawer: () => void
}

export default function HeroSection({ onOpenDrawer }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden bg-gradient-to-br from-blue-700 via-blue-600 to-sky-600 px-4 py-24 text-center text-white">
      <div className="relative mx-auto max-w-4xl">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-blue-200">
          {site.cellSubtitle}
        </p>
        <h1 className="mb-4 text-4xl font-bold leading-tight md:text-6xl">
          {site.heroHeadline}
        </h1>
        <p className="mx-auto mb-10 max-w-xl text-lg text-blue-100 leading-relaxed">
          {site.heroTagline}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            render={<a href={site.joinFormUrl || '#join'} target="_blank" rel="noopener noreferrer" />}
            size="lg"
            className="bg-white text-blue-700 hover:bg-blue-50 shadow-lg"
          >
            הצטרפו לליכוד ←
          </Button>
          <Button
            variant="outline"
            size="lg"
            onClick={onOpenDrawer}
            className="border-white/50 bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm"
          >
            📊 מעקב כנסת
          </Button>
        </div>
      </div>
    </section>
  )
}
