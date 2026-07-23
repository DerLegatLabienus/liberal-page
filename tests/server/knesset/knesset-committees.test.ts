import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchCommitteeDetail } from '../../../server/services/knesset-committees'

function mockJson(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response
}

describe('fetchCommitteeDetail', () => {
  beforeEach(() => { vi.restoreAllMocks() })

  it('returns committee info and sessions when the committee exists', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockJson({ value: [{ CommitteeID: 7, Name: 'ועדת הכספים', KnessetNum: 25, CommitteeTypeDesc: 'קבועה', Email: null }] }))
      .mockResolvedValueOnce(mockJson({ value: [{ CommitteeSessionID: 1, StartDate: '2026-05-01', StatusDesc: 'הסתיימה', TypeDesc: 'דיון', SessionUrl: 'http://x' }] }))

    const detail = await fetchCommitteeDetail(7)
    expect(detail).not.toBeNull()
    expect(detail!.committee.Name).toBe('ועדת הכספים')
    expect(detail!.sessions).toHaveLength(1)
    expect(detail!.sessions[0].CommitteeSessionID).toBe(1)
  })

  it('returns null when the committee is not found', async () => {
    vi.spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockJson({ value: [] }))
      .mockResolvedValueOnce(mockJson({ value: [] }))

    expect(await fetchCommitteeDetail(99999)).toBeNull()
  })
})
