import { Router } from 'express'

const router = Router()

router.get('/:type', (req, res) => {
  res.json({ type: req.params.type, items: [], stub: true })
})

export default router
