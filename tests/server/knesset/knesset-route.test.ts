import { vi, describe, it, expect, beforeEach } from 'vitest'
import request from 'supertest'
import express from 'express'

vi.mock('../../server/services/knesset-config', () => ({
  getCurrentKnesset: vi.fn().mockReturnValue(25),
  detectKnessetTransition: vi.fn().mockResolvedValue(false),
  runTransition: vi.fn().mockResolvedValue(undefined),
}))

import knessetRouter from '../../server/routes/knesset'
import { detectKnessetTransition, runTransition, getCurrentKnesset } from '../../server/services/knesset-config'

const app = express()
app.use(express.json())
app.use('/api/knesset', knessetRouter)

describe('POST /api/knesset/transition', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns { transitioned: false } when no transition detected', async () => {
    vi.mocked(detectKnessetTransition).mockResolvedValueOnce(false)
    const res = await request(app).post('/api/knesset/transition')
    expect(res.status).toBe(200)
    expect(res.body.transitioned).toBe(false)
    expect(res.body.from).toBe(25)
  })

  it('returns { transitioned: true } when transition detected', async () => {
    vi.mocked(detectKnessetTransition).mockResolvedValueOnce(true)
    vi.mocked(getCurrentKnesset).mockReturnValueOnce(25).mockReturnValueOnce(26)
    const res = await request(app).post('/api/knesset/transition')
    expect(res.status).toBe(200)
    expect(res.body.transitioned).toBe(true)
  })

  it('?force=26 bypasses OData and calls runTransition(26)', async () => {
    const res = await request(app).post('/api/knesset/transition?force=26')
    expect(res.status).toBe(200)
    expect(runTransition).toHaveBeenCalledWith(26)
    expect(detectKnessetTransition).not.toHaveBeenCalled()
  })

  it('returns 400 when ?force is not a valid number', async () => {
    const res = await request(app).post('/api/knesset/transition?force=abc')
    expect(res.status).toBe(400)
  })
})
