import { describe, it, expect, beforeEach, vi } from 'vitest'

const { getAllFlags } = vi.hoisted(() => ({ getAllFlags: vi.fn() }))
vi.mock('../../server/repositories/feature-flags-repository', () => ({
  FeatureFlagsRepository: vi.fn().mockImplementation(() => ({ getAll: getAllFlags })),
}))

import {
  isConfigured, findActiveMeeting, createSingleUseLink, _resetCalendly, CalendlyError,
} from '../../server/services/calendly'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

const EVENT_TYPE = 'https://api.calendly.com/event_types/ET1'
const flagOn = { meetUs: { enabled: true, value: EVENT_TYPE } }

function jsonRes(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

describe('calendly service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetCalendly()
    process.env.CALENDLY_API_TOKEN = 'tok'
    getAllFlags.mockResolvedValue(flagOn)
  })

  it('isConfigured false when token unset', async () => {
    delete process.env.CALENDLY_API_TOKEN
    expect(await isConfigured()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('isConfigured false when flag disabled or value empty', async () => {
    getAllFlags.mockResolvedValue({ meetUs: { enabled: false, value: EVENT_TYPE } })
    expect(await isConfigured()).toBe(false)
    getAllFlags.mockResolvedValue({ meetUs: { enabled: true, value: '' } })
    expect(await isConfigured()).toBe(false)
  })

  it('isConfigured true when token + enabled flag with value', async () => {
    expect(await isConfigured()).toBe(true)
  })

  it('findActiveMeeting returns null when no events', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ resource: { current_organization: 'https://api.calendly.com/organizations/O1' } })) // /users/me
      .mockResolvedValueOnce(jsonRes({ collection: [] })) // /scheduled_events
    expect(await findActiveMeeting('p@x.com')).toBeNull()
    const eventsUrl = String(fetchMock.mock.calls[1][0])
    expect(eventsUrl).toContain('invitee_email=p%40x.com')
    expect(eventsUrl).toContain('status=active')
    expect(eventsUrl).toContain('organization=')
  })

  it('findActiveMeeting maps event + invitee urls', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ resource: { current_organization: 'https://api.calendly.com/organizations/O1' } }))
      .mockResolvedValueOnce(jsonRes({ collection: [{ uri: 'https://api.calendly.com/scheduled_events/EV1', start_time: '2026-07-01T10:00:00Z' }] }))
      .mockResolvedValueOnce(jsonRes({ collection: [{ cancel_url: 'https://calendly.com/cancellations/i1', reschedule_url: 'https://calendly.com/reschedulings/i1' }] }))
    const m = await findActiveMeeting('p@x.com')
    expect(m).toEqual({
      startTime: '2026-07-01T10:00:00Z',
      cancelUrl: 'https://calendly.com/cancellations/i1',
      rescheduleUrl: 'https://calendly.com/reschedulings/i1',
    })
    expect(String(fetchMock.mock.calls[2][0])).toContain('/scheduled_events/EV1/invitees')
  })

  it('caches the org URI across calls (users/me fetched once)', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonRes({ resource: { current_organization: 'https://api.calendly.com/organizations/O1' } }))
      .mockResolvedValueOnce(jsonRes({ collection: [] }))
      .mockResolvedValueOnce(jsonRes({ collection: [] }))
    await findActiveMeeting('a@x.com')
    await findActiveMeeting('b@x.com')
    const meCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/users/me'))
    expect(meCalls).toHaveLength(1)
  })

  it('createSingleUseLink posts the correct body and returns booking_url', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ resource: { booking_url: 'https://calendly.com/d/abc' } }))
    const url = await createSingleUseLink()
    expect(url).toBe('https://calendly.com/d/abc')
    const [reqUrl, init] = fetchMock.mock.calls[0]
    expect(String(reqUrl)).toContain('/scheduling_links')
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      max_event_count: 1, owner: EVENT_TYPE, owner_type: 'EventType',
    })
  })

  it('throws CalendlyError on a non-OK response', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes({ message: 'nope' }, 500))
    await expect(createSingleUseLink()).rejects.toBeInstanceOf(CalendlyError)
  })
})
