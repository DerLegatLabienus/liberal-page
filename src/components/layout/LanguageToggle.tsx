import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * Compact bordered language toggle. `ui.lang_toggle` already holds the *target* language label
 * (he.json → "EN", en.json → "עב"), so clicking flips to that language and mirrors direction.
 */
export default function LanguageToggle({ className, onToggle }: { className?: string; onToggle?: () => void }) {
  const { t, i18n } = useTranslation()

  const toggle = () => {
    const next = i18n.language === 'he' ? 'en' : 'he'
    i18n.changeLanguage(next)
    document.documentElement.lang = next
    document.documentElement.dir = next === 'he' ? 'rtl' : 'ltr'
    localStorage.setItem('lang', next)
    history.replaceState(null, '', `?lang=${next}`)
    onToggle?.()
  }

  return (
    <Button variant="outline" size="sm" onClick={toggle} className={className}>
      <Globe className="h-3.5 w-3.5" />
      {t('ui.lang_toggle')}
    </Button>
  )
}
