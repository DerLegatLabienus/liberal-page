import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const verify = vi.fn()
vi.mock('svix', () => ({ Webhook: vi.fn().mockImplementation(() => ({ verify })) }))

import webhooksRouter from '../../server/routes/webhooks'

function app() { const a = express(); a.use('/api/webhooks', webhooksRouter); return a }

describe('POST /api/webhooks/resend', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.RESEND_WEBHOOK_SECRET = 'whsec_x' })

  it('logs a redacted line and returns 200 on a verified event', async () => {
    verify.mockReturnValue({ type: 'email.bounced', data: { email_id: 're_9', to: ['avivavitan63@gmail.com'] } })
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const res = await request(app())
      .post('/api/webhooks/resend')
      .set('svix-id', 'a').set('svix-timestamp', 'b').set('svix-signature', 'c')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ any: 'thing' }))
    expect(res.status).toBe(200)
    const logged = info.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('event=bounced')
    expect(logged).toContain('avivavitan63@…')
    expect(logged).toContain('re_9')
    expect(logged).not.toContain('gmail.com')
    info.mockRestore()
  })

  it('returns 400 on a bad signature', async () => {
    verify.mockImplementation(() => { throw new Error('bad sig') })
    const res = await request(app())
      .post('/api/webhooks/resend')
      .set('content-type', 'application/json')
      .send(JSON.stringify({ any: 'thing' }))
    expect(res.status).toBe(400)
  })
})
