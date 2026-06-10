import { describe, it, expect, beforeEach, vi } from 'vitest'
import express from 'express'
import request from 'supertest'

const { findUserById, setEmailAlerts } = vi.hoisted(() => ({
  findUserById: vi.fn(),
  setEmailAlerts: vi.fn(),
}))
vi.mock('../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn().mockImplementation(() => ({ findUserById, setEmailAlerts })),
}))
vi.mock('../../server/middleware/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.user = { id: 7, role: 'member' }; next() },
}))
vi.mock('../../server/services/auth-service', () => ({
  verifyGoogleIdToken: vi.fn(), issueAccessToken: vi.fn(), issueRefreshToken: vi.fn(),
  rotateRefreshToken: vi.fn(), revokeRefreshToken: vi.fn(),
}))

import authRouter from '../../server/routes/auth'

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

  it('rejects a non-boolean body with 400', async () => {
    const res = await request(app()).patch('/api/auth/me').send({ emailAlerts: 'nope' })
    expect(res.status).toBe(400)
    expect(setEmailAlerts).not.toHaveBeenCalled()
  })
})
