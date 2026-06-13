import type { Bill, Committee, Mk, TrackingType, KnessetMember, MkActivity, BillSearchResult, CommitteeListItem, KnessetBillOverviewItem, FeatureFlags } from '@/types'

const API_BASE = import.meta.env.VITE_API_URL ? `${import.meta.env.VITE_API_URL}/api` : '/api'

// --- Auth wiring (set by AuthProvider) --------------------------------------------------
let accessToken: string | null = null
// Returns a fresh access token on success, or null if refresh failed (→ signed out).
let refreshHandler: (() => Promise<string | null>) | null = null

export function setAccessToken(token: string | null): void { accessToken = token }
export function setRefreshHandler(fn: (() => Promise<string | null>) | null): void { refreshHandler = fn }

async function doFetch(path: string, options: RequestInit | undefined, token: string | null): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> | undefined) }
  if (token) headers['Authorization'] = `Bearer ${token}`
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  let res = await doFetch(path, options, accessToken)

  // On 401, try a single refresh, then retry with the new token. Never for the auth
  // endpoints themselves (would recurse).
  const isAuthEndpoint = path.startsWith('/auth/')
  if (res.status === 401 && refreshHandler && !isAuthEndpoint) {
    const fresh = await refreshHandler()
    if (fresh) res = await doFetch(path, options, fresh)
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    const err = new Error(body.error ?? `API error ${res.status}`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

/** HTTP status carried on errors thrown by the api client (when available). */
export function errorStatus(e: unknown): number | undefined {
  return (e as { status?: number } | null)?.status
}

/** Like apiFetch but returns non-OK JSON bodies instead of throwing (used where 409 carries data). */
export async function apiFetchRaw<T>(path: string, options?: RequestInit): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers as Record<string, string> | undefined) },
  })
  const body = (await res.json().catch(() => ({}))) as T
  return { status: res.status, body }
}

export type TrackScope = 'group' | 'personal'
// Reads default to the group list; pass 'personal' to read the caller's list.
const readQ = (scope?: TrackScope) => (scope === 'personal' ? '?scope=personal' : '')
// Writes default to personal; pass 'group' (admin only) to edit the public list.
const writeQ = (scope?: TrackScope) => (scope === 'group' ? '?scope=group' : '')

export const api = {
  parliament: {
    getBills: (scope?: TrackScope) => apiFetch<Bill[]>(`/parliament/bill${readQ(scope)}`),
    getCommittees: (scope?: TrackScope) => apiFetch<Committee[]>(`/parliament/committee${readQ(scope)}`),
    getMks: (scope?: TrackScope) => apiFetch<Mk[]>(`/parliament/mk${readQ(scope)}`),
  },
  tracking: {
    add: (payload: { url?: string; rawId?: string; type?: TrackingType }, scope?: TrackScope) =>
      apiFetch<{ ok: boolean; item: Bill | Committee | Mk }>(`/tracking/add${writeQ(scope)}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    remove: (type: TrackingType, id: number, scope?: TrackScope) =>
      apiFetch<{ ok: boolean }>(`/tracking/${type}/${id}${writeQ(scope)}`, { method: 'DELETE' }),
  },
  summarize: (url: string) =>
    apiFetch<{ summary: string }>('/summarize', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  bills: {
    search: (q: string) => apiFetch<BillSearchResult[]>(`/bills/search?q=${encodeURIComponent(q)}`),
    track: (billId: number, name: string, knessetUrl: string, scope?: TrackScope) =>
      apiFetch<{ ok: boolean; duplicate?: boolean; item?: Bill }>(`/bills/track${writeQ(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ billId, name, knessetUrl }),
      }),
    recent: (limit = 10) => apiFetch<KnessetBillOverviewItem[]>(`/bills/recent?limit=${limit}`),
    trending: () => apiFetch<KnessetBillOverviewItem[]>('/bills/trending'),
    policyAligned: (limit = 10) => apiFetch<KnessetBillOverviewItem[]>(`/bills/policy-aligned?limit=${limit}`),
  },
  mks: {
    list: () => apiFetch<KnessetMember[]>('/mks/list'),
    activity: (siteId: number) => apiFetch<MkActivity[]>(`/mks/activity?siteId=${siteId}`),
  },
  committees: {
    list: () => apiFetch<CommitteeListItem[]>('/committees/list'),
    track: (committeeId: number, name: string, knessetUrl: string, scope?: TrackScope) =>
      apiFetch<{ ok: boolean; duplicate?: boolean }>(`/committees/track${writeQ(scope)}`, {
        method: 'POST',
        body: JSON.stringify({ committeeId, name, knessetUrl }),
      }),
  },
  featureFlags: {
    get: () => apiFetch<FeatureFlags>('/feature-flags'),
  },
  meetings: {
    // Public endpoint; 409 carries the visitor's existing meeting, so use the raw helper.
    bookingLink: (idToken: string) =>
      apiFetchRaw<BookingLinkResponse & { error?: string; meeting?: ActiveMeeting }>(
        `/meetings/booking-link`, { method: 'POST', body: JSON.stringify({ idToken }) }),
  },
  analytics: {
    // Fire-and-forget Join click-through. Callers should not await/block on this.
    joinClick: (status: string, mode: string) =>
      apiFetch<{ ok: boolean }>('/analytics/join', {
        method: 'POST',
        body: JSON.stringify({ status, mode }),
      }),
  },
  auth: {
    google: (idToken: string) =>
      apiFetch<AuthResponse>('/auth/google', { method: 'POST', body: JSON.stringify({ idToken }) }),
    refresh: (refreshToken: string) =>
      apiFetch<AuthResponse>('/auth/refresh', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
    logout: (refreshToken: string) =>
      apiFetch<{ ok: boolean }>('/auth/logout', { method: 'POST', body: JSON.stringify({ refreshToken }) }),
    me: () => apiFetch<{ user: AuthUser }>('/auth/me'),
    updateMe: (emailAlerts: boolean) =>
      apiFetch<{ user: AuthUser }>(`/auth/me`, { method: 'PATCH', body: JSON.stringify({ emailAlerts }) }),
  },
  admin: {
    listInvites: () => apiFetch<{ invites: Invite[] }>('/admin/invites'),
    addInvite: (email: string, role: 'admin' | 'member') =>
      apiFetch<{ ok: boolean }>('/admin/invites', { method: 'POST', body: JSON.stringify({ email, role }) }),
    removeInvite: (email: string) =>
      apiFetch<{ ok: boolean }>(`/admin/invites/${encodeURIComponent(email)}`, { method: 'DELETE' }),
    listUsers: () => apiFetch<{ users: AuthUser[] }>('/admin/users'),
    setRole: (id: number, role: 'admin' | 'member') =>
      apiFetch<{ ok: boolean }>(`/admin/users/${id}/role`, { method: 'PATCH', body: JSON.stringify({ role }) }),
    emailTemplates: {
      list: () => apiFetch<{ templates: EmailTemplate[] }>(`/admin/email-templates`),
      update: (name: string, body: { subject: string; html: string }) =>
        apiFetch<{ ok: boolean }>(`/admin/email-templates/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }),
    },
    featureFlags: {
      update: (name: string, body: { enabled: boolean; value: string | null }) =>
        apiFetch<{ ok: boolean }>(`/admin/feature-flags/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }),
    },
    analytics: {
      joinSummary: () => apiFetch<JoinAnalyticsData>('/admin/analytics/join'),
    },
  },
}

export interface AuthUser { id: number; email: string | null; name: string | null; role: string; emailAlerts: boolean }
export interface EmailTemplate { name: string; subject: string; html: string }
export interface AuthResponse { accessToken: string; refreshToken: string; user: AuthUser }
export interface Invite { email: string; role: string; createdAt: string }
export interface ActiveMeeting { startTime: string; cancelUrl: string; rescheduleUrl: string }
export interface BookingLinkResponse { bookingUrl: string; name: string; email: string }
export interface JoinAnalyticsRow { bucket: string; total: number; breakdown: Record<string, number>; createdAt: string | null }
export interface JoinAnalyticsData { lifetime: JoinAnalyticsRow | null; daily: JoinAnalyticsRow[] }
