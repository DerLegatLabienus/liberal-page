import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { setFlag } = vi.hoisted(() => ({ setFlag: vi.fn() }))
vi.mock('../../../server/repositories/feature-flags-repository', () => ({
  FeatureFlagsRepository: vi.fn().mockImplementation(() => ({ setFlag, getAll: vi.fn() })),
}))
vi.mock('../../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../../server/repositories/email-templates-repository', () => ({
  EmailTemplatesRepository: vi.fn().mockImplementation(() => ({})),
}))
vi.mock('../../../server/services/email', () => ({ sendEmail: vi.fn() }))
vi.mock('../../../server/middleware/auth', () => ({
  requireAdmin: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 1, role: 'admin' }; next()
  },
}))

import adminRouter from '../../../server/routes/admin'

function app() { const a = express(); a.use(express.json()); a.use('/api/admin', adminRouter); return a }

describe('PUT /api/admin/feature-flags/:name', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates a flag', async () => {
    setFlag.mockResolvedValue(undefined)
    const res = await request(app())
      .put('/api/admin/feature-flags/meetUs')
      .send({ enabled: true, value: 'https://api.calendly.com/event_types/ET1' })
    expect(res.status).toBe(200)
    expect(setFlag).toHaveBeenCalledWith('meetUs', true, 'https://api.calendly.com/event_types/ET1')
  })

  it('accepts a null value', async () => {
    setFlag.mockResolvedValue(undefined)
    const res = await request(app()).put('/api/admin/feature-flags/x').send({ enabled: false, value: null })
    expect(res.status).toBe(200)
    expect(setFlag).toHaveBeenCalledWith('x', false, null)
  })

  it('400 when enabled is not boolean', async () => {
    const res = await request(app()).put('/api/admin/feature-flags/x').send({ enabled: 'yes', value: null })
    expect(res.status).toBe(400)
    expect(setFlag).not.toHaveBeenCalled()
  })
})
