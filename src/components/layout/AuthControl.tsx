import { useState, lazy, Suspense } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { useTranslation } from 'react-i18next'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useToastOptional } from '@/contexts/ToastContext'
import { useDirection } from '@/hooks/useDirection'
import { api, errorStatus } from '@/lib/api-client'

// Admin-only and heavy (tabs, accordion, analytics) — lazy-loaded so the ~99% of visitors who
// never open it (and every non-admin) don't pay for it in the main bundle.
const AdminPanel = lazy(() => import('@/components/admin/AdminPanel'))

// Microsoft (MSAL) sign-in is intentionally NOT offered. Under Entra `common` a token's
// `email` claim is attacker-settable, so a nOAuth-safe Microsoft flow requires the app
// registration to emit the `xms_edov` optional claim — configuration we don't maintain.
// Rather than ship a login that either half-works or is unsafe, the button is removed and the
// server rejects the `microsoft` provider. The verified-ownership adapter
// (`server/services/auth-providers/microsoft.ts`) is kept dormant as the blueprint for
// re-enabling once `xms_edov` is configured. See the multi-provider-login design doc.

/**
 * Header auth control: Google sign-in button when logged out; name + sign-out when in.
 * The GIS button only functions when VITE_GOOGLE_CLIENT_ID is configured. Renders nothing
 * outside an AuthProvider (e.g. isolated Header unit tests) or before session restore.
 */
export default function AuthControl() {
  const { t } = useTranslation()
  const dir = useDirection()
  const auth = useAuthOptional()
  const toastCtx = useToastOptional()
  const [adminOpen, setAdminOpen] = useState(false)
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSending, setMagicSending] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  if (!auth || !auth.ready) return null
  const { user, signIn, signOut, updateUser } = auth

  const handleSignIn = (idToken: string) => {
    signIn(idToken)
      .then(() => toastCtx?.toast(t('auth.signed_in'), 'success'))
      .catch((err: unknown) => {
        // 403 = email not on the invite allowlist; anything else = generic failure.
        const msg = errorStatus(err) === 403 ? t('auth.not_invited') : t('auth.sign_in_failed')
        toastCtx?.toast(msg, 'error')
      })
  }

  const handleMagicLinkRequest = async () => {
    const email = magicEmail.trim()
    if (!email || magicSending) return
    setMagicSending(true)
    try {
      await api.auth.magicLink.request(email)
    } catch {
      // Neutral by design server-side; a network/transport failure still shows the same
      // neutral confirmation rather than leaking whether the email exists.
    } finally {
      setMagicSending(false)
      setMagicSent(true)
    }
  }

  if (user) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground" title={user.email ?? undefined}>
          {user.name ?? user.email}
        </span>
        {user.role === 'admin' && (
          <>
            <button
              onClick={() => setAdminOpen(true)}
              className="text-sm font-medium text-primary transition-colors hover:underline"
            >
              {t('admin.title')}
            </button>
            {adminOpen && (
              <Suspense fallback={null}>
                <AdminPanel open onClose={() => setAdminOpen(false)} />
              </Suspense>
            )}
          </>
        )}
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input
            type="checkbox"
            aria-label={t('auth.email_alerts')}
            checked={user.emailAlerts}
            onChange={async (e) => {
              const next = e.target.checked
              try {
                const res = await api.auth.updateMe(next)
                updateUser({ emailAlerts: res.user.emailAlerts })
                toastCtx?.toast(t('auth.preferences_saved'), 'success')
              } catch {
                toastCtx?.toast(t('auth.preferences_failed'), 'error')
              }
            }}
          />
          {t('auth.email_alerts')}
        </label>
        <button
          onClick={() => { void signOut() }}
          className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          {t('auth.sign_out')}
        </button>
      </div>
    )
  }

  // Two ways into the same invite-only account, given equal footing and a shared 240px rhythm:
  // Google one-click, or a passwordless email link. The email field is one control — type,
  // then press the inset send button (or Enter). The arrow points the reading-forward way so
  // it reads as "send" in both Hebrew (RTL) and English (LTR).
  return (
    <div className="flex w-60 max-w-[80vw] flex-col gap-3">
      <GoogleLogin
        onSuccess={(cred) => { if (cred.credential) handleSignIn(cred.credential) }}
        onError={() => toastCtx?.toast(t('auth.sign_in_failed'), 'error')}
        useOneTap={false}
        shape="pill"
        size="large"
        width="240"
        text="signin_with"
        logo_alignment="center"
      />

      {magicSent ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-2xl border border-primary/25 bg-primary/5 px-3.5 py-2.5 text-xs leading-snug text-muted-foreground"
        >
          <svg viewBox="0 0 24 24" aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
          <span>{t('auth.magic_link_sent')}</span>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2.5" aria-hidden>
            <span className="h-px flex-1 bg-border" />
            <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">{t('auth.or')}</span>
            <span className="h-px flex-1 bg-border" />
          </div>

          <form
            onSubmit={(e) => { e.preventDefault(); void handleMagicLinkRequest() }}
            className="flex h-11 items-center gap-1 rounded-full border border-input bg-background ps-4 pe-1.5 transition-colors focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25"
          >
            <input
              type="email"
              value={magicEmail}
              onChange={(e) => setMagicEmail(e.target.value)}
              placeholder={t('auth.email_placeholder')}
              aria-label={t('auth.email_placeholder')}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!magicEmail.trim() || magicSending}
              aria-label={t('auth.magic_link_button')}
              title={t('auth.magic_link_button')}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition enabled:hover:brightness-110 enabled:active:scale-95 disabled:opacity-40"
            >
              <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: dir === 'rtl' ? 'scaleX(-1)' : undefined }}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
            </button>
          </form>
        </>
      )}
    </div>
  )
}
