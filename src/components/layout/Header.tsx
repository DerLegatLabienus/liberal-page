import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Menu } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useDirection } from '@/hooks/useDirection'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

interface HeaderProps {
  hasNewParliamentData: boolean
  onOpenDrawer: () => void
  trackerEnabled: boolean
}

export default function Header({ hasNewParliamentData, onOpenDrawer, trackerEnabled }: HeaderProps) {
  const { t, i18n } = useTranslation()
  const direction = useDirection()
  const [mobileOpen, setMobileOpen] = useState(false)
  const isHome = useLocation().pathname === '/'

  // On the homepage, hash anchors scroll in-page; off-route they point back to
  // the homepage (with the section hash) so the link still works and returns home.
  const navHref = (hash: string) => (isHome ? hash : `${import.meta.env.BASE_URL}${hash}`)

  const NAV_LINKS = [
    { label: t('ui.nav_about'), href: '#about' },
    { label: t('ui.nav_gallery'), href: '#gallery' },
    { label: t('ui.nav_faq'), href: '#faq' },
    { label: t('ui.nav_join'), href: '#join' },
  ]

  const toggleLang = () => {
    const next = i18n.language === 'he' ? 'en' : 'he'
    i18n.changeLanguage(next)
    document.documentElement.lang = next
    document.documentElement.dir = next === 'he' ? 'rtl' : 'ltr'
    localStorage.setItem('lang', next)
    history.replaceState(null, '', `?lang=${next}`)
  }

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
        <Link to="/" className="flex items-center gap-2" aria-label={t('site.party_name')}>
          {site.logoPath ? (
            <img
              src={site.logoPath}
              alt={site.partyName}
              className="h-8 w-auto object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              {t('site.logo_initials')}
            </div>
          )}
          <span className="font-bold text-foreground">{t('site.party_name')}</span>
        </Link>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={navHref(link.href)}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <button
            onClick={toggleLang}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {t('ui.lang_toggle')}
          </button>
          <div className="relative">
            <Button
              onClick={trackerEnabled ? onOpenDrawer : undefined}
              className="gap-2"
              variant="default"
              size="sm"
              disabled={!trackerEnabled}
              title={trackerEnabled ? undefined : 'Available in Hebrew'}
            >
              <span>{t('ui.nav_tracker')}</span>
              <Menu className={`h-4 w-4 ${direction === 'ltr' ? 'scale-x-[-1]' : ''}`} />
            </Button>
            {hasNewParliamentData && (
              <span className="absolute -top-1 ltr:-right-1 rtl:-left-1 h-2.5 w-2.5 rounded-full bg-blue-400 ring-2 ring-white" />
            )}
          </div>
        </nav>

        <button
          className="flex items-center md:hidden"
          onClick={() => setMobileOpen((v) => !v)}
          aria-label={t('ui.menu')}
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {mobileOpen && (
        <div className="border-t border-border bg-white px-4 py-3 md:hidden">
          <nav className="flex flex-col gap-3">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-muted-foreground"
                onClick={() => setMobileOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <button
              onClick={() => { toggleLang(); setMobileOpen(false) }}
              className="text-start text-sm text-muted-foreground"
            >
              {t('ui.lang_toggle')}
            </button>
            <Button
              onClick={() => { if (trackerEnabled) { onOpenDrawer(); setMobileOpen(false) } }}
              size="sm"
              className="w-full"
              disabled={!trackerEnabled}
              title={trackerEnabled ? undefined : 'Available in Hebrew'}
            >
              {t('ui.nav_tracker')}
            </Button>
          </nav>
        </div>
      )}
    </header>
  )
}
