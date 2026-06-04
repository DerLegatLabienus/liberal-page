import { useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { useTranslation } from 'react-i18next'
import { useAuthOptional } from '@/contexts/AuthContext'
import { useToastOptional } from '@/contexts/ToastContext'
import { errorStatus } from '@/lib/api-client'
import AdminPanel from '@/components/admin/AdminPanel'

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

  if (!auth || !auth.ready) return null
  const { user, signIn, signOut } = auth

  const handleSignIn = (idToken: string) => {
    signIn(idToken)
      .then(() => toastCtx?.toast(t('auth.signed_in'), 'success'))
      .catch((err: unknown) => {
        // 403 = email not on the invite allowlist; anything else = generic failure.
        const msg = errorStatus(err) === 403 ? t('auth.not_invited') : t('auth.sign_in_failed')
        toastCtx?.toast(msg, 'error')
      })
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
            <AdminPanel open={adminOpen} onClose={() => setAdminOpen(false)} />
          </>
        )}
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
    <GoogleLogin
      onSuccess={(cred) => { if (cred.credential) handleSignIn(cred.credential) }}
      onError={() => toastCtx?.toast(t('auth.sign_in_failed'), 'error')}
      useOneTap={false}
      shape="pill"
      size="medium"
    />
  )
}
