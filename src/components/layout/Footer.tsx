import { useTranslation } from 'react-i18next'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

export default function Footer() {
  const { t } = useTranslation()

  return (
    <footer className="bg-slate-900 py-10 text-sm text-slate-400" dir="rtl">
      <div className="container mx-auto max-w-4xl px-4">
        <div className="flex flex-col items-center gap-2 text-center md:flex-row md:justify-between md:text-right">
          <p className="font-medium text-slate-300">
            {site.partyName}
          </p>
          <p className="text-slate-500">
            {site.cellSubtitle} · {t('ui.rights_reserved')} {new Date().getFullYear()}
          </p>
        </div>
        {site.contactEmail && (
          <div className="mt-4 border-t border-slate-800 pt-4 text-center">
            <a href={`mailto:${site.contactEmail}`} className="transition-colors hover:text-white">
              {site.contactEmail}
            </a>
          </div>
        )}
      </div>
    </footer>
  )
}
