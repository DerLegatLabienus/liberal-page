import { Router } from 'express'

const router = Router()

router.post('/', (_req, res) => {
  res.json({ summary: null, stub: true })
})

export default router
