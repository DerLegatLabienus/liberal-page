import { Router } from 'express'
import { getCurrentKnesset, detectKnessetTransition, runTransition } from '../services/knesset-config'

const router = Router()

router.post('/transition', async (req, res) => {
  const forceParam = req.query.force as string | undefined

  if (forceParam !== undefined) {
    const forceNum = parseInt(forceParam, 10)
    if (isNaN(forceNum) || forceNum < 1) {
      return res.status(400).json({ error: 'force must be a valid Knesset number' })
    }
    const from = getCurrentKnesset()
    await runTransition(forceNum)
    return res.json({ transitioned: true, forced: true, from, to: forceNum })
  }

  const from = getCurrentKnesset()
  try {
    const transitioned = await detectKnessetTransition()
    const to = getCurrentKnesset()
    res.json({ transitioned, from, to })
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
