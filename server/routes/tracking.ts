import { Router } from 'express'

const router = Router()

router.post('/add', (_req, res) => {
  res.json({ ok: true, message: 'stub' })
})

router.delete('/:type/:id', (_req, res) => {
  res.json({ ok: true, message: 'stub' })
})

export default router
