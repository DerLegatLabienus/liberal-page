import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

export default function Footer() {
  return (
    <footer className="border-t border-border bg-slate-900 py-6 text-center text-sm text-slate-400">
      <p>
        {site.partyName} · {site.cellSubtitle} · כל הזכויות שמורות {new Date().getFullYear()}
      </p>
      {site.contactEmail && (
        <p className="mt-1">
          <a href={`mailto:${site.contactEmail}`} className="transition-colors hover:text-white">
            {site.contactEmail}
          </a>
        </p>
      )}
    </footer>
  )
}
