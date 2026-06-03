import { useState } from 'react'
import { GoogleLogin } from '@react-oauth/google'
import { useTranslation } from 'react-i18next'
import { useAuthOptional } from '@/contexts/AuthContext'
import AdminPanel from '@/components/admin/AdminPanel'

/**
 * Header auth control: Google sign-in button when logged out; name + sign-out when in.
 * The GIS button only functions when VITE_GOOGLE_CLIENT_ID is configured. Renders nothing
 * outside an AuthProvider (e.g. isolated Header unit tests) or before session restore.
 */
export default function AuthControl() {
  const { t } = useTranslation()
  const auth = useAuthOptional()
  const [adminOpen, setAdminOpen] = useState(false)

  if (!auth || !auth.ready) return null
  const { user, signIn, signOut } = auth

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
      onSuccess={(cred) => { if (cred.credential) void signIn(cred.credential) }}
      onError={() => { /* surfaced by GIS UI */ }}
      useOneTap={false}
      shape="pill"
      size="medium"
    />
  )
}
