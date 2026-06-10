import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { api, setAccessToken, setRefreshHandler, type AuthUser } from '@/lib/api-client'

const REFRESH_KEY = 'liberal.refreshToken'

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean            // initial session-restore finished
  signIn: (googleIdToken: string) => Promise<void>
  signOut: () => Promise<void>
  updateUser: (patch: Partial<AuthUser>) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}

/** Like useAuth but returns null outside a provider (for optional/standalone UI). */
export function useAuthOptional(): AuthContextValue | null {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [ready, setReady] = useState(false)
  const refreshToken = useRef<string | null>(localStorage.getItem(REFRESH_KEY))

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((u) => (u ? { ...u, ...patch } : u))
  }, [])

  const apply = useCallback((accessToken: string, newRefresh: string, u: AuthUser) => {
    setAccessToken(accessToken)
    refreshToken.current = newRefresh
    localStorage.setItem(REFRESH_KEY, newRefresh)
    setUser(u)
  }, [])

  const clear = useCallback(() => {
    setAccessToken(null)
    refreshToken.current = null
    localStorage.removeItem(REFRESH_KEY)
    setUser(null)
  }, [])

  // Feed api-client's 401 retry: refresh and return a fresh access token, else sign out.
  const refresh = useCallback(async (): Promise<string | null> => {
    if (!refreshToken.current) return null
    try {
      const res = await api.auth.refresh(refreshToken.current)
      apply(res.accessToken, res.refreshToken, res.user)
      return res.accessToken
    } catch {
      clear()
      return null
    }
  }, [apply, clear])

  const signIn = useCallback(async (googleIdToken: string) => {
    const res = await api.auth.google(googleIdToken)
    apply(res.accessToken, res.refreshToken, res.user)
  }, [apply])

  const signOut = useCallback(async () => {
    const token = refreshToken.current
    clear()
    if (token) { try { await api.auth.logout(token) } catch { /* best-effort */ } }
  }, [clear])

  // Register the refresh handler once; restore any existing session on mount.
  useEffect(() => {
    setRefreshHandler(refresh)
    ;(async () => {
      if (refreshToken.current) await refresh()
      setReady(true)
    })()
    return () => setRefreshHandler(null)
  }, [refresh])

  return (
    <AuthContext.Provider value={{ user, ready, signIn, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}
