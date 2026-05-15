import type { Bill, Committee, Mk, TrackingType } from '@/types'

async function apiFetch<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
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
}
