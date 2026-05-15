import { useState } from 'react'
import { Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useDirection } from '@/hooks/useDirection'
import siteData from '@/data/site.json'
import type { SiteConfig } from '@/types'

const site = siteData as SiteConfig

interface HeaderProps {
  hasNewParliamentData: boolean
  onOpenDrawer: () => void
}

const NAV_LINKS = [
  { label: 'אודות', href: '#about' },
  { label: 'גלריה', href: '#gallery' },
  { label: 'שאלות', href: '#faq' },
  { label: 'הצטרפו', href: '#join' },
]

export default function Header({ hasNewParliamentData, onOpenDrawer }: HeaderProps) {
  const direction = useDirection()
  const [mobileOpen, setMobileOpen] = useState(false)

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="container mx-auto flex h-14 items-center justify-between px-4">
        <div className="flex items-center gap-2">
          {site.logoPath ? (
            <img
              src={site.logoPath}
              alt={site.partyName}
              className="h-8 w-auto object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none' }}
            />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">
              ל"ל
            </div>
          )}
          <span className="font-bold text-foreground">{site.partyName}</span>
        </div>

        <nav className="hidden items-center gap-6 md:flex">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </a>
          ))}
          <div className="relative">
            <Button onClick={onOpenDrawer} className="gap-2" variant="default" size="sm">
              <span>📊 מעקב כנסת</span>
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
          aria-label="תפריט"
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
            <Button
              onClick={() => { onOpenDrawer(); setMobileOpen(false) }}
              size="sm"
              className="w-full"
            >
              📊 מעקב כנסת
            </Button>
          </nav>
        </div>
      )}
    </header>
  )
}
