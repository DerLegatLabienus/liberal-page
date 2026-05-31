import { Router } from 'express'
import type { TrackingType } from '../../src/types'
import { UsersRepository } from '../repositories/users-repository'
import { TrackedBillsRepository } from '../repositories/tracked-bills-repository'
import { TrackedCommitteesRepository } from '../repositories/tracked-committees-repository'
import { TrackedMksRepository } from '../repositories/tracked-mks-repository'
import { getCurrentKnesset } from '../services/knesset-config'

const router = Router()
const users = new UsersRepository()
const trackedBills = new TrackedBillsRepository()
const trackedCommittees = new TrackedCommitteesRepository()
const trackedMks = new TrackedMksRepository()

router.get('/:type', async (req, res) => {
  const type = req.params.type as TrackingType
  try {
    const userId = await users.getSharedUserId()
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
