import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const getAll = vi.hoisted(() => vi.fn())
const update = vi.hoisted(() => vi.fn())
vi.mock('../../server/repositories/email-templates-repository', () => ({
  EmailTemplatesRepository: vi.fn().mockImplementation(() => ({ getAll, update })),
}))
vi.mock('../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../server/services/email', () => ({ sendEmail: vi.fn() }))
vi.mock('../../server/middleware/auth', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  requireAdmin: (req: any, _res: any, next: any) => { req.user = { id: 1, role: 'admin' }; next() },
}))

import adminRouter from '../../server/routes/admin'

function app() { const a = express(); a.use(express.json()); a.use('/api/admin', adminRouter); return a }

describe('admin email-template routes', () => {
  beforeEach(() => vi.clearAllMocks())

  it('lists templates', async () => {
    getAll.mockResolvedValue([{ name: 'invite', subject: 'S', html: 'H' }])
    const res = await request(app()).get('/api/admin/email-templates')
    expect(res.status).toBe(200)
    expect(res.body.templates).toEqual([{ name: 'invite', subject: 'S', html: 'H' }])
  })

  it('updates a template', async () => {
    update.mockResolvedValue(undefined)
    const res = await request(app()).put('/api/admin/email-templates/invite').send({ subject: 'X', html: '<p>Y</p>' })
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalledWith('invite', { subject: 'X', html: '<p>Y</p>' })
  })

  it('rejects an update missing fields with 400', async () => {
    const res = await request(app()).put('/api/admin/email-templates/invite').send({ subject: 'only' })
    expect(res.status).toBe(400)
    expect(update).not.toHaveBeenCalled()
  })
})
