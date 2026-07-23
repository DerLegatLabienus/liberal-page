import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { findUserById, setEmailAlerts, setName } = vi.hoisted(() => ({
  findUserById: vi.fn(),
  setEmailAlerts: vi.fn(),
  setName: vi.fn(),
}))
vi.mock('../../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({ findUserById, setEmailAlerts, setName })),
}))
vi.mock('../../../server/middleware/auth', () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => { req.user = { id: 7, role: 'member' }; next() },
}))
vi.mock('../../../server/services/auth-service', () => ({
  verifyGoogleIdToken: vi.fn(), issueAccessToken: vi.fn(), issueRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(), revokeRefreshToken: vi.fn(),
}))

import authRouter from '../../../server/routes/auth'

function app() { const a = express(); a.use(express.json()); a.use('/api/auth', authRouter); return a }

describe('PATCH /api/auth/me', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates emailAlerts and returns the updated user', async () => {
    setEmailAlerts.mockResolvedValue(undefined)
    findUserById.mockResolvedValue({ id: 7, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: false })
    const res = await request(app()).patch('/api/auth/me').send({ emailAlerts: false })
    expect(res.status).toBe(200)
    expect(setEmailAlerts).toHaveBeenCalledWith(7, false)
    expect(res.body.user).toEqual({ id: 7, email: 'a@x.com', name: 'A', role: 'member', emailAlerts: false })
  })

  it('rejects a non-boolean emailAlerts with 400', async () => {
    const res = await request(app()).patch('/api/auth/me').send({ emailAlerts: 'nope' })
    expect(res.status).toBe(400)
    expect(setEmailAlerts).not.toHaveBeenCalled()
  })

  it('updates the display name (trimmed) and returns the updated user', async () => {
    setName.mockResolvedValue(undefined)
    findUserById.mockResolvedValue({ id: 7, email: 'a@x.com', name: 'New Name', role: 'member', emailAlerts: true })
    const res = await request(app()).patch('/api/auth/me').send({ name: '  New Name  ' })
    expect(res.status).toBe(200)
    expect(setName).toHaveBeenCalledWith(7, 'New Name')
    expect(res.body.user.name).toBe('New Name')
  })

  it('rejects an empty or over-long name with 400', async () => {
    const empty = await request(app()).patch('/api/auth/me').send({ name: '   ' })
    expect(empty.status).toBe(400)
    const tooLong = await request(app()).patch('/api/auth/me').send({ name: 'x'.repeat(81) })
    expect(tooLong.status).toBe(400)
    expect(setName).not.toHaveBeenCalled()
  })

  it('rejects an empty body (neither field) with 400', async () => {
    const res = await request(app()).patch('/api/auth/me').send({})
    expect(res.status).toBe(400)
    expect(setEmailAlerts).not.toHaveBeenCalled()
    expect(setName).not.toHaveBeenCalled()
  })
})
