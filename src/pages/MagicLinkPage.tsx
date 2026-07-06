import { useEffect, useRef, useState } from 'react'
import { useSearchParams, Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/contexts/AuthContext'

/**
 * Lands here from the emailed magic-link (`${APP_PUBLIC_URL}/auth/magic-link?token=...`).
 * Verifies the token once (StrictMode/re-render guarded via ranRef — the token is single-use
 * server-side, so a duplicate call would just fail), applies the session through the same
 * path as Google sign-in, then redirects home.
 */
export default function MagicLinkPage() {
  const { t } = useTranslation()
  const [params] = useSearchParams()
  const { verifyMagicLink } = useAuth()
  const [status, setStatus] = useState<'pending' | 'done' | 'error'>('pending')
  const ranRef = useRef(false)

  useEffect(() => {
    if (ranRef.current) return
    ranRef.current = true
    const token = params.get('token')
    if (!token) { setStatus('error'); return }
    verifyMagicLink(token)
      .then(() => setStatus('done'))
      .catch(() => setStatus('error'))
  }, [params, verifyMagicLink])

  if (status === 'done') return <Navigate to="/" replace />

  return (
    <div className="flex min-h-screen items-center justify-center px-4 text-center">
      <p className="text-muted-foreground">
        {status === 'pending' ? t('auth.magic_link_verifying') : t('auth.magic_link_invalid')}
      </p>
    </div>
  )
}
