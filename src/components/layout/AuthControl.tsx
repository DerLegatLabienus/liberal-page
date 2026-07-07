import { useState, lazy, Suspense } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useToastOptional } from '@/contexts/ToastContext'
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
  const auth = useAuthOptional()
  const toastCtx = useToastOptional()
  const [adminOpen, setAdminOpen] = useState(false)
  const [loginOpen, setLoginOpen] = useState(false)
  const [loginError, setLoginError] = useState<string | null>(null)
  const [magicEmail, setMagicEmail] = useState('')
  const [magicSending, setMagicSending] = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  if (!auth || !auth.ready) return null
  const { user, signIn, signOut, updateUser } = auth

  const openLogin = () => { setLoginError(null); setMagicSent(false); setLoginOpen(true) }

  const handleSignIn = (idToken: string) => {
    setLoginError(null)
    signIn(idToken)
      .then(() => { setLoginOpen(false); toastCtx?.toast(t('auth.signed_in'), 'success') })
      .catch((err: unknown) => {
        // 403 = email not on the invite allowlist; anything else = generic failure. Shown
        // inside the modal (a toast would render behind the dialog's inert backdrop, unseen).
        setLoginError(errorStatus(err) === 403 ? t('auth.not_invited') : t('auth.sign_in_failed'))
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

  // One "Sign in" button in the header opens a popup with every way into the invite-only
  // account: Google one-click, or a passwordless email sign-in link. Keeping the choices behind
  // a single trigger keeps the header uncluttered and gives the two paths room to breathe.
  return (
    <>
      <button
        type="button"
        onClick={openLogin}
        className="rounded-full bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition hover:brightness-110"
      >
        {t('auth.sign_in')}
      </button>

      <Dialog
        open={loginOpen}
        onOpenChange={(open) => { setLoginOpen(open); if (!open) { setMagicSent(false); setMagicEmail(''); setLoginError(null) } }}
      >
        <DialogContent className="max-w-xs rounded-2xl border border-border bg-background p-6 shadow-xl">
          <DialogClose
            aria-label={t('auth.close')}
            className="absolute end-3 top-3 rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <XIcon className="h-4 w-4" />
          </DialogClose>

          <DialogTitle className="text-lg font-semibold">{t('auth.sign_in')}</DialogTitle>
          <DialogDescription className="mt-1">{t('auth.sign_in_hint')}</DialogDescription>

          {loginError && (
            <p role="alert" className="mt-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {loginError}
            </p>
          )}

          <div className="mt-5 flex flex-col gap-4">
            <div className="flex justify-center">
              <GoogleLogin
                onSuccess={(cred) => { if (cred.credential) handleSignIn(cred.credential) }}
                onError={() => setLoginError(t('auth.sign_in_failed'))}
                useOneTap={false}
                shape="pill"
                size="large"
                width="260"
                text="signin_with"
              />
            </div>

            <div className="flex items-center gap-2.5" aria-hidden>
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">{t('auth.or')}</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {magicSent ? (
              <div
                role="status"
                className="rounded-xl border border-primary/25 bg-primary/5 px-3.5 py-3 text-sm leading-snug text-muted-foreground"
              >
                {t('auth.magic_link_sent')}
              </div>
            ) : (
              <form onSubmit={(e) => { e.preventDefault(); void handleMagicLinkRequest() }} className="flex flex-col gap-2">
                <input
                  type="email"
                  value={magicEmail}
                  onChange={(e) => setMagicEmail(e.target.value)}
                  placeholder={t('auth.email_placeholder')}
                  aria-label={t('auth.email_placeholder')}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-2 focus:ring-ring/25"
                />
                <button
                  type="submit"
                  disabled={!magicEmail.trim() || magicSending}
                  className="h-10 rounded-lg border border-input bg-background text-sm font-medium text-foreground transition hover:bg-muted disabled:opacity-40"
                >
                  {t('auth.magic_link_button')}
                </button>
              </form>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
