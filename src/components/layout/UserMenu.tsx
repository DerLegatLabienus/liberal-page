import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { ChevronDown, LogOut } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useToastOptional } from '@/contexts/ToastContext'
import { api } from '@/lib/api-client'
import type { AuthUser } from '@/lib/api-client'

// Admin-only and heavy — lazy so non-admins never pay for it (mirrors the old AuthControl import).
const AdminPanel = lazy(() => import('@/components/admin/AdminPanel'))

function initials(name: string): string {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0] ?? '').join('') || '?'
}

export interface UserMenuProps {
  user: AuthUser
  onSignOut: () => void
  onUpdateUser: (patch: Partial<AuthUser>) => void
}

/**
 * The signed-in account control: an outline trigger (avatar + name) opening a dropdown that holds
 * everything that used to sprawl across the header — a display-name rename, the email-alerts
 * toggle, the admin panel, and sign-out. Same lightweight menu mechanics as ChannelSendButton
 * (outside-click + Escape), no extra dependency.
 */
export default function UserMenu({ user, onSignOut, onUpdateUser }: UserMenuProps) {
  const { t } = useTranslation()
  const toastCtx = useToastOptional()
  const [open, setOpen] = useState(false)
  const [adminOpen, setAdminOpen] = useState(false)
  const [name, setName] = useState(user.name ?? '')
  const [savingName, setSavingName] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        // Button is not a forwardRef (React 18), so refocus the trigger via the wrapper.
        wrap.current?.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')?.focus()
      }
    }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label = user.name ?? user.email ?? ''

  const saveName = async () => {
    const trimmed = name.trim()
    if (!trimmed || trimmed === (user.name ?? '') || savingName) return
    setSavingName(true)
    try {
      const res = await api.auth.updateMe({ name: trimmed })
      onUpdateUser({ name: res.user.name })
      toastCtx?.toast(t('auth.name_saved'), 'success')
    } catch {
      toastCtx?.toast(t('auth.name_save_failed'), 'error')
    } finally {
      setSavingName(false)
    }
  }

  const toggleAlerts = async (next: boolean) => {
    try {
      const res = await api.auth.updateMe({ emailAlerts: next })
      onUpdateUser({ emailAlerts: res.user.emailAlerts })
      toastCtx?.toast(t('auth.preferences_saved'), 'success')
    } catch {
      toastCtx?.toast(t('auth.preferences_failed'), 'error')
    }
  }

  return (
    <div ref={wrap} className="relative inline-flex">
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('auth.account_menu')}
      >
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
          {initials(label)}
        </span>
        <span className="max-w-[10rem] truncate">{label}</span>
        <ChevronDown className="h-3.5 w-3.5 opacity-60" />
      </Button>

      {open && (
        <div
          role="menu"
          className="absolute top-[calc(100%+8px)] end-0 z-30 w-64 rounded-xl border border-border bg-card p-1.5 text-start shadow-lg"
        >
          <div className="px-3 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-foreground">{user.name ?? user.email}</p>
            {user.email && <p className="truncate text-xs text-muted-foreground">{user.email}</p>}
          </div>

          <div className="border-t border-border px-3 py-2.5">
            <label htmlFor="user-menu-name" className="mb-1 block text-xs font-medium text-muted-foreground">
              {t('auth.display_name')}
            </label>
            <div className="flex items-center gap-1.5">
              <Input
                id="user-menu-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void saveName() } }}
                maxLength={80}
                className="h-8 flex-1"
              />
              <Button
                size="sm"
                onClick={() => void saveName()}
                disabled={savingName || !name.trim() || name.trim() === (user.name ?? '')}
              >
                {t('auth.save_name')}
              </Button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 border-t border-border px-3 py-2.5 text-sm text-foreground hover:bg-muted">
            <input
              type="checkbox"
              aria-label={t('auth.email_alerts')}
              checked={user.emailAlerts}
              onChange={(e) => void toggleAlerts(e.target.checked)}
            />
            {t('auth.email_alerts')}
          </label>

          {user.role === 'admin' && (
            <button
              role="menuitem"
              type="button"
              onClick={() => { setAdminOpen(true); setOpen(false) }}
              className="block w-full rounded-lg px-3 py-2 text-start text-sm text-foreground hover:bg-muted"
            >
              {t('admin.title')}
            </button>
          )}

          <button
            role="menuitem"
            type="button"
            onClick={() => { setOpen(false); onSignOut() }}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-border px-3 py-2 text-start text-sm text-foreground hover:bg-muted"
          >
            <LogOut className="h-4 w-4 opacity-70" />
            {t('auth.sign_out')}
          </button>
        </div>
      )}

      {adminOpen && (
        <Suspense fallback={null}>
          <AdminPanel open onClose={() => setAdminOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}
