import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { verifyGoogleIdToken, isConfigured, findActiveMeeting, createSingleUseLink } = vi.hoisted(() => ({
  verifyGoogleIdToken: vi.fn(),
  isConfigured: vi.fn(),
  findActiveMeeting: vi.fn(),
  createSingleUseLink: vi.fn(),
}))
vi.mock('../../server/services/auth-service', () => ({ verifyGoogleIdToken }))
vi.mock('../../server/services/calendly', () => ({ isConfigured, findActiveMeeting, createSingleUseLink }))

import meetingsRouter, { _resetMeetingLimiters } from '../../server/routes/meetings'

function app() {
  const a = express(); a.use(express.json()); a.use('/api/meetings', meetingsRouter); return a
}

const IDENTITY = { email: 'mk@example.com', sub: 'g1', name: 'ח"כ דוגמה' }

describe('POST /api/meetings/booking-link', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    _resetMeetingLimiters()
    verifyGoogleIdToken.mockResolvedValue(IDENTITY)
    isConfigured.mockResolvedValue(true)
    findActiveMeeting.mockResolvedValue(null)
    createSingleUseLink.mockResolvedValue('https://calendly.com/d/abc')
  })

  it('400 when idToken missing', async () => {
    const res = await request(app()).post('/api/meetings/booking-link').send({})
    expect(res.status).toBe(400)
  })

  it('401 when the Google token is invalid', async () => {
    verifyGoogleIdToken.mockRejectedValue(new Error('bad'))
    const res = await request(app()).post('/api/meetings/booking-link').send({ idToken: 'x' })
    expect(res.status).toBe(401)
  })

  it('409 not_configured when feature unconfigured', async () => {
    isConfigured.mockResolvedValue(false)
    const res = await request(app()).post('/api/meetings/booking-link').send({ idToken: 'x' })
    expect(res.status).toBe(409)
    expect(res.body.error).toBe('not_configured')
  })

  it('409 active_meeting with meeting details when one exists', async () => {
    findActiveMeeting.mockResolvedValue({ startTime: '2026-07-01T10:00:00Z', cancelUrl: 'c', rescheduleUrl: 'r' })
    const res = await request(app()).post('/api/meetings/booking-link').send({ idToken: 'x' })
    expect(res.status).toBe(409)
    expect(res.body).toEqual({
      error: 'active_meeting',
      meeting: { startTime: '2026-07-01T10:00:00Z', cancelUrl: 'c', rescheduleUrl: 'r' },
    })
    expect(findActiveMeeting).toHaveBeenCalledWith('mk@example.com')
  })

  it('200 with bookingUrl + verified identity on the happy path', async () => {
    const res = await request(app()).post('/api/meetings/booking-link').send({ idToken: 'x' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ bookingUrl: 'https://calendly.com/d/abc', name: 'ח"כ דוגמה', email: 'mk@example.com' })
  })

  it('502 when Calendly fails', async () => {
    createSingleUseLink.mockRejectedValue(new Error('calendly down'))
    const res = await request(app()).post('/api/meetings/booking-link').send({ idToken: 'x' })
    expect(res.status).toBe(502)
  })

  it('429 after the per-email burst budget is exhausted', async () => {
    const a = app()
    for (let i = 0; i < 5; i++) {
      const ok = await request(a).post('/api/meetings/booking-link').send({ idToken: 'x' })
      expect(ok.status).toBe(200)
    }
    const blocked = await request(a).post('/api/meetings/booking-link').send({ idToken: 'x' })
    expect(blocked.status).toBe(429)
  })
})
