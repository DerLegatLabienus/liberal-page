import { createContext, useContext, useEffect, useState, useCallback, useRef, type ReactNode } from 'react'
import { api, setAccessToken, setRefreshHandler, type AuthUser } from '@/lib/api-client'

const REFRESH_KEY = 'liberal.refreshToken'
const CHANNEL_NAME = 'liberal-auth'

type BroadcastMsg =
  | { type: 'session'; accessToken: string; refreshToken: string; user: AuthUser }
  | { type: 'logout' }

interface AuthContextValue {
  user: AuthUser | null
  ready: boolean            // initial session-restore finished
  signIn: (googleIdToken: string) => Promise<void>
  verifyMagicLink: (token: string) => Promise<void>
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
  // Deduplicates concurrent refresh calls: if multiple 401s fire at the same time they all
  // await the same in-flight promise instead of each rotating the token (which triggers the
  // server's reuse-detection and wiping all sessions).
  const refreshInFlight = useRef<Promise<string | null> | null>(null)
  // Cross-tab session sync: broadcasts login/logout to sibling tabs so they pick up the
  // session immediately without having to re-authenticate.
  const channel = useRef<BroadcastChannel | null>(null)

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((u) => (u ? { ...u, ...patch } : u))
  }, [])

  const apply = useCallback((accessToken: string, newRefresh: string, u: AuthUser) => {
    setAccessToken(accessToken)
    refreshToken.current = newRefresh
    localStorage.setItem(REFRESH_KEY, newRefresh)
    setUser(u)
    channel.current?.postMessage({ type: 'session', accessToken, refreshToken: newRefresh, user: u } satisfies BroadcastMsg)
  }, [])

  const clear = useCallback(() => {
    setAccessToken(null)
    refreshToken.current = null
    localStorage.removeItem(REFRESH_KEY)
    setUser(null)
    channel.current?.postMessage({ type: 'logout' } satisfies BroadcastMsg)
  }, [])

  // Feed api-client's 401 retry: refresh and return a fresh access token, else sign out.
  // Concurrent callers share a single in-flight request so the refresh token is only
  // rotated once — multiple simultaneous 401s would otherwise each attempt rotation,
  // triggering server-side reuse detection and wiping all sessions.
  const refresh = useCallback((): Promise<string | null> => {
    if (!refreshToken.current) return Promise.resolve(null)
    if (refreshInFlight.current) return refreshInFlight.current
    refreshInFlight.current = (async () => {
      try {
        const res = await api.auth.refresh(refreshToken.current!)
        apply(res.accessToken, res.refreshToken, res.user)
        return res.accessToken
      } catch {
        clear()
        return null
      } finally {
        refreshInFlight.current = null
      }
    })()
    return refreshInFlight.current
  }, [apply, clear])

  const signIn = useCallback(async (googleIdToken: string) => {
    const res = await api.auth.google(googleIdToken)
    apply(res.accessToken, res.refreshToken, res.user)
  }, [apply])

  // Same session-establishment path as signIn — verify the token server-side and apply
  // whatever session it returns (also broadcasts to sibling tabs via `apply`).
  const verifyMagicLink = useCallback(async (token: string) => {
    const res = await api.auth.magicLink.verify(token)
    apply(res.accessToken, res.refreshToken, res.user)
  }, [apply])

  const signOut = useCallback(async () => {
    const token = refreshToken.current
    clear()
    if (token) { try { await api.auth.logout(token) } catch { /* best-effort */ } }
  }, [clear])

  // Set up cross-tab broadcast channel. Other tabs send us their session state when they
  // log in or out; we apply it directly so the user is never asked to sign in twice.
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return
    const bc = new BroadcastChannel(CHANNEL_NAME)
    channel.current = bc
    bc.onmessage = (e: MessageEvent<BroadcastMsg>) => {
      const msg = e.data
      if (msg.type === 'session') {
        setAccessToken(msg.accessToken)
        refreshToken.current = msg.refreshToken
        localStorage.setItem(REFRESH_KEY, msg.refreshToken)
        setUser(msg.user)
      } else if (msg.type === 'logout') {
        setAccessToken(null)
        refreshToken.current = null
        localStorage.removeItem(REFRESH_KEY)
        setUser(null)
      }
    }
    return () => { bc.close(); channel.current = null }
  }, [])

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
    <AuthContext.Provider value={{ user, ready, signIn, verifyMagicLink, signOut, updateUser }}>
      {children}
    </AuthContext.Provider>
  )
}
