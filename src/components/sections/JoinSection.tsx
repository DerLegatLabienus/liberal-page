import { Button } from '@/components/ui/button'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

export default function JoinSection() {
  return (
    <section id="join" className="bg-gradient-to-br from-blue-700 to-sky-600 py-16 text-center text-white">
      <div className="container mx-auto max-w-lg px-4">
        <h2 className="mb-3 text-2xl font-bold">הצטרפו לליכוד</h2>
        <p className="mb-6 text-blue-100">
          הצטרפו לליכוד ותהיו חלק מהשינוי מבפנים. לחצו על הכפתור להתקפקדות באתר הרשמי של הליכוד.
        </p>
        <Button
          asChild
          size="lg"
          className="bg-white text-blue-700 hover:bg-blue-50"
        >
          <a
            href={site.joinFormUrl || 'https://www.likud.org.il/join'}
            target="_blank"
            rel="noopener noreferrer"
          >
            להתקפקד עכשיו ←
          </a>
        </Button>
      </div>
    </section>
  )
}
