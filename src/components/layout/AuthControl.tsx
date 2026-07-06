import { useState, lazy, Suspense } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import type { PublicClientApplication } from '@azure/msal-browser'
import { useTranslation } from 'react-i18next'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useToastOptional } from '@/contexts/ToastContext'
import { api, errorStatus } from '@/lib/api-client'

// Admin-only and heavy (tabs, accordion, analytics) — lazy-loaded so the ~99% of visitors who
// never open it (and every non-admin) don't pay for it in the main bundle.
const AdminPanel = lazy(() => import('@/components/admin/AdminPanel'))

// Microsoft (MSAL) sign-in is entirely optional: the button only renders when this is set, so
// unconfigured deployments never load/initialize the SDK.
const MICROSOFT_CLIENT_ID = import.meta.env.VITE_MICROSOFT_CLIENT_ID as string | undefined

// One instance for the app's lifetime, created lazily on first click (not at module load) —
// `@azure/msal-browser` is a sizeable SDK, so it's dynamically imported here rather than at
// the top of the file, keeping it out of the main bundle for every visitor who never clicks
// the Microsoft button (the vast majority, especially while unconfigured). `initialize()` is
// required before any other MSAL call and is itself idempotent-safe to await repeatedly, so we
// cache that promise too.
let msalInstance: PublicClientApplication | null = null
let msalReady: Promise<void> | null = null
async function getMsalInstance(): Promise<PublicClientApplication> {
  if (!msalInstance) {
    const { PublicClientApplication: Msal } = await import('@azure/msal-browser')
    msalInstance = new Msal({
      auth: { clientId: MICROSOFT_CLIENT_ID!, authority: 'https://login.microsoftonline.com/common' },
      cache: { cacheLocation: 'sessionStorage' },
    })
    msalReady = msalInstance.initialize()
  }
  await msalReady
  return msalInstance
}

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

  const handleMicrosoftSignIn = async () => {
    try {
      const pca = await getMsalInstance()
      const result = await pca.loginPopup({ scopes: ['openid', 'profile', 'email'] })
      if (!result.idToken) throw new Error('Microsoft sign-in returned no id token')
      await signIn(result.idToken, 'microsoft')
      toastCtx?.toast(t('auth.signed_in'), 'success')
    } catch (err: unknown) {
      const msg = errorStatus(err) === 403 ? t('auth.not_invited') : t('auth.sign_in_failed')
      toastCtx?.toast(msg, 'error')
    }
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

  return (
    <div className="flex flex-col items-end gap-2">
      <GoogleLogin
        onSuccess={(cred) => { if (cred.credential) handleSignIn(cred.credential) }}
        onError={() => toastCtx?.toast(t('auth.sign_in_failed'), 'error')}
        useOneTap={false}
        shape="pill"
        size="medium"
      />
      {MICROSOFT_CLIENT_ID && (
        <button
          onClick={() => { void handleMicrosoftSignIn() }}
          className="rounded border border-input bg-background px-3 py-1 text-xs font-medium transition-colors hover:bg-muted"
        >
          {t('auth.microsoft_sign_in')}
        </button>
      )}
      {magicSent ? (
        <span className="max-w-[220px] text-end text-xs text-muted-foreground">{t('auth.magic_link_sent')}</span>
      ) : (
        <div className="flex items-center gap-1">
          <input
            type="email"
            value={magicEmail}
            onChange={(e) => setMagicEmail(e.target.value)}
            placeholder={t('auth.email_placeholder')}
            aria-label={t('auth.email_placeholder')}
            className="w-40 rounded border border-input bg-background px-2 py-1 text-xs"
          />
          <button
            onClick={() => { void handleMagicLinkRequest() }}
            disabled={!magicEmail.trim() || magicSending}
            className="text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-50"
          >
            {t('auth.magic_link_button')}
          </button>
        </div>
      )}
    </div>
  )
}
