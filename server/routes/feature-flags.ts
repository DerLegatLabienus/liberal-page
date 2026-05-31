import { Router } from 'express'
import { FeatureFlagsRepository } from '../repositories/feature-flags-repository'

const router = Router()
const repo = new FeatureFlagsRepository()

router.get('/', async (_req, res) => {
  try { res.json(await repo.getAll()) }
  catch (err) { console.error('feature-flags error:', err); res.status(500).json({ error: 'Server error' }) }
})

export default router
