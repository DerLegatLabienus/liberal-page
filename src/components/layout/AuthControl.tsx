import { useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { XIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Dialog, DialogContent, DialogClose, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useToastOptional } from '@/contexts/ToastContext'
import UserMenu from '@/components/layout/UserMenu'
import { api, errorStatus } from '@/lib/api-client'

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
    return <UserMenu user={user} onSignOut={() => { void signOut() }} onUpdateUser={updateUser} />
  }

  // A quiet outline "Sign in" trigger — deliberately understated so it doesn't compete with the
  // solid primary "tracker" button beside it in the header. It opens a popup holding every way
  // into the invite-only account: Google one-click, or a passwordless email sign-in link.
  return (
    <>
      <button
        type="button"
        onClick={openLogin}
        className="whitespace-nowrap rounded-full border border-input px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
      >
        {t('auth.sign_in')}
      </button>

      <Dialog
        open={loginOpen}
        onOpenChange={(open) => { setLoginOpen(open); if (!open) { setMagicSent(false); setMagicEmail(''); setLoginError(null) } }}
      >
        {/* Opaque inner card (not bg on the positioning Popup, which renders see-through) —
            same pattern as AdminPanel. Light card regardless of theme; the site is light-first. */}
        <DialogContent className="max-w-[25rem]">
          <div className="relative rounded-2xl bg-white p-7 text-slate-900 shadow-2xl" dir="rtl">
            <DialogClose
              aria-label={t('auth.close')}
              className="absolute end-4 top-4 rounded-full p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            >
              <XIcon className="h-5 w-5" />
            </DialogClose>

            <div className="text-center">
              <DialogTitle className="text-xl font-bold text-slate-900">{t('auth.sign_in')}</DialogTitle>
              <DialogDescription className="mx-auto mt-2 max-w-[19rem] text-sm leading-relaxed text-slate-500">
                {t('auth.sign_in_hint')}
              </DialogDescription>
            </div>

            {loginError && (
              <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-700">
                {loginError}
              </p>
            )}

            <div className="mt-6 flex flex-col gap-4">
              <div className="flex justify-center">
                <GoogleLogin
                  onSuccess={(cred) => { if (cred.credential) handleSignIn(cred.credential) }}
                  onError={() => setLoginError(t('auth.sign_in_failed'))}
                  useOneTap={false}
                  shape="pill"
                  size="large"
                  width="336"
                  text="signin_with"
                />
              </div>

              <div className="flex items-center gap-3" aria-hidden>
                <span className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-medium text-slate-400">{t('auth.or')}</span>
                <span className="h-px flex-1 bg-slate-200" />
              </div>

              {magicSent ? (
                <div
                  role="status"
                  className="flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm leading-snug text-emerald-800"
                >
                  <svg viewBox="0 0 24 24" aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
                  <span>{t('auth.magic_link_sent')}</span>
                </div>
              ) : (
                <form onSubmit={(e) => { e.preventDefault(); void handleMagicLinkRequest() }} className="flex flex-col gap-2.5">
                  <input
                    type="email"
                    value={magicEmail}
                    onChange={(e) => setMagicEmail(e.target.value)}
                    placeholder={t('auth.email_placeholder')}
                    aria-label={t('auth.email_placeholder')}
                    className="h-11 rounded-xl border border-slate-300 bg-white px-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:outline-none focus:ring-4 focus:ring-blue-500/20"
                  />
                  {/* Explicit blue-600 (== the brand --primary oklch) because the project's
                      bg-primary token resolves transparent under hsl(var(--primary)). */}
                  <button
                    type="submit"
                    disabled={!magicEmail.trim() || magicSending}
                    className="h-11 rounded-xl bg-blue-600 text-sm font-semibold text-white transition hover:bg-blue-700 disabled:opacity-40"
                  >
                    {t('auth.magic_link_button')}
                  </button>
                </form>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
