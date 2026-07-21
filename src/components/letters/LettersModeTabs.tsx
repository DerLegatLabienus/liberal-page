import { Link, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'
import { canManageLetters } from '@/lib/permissions'

const TABS = [
  { to: '/letters', label: 'צפייה' },
  { to: '/letters/manage', label: 'ניהול' },
]

/**
 * View ⇄ Manage switch that makes /letters and /letters/manage read as one Letters section.
 * Rendered on both pages but only for users who may manage letters — members never see it.
 */
export default function LettersModeTabs({ className }: { className?: string }) {
  const { user } = useAuth()
  const { pathname } = useLocation()
  if (!canManageLetters(user)) return null

  return (
    <div className={`flex gap-2 border-b border-border ${className ?? ''}`}>
      {TABS.map((t) => {
        const active = pathname === t.to
        return (
          <Link
            key={t.to}
            to={t.to}
            className={`px-4 py-2 text-sm font-medium transition-colors ${
              active ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </Link>
        )
      })}
    </div>
  )
}
