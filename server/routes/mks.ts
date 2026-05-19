import { Router } from 'express'
import { fetchAllKnessetMembers } from '../services/knesset-members'
import { fetchMkActivity } from '../services/knesset-scraper'
import { MkListRepository } from '../repositories/mk-list-repository'
import { MkAnnotationsRepository } from '../repositories/mk-annotations-repository'
import type { KnessetMember } from '../../src/types'

const router = Router()
const mkListRepo = new MkListRepository()
const annotationsRepo = new MkAnnotationsRepository()
const CACHE_TTL_MS = 24 * 60 * 60 * 1000

router.get('/list', async (_req, res) => {
  try {
    const cached = await mkListRepo.get()
    if (cached && mkListRepo.getAgeMs() < CACHE_TTL_MS) {
      return res.json(cached)
    }
    const members = await fetchAllKnessetMembers()
    const annotations = await annotationsRepo.getAll()
    const annotated: KnessetMember[] = members.map((m) => ({
      ...m,
      isLiberal: annotations[String(m.siteId)]?.isLiberal ?? false,
      isSupporter: annotations[String(m.siteId)]?.isSupporter ?? false,
    }))
    await mkListRepo.set(annotated)
    res.json(annotated)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

router.get('/activity', async (req, res) => {
  const siteId = parseInt(req.query.siteId as string, 10)
  if (!siteId || isNaN(siteId)) return res.status(400).json({ error: 'siteId required' })
  try {
    const activity = await fetchMkActivity(siteId, 10)
    res.json(activity)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : 'Server error' })
  }
})

export default router
