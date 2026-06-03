import { Router } from 'express'
import type { TrackingType } from '../../src/types'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { TrackedCommitteesRepository } from '../repositories/tracked-committees-repository'
import { TrackedMksRepository } from '../repositories/tracked-mks-repository'
import { getCurrentKnesset } from '../services/knesset-config'
import { optionalAuth } from '../middleware/auth'
import { resolveReadScope } from '../services/tracking-scope'

const router = Router()
const trackedBills = new TrackedBillsRepository()
const trackedCommittees = new TrackedCommitteesRepository()
const trackedMks = new TrackedMksRepository()

// Default scope is the public group list; `?scope=personal` returns the caller's list.
router.get('/:type', optionalAuth, async (req, res) => {
  const type = req.params.type as TrackingType
  try {
    const scope = await resolveReadScope(req)
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error })
    const userId = scope.userId
    if (type === 'bill') return res.json(await trackedBills.getAll(userId, getCurrentKnesset()))
    if (type === 'committee') return res.json(await trackedCommittees.getAll(userId))
    if (type === 'mk') return res.json(await trackedMks.getAll(userId, getCurrentKnesset()))
    return res.status(400).json({ error: 'סוג לא ידוע' })
  } catch (err) {
    console.error('parliament read error:', err)
    res.status(500).json({ error: 'שגיאה בקריאת נתונים' })
  }
})

export default router
