import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { sendEmailMock, addInviteMock } = vi.hoisted(() => ({
  sendEmailMock: vi.fn(),
  addInviteMock: vi.fn(),
}))

vi.mock('../../../server/services/email', () => ({ sendEmail: sendEmailMock }))

vi.mock('../../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({
    addInvite: addInviteMock, listInvites: vi.fn(), removeInvite: vi.fn(),
    listUsers: vi.fn(), findUserById: vi.fn(), countAdmins: vi.fn(), setUserRole: vi.fn(),
  })),
}))

vi.mock('../../../server/middleware/auth', () => ({
  requireAdmin: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.user = { id: 1, role: 'admin' }; next() },
}))

import adminRouter from '../../../server/routes/admin'

function app() {
  const a = express(); a.use(express.json()); a.use('/api/admin', adminRouter); return a
}

describe('POST /api/admin/invites email', () => {
  beforeEach(() => { vi.clearAllMocks(); process.env.PUBLIC_SITE_URL = 'https://site' })

  it('sends the invite email then adds the invite on success', async () => {
    sendEmailMock.mockResolvedValue({ status: 'sent', id: 're_1' })
    addInviteMock.mockResolvedValue(undefined)
    const res = await request(app()).post('/api/admin/invites').send({ email: 'New@X.com', role: 'member' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({
      to: 'new@x.com', template: 'invite', params: expect.objectContaining({ siteUrl: 'https://site' }),
    }))
    expect(addInviteMock).toHaveBeenCalledWith('new@x.com', 'member', 1)
  })

  it('adds the invite even when email is not configured (skipped)', async () => {
    sendEmailMock.mockResolvedValue({ status: 'skipped' })
    addInviteMock.mockResolvedValue(undefined)
    const res = await request(app()).post('/api/admin/invites').send({ email: 'a@x.com' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true })
    expect(addInviteMock).toHaveBeenCalledWith('a@x.com', 'member', 1)
  })

  it('returns 502 and does NOT add the invite when the send fails (atomic)', async () => {
    sendEmailMock.mockResolvedValue({ status: 'failed', error: 'mail down' })
    const res = await request(app()).post('/api/admin/invites').send({ email: 'a@x.com' })
    expect(res.status).toBe(502)
    expect(addInviteMock).not.toHaveBeenCalled()
  })
})
