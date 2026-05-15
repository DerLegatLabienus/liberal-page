import { Button } from '@/components/ui/button'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

export default function JoinSection() {
  return (
    <section id="join" className="bg-gradient-to-br from-blue-700 to-sky-600 py-16 text-center text-white">
      <div className="container mx-auto max-w-4xl px-4">
        <h2 className="mb-4 text-2xl font-bold">הצטרפו לליכוד</h2>
        <p className="mx-auto mb-8 max-w-md text-base text-blue-100 leading-relaxed">
          הצטרפו לליכוד ותהיו חלק מהשינוי מבפנים. לחצו על הכפתור להתפקדות באתר הרשמי של הליכוד.
        </p>
        <Button
          render={<a href={site.joinFormUrl || 'https://www.likud.org.il/join'} target="_blank" rel="noopener noreferrer" />}
          size="lg"
          className="bg-white text-blue-700 hover:bg-blue-50 shadow-lg"
        >
          להתפקד עכשיו ←
        </Button>
      </div>
    </section>
  )
}
