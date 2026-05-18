import type { Bill, Committee, Mk, TrackingType, KnessetMember, MkActivity, BillSearchResult, CommitteeListItem } from '@/types'

const API_BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export const api = {
  parliament: {
    getBills: () => apiFetch<Bill[]>('/parliament/bill'),
    getCommittees: () => apiFetch<Committee[]>('/parliament/committee'),
    getMks: () => apiFetch<Mk[]>('/parliament/mk'),
  },
  tracking: {
    add: (payload: { url?: string; rawId?: string; type?: TrackingType }) =>
      apiFetch<{ ok: boolean; item: Bill | Committee | Mk }>('/tracking/add', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    remove: (type: TrackingType, id: number) =>
      apiFetch<{ ok: boolean }>(`/tracking/${type}/${id}`, { method: 'DELETE' }),
  },
  summarize: (url: string) =>
    apiFetch<{ summary: string }>('/summarize', {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  bills: {
    search: (q: string) => apiFetch<BillSearchResult[]>(`/bills/search?q=${encodeURIComponent(q)}`),
    track: (billId: number, name: string, knessetUrl: string) =>
      apiFetch<{ ok: boolean; duplicate?: boolean; item?: Bill }>('/bills/track', {
        method: 'POST',
        body: JSON.stringify({ billId, name, knessetUrl }),
      }),
  },
  mks: {
    list: () => apiFetch<KnessetMember[]>('/mks/list'),
    activity: (siteId: number) => apiFetch<MkActivity[]>(`/mks/activity?siteId=${siteId}`),
  },
  committees: {
    list: () => apiFetch<CommitteeListItem[]>('/committees/list'),
    track: (committeeId: number, name: string, knessetUrl: string) =>
      apiFetch<{ ok: boolean; duplicate?: boolean }>('/committees/track', {
        method: 'POST',
        body: JSON.stringify({ committeeId, name, knessetUrl }),
      }),
  },
}
