import { describe, it, expect } from 'vitest'
import { computeStatusChanges, MIN_ACTIVE_COMMITTEES } from '../../../server/services/committee-status'

// A trustworthy active list well above the safety floor.
function activeSet(extra: number[] = []): Set<number> {
  const ids = Array.from({ length: MIN_ACTIVE_COMMITTEES }, (_, i) => 1000 + i)
  return new Set([...ids, ...extra])
}

describe('computeStatusChanges', () => {
  it('marks a tracked active committee inactive when its id is absent from the active list', () => {
    const tracked = [{ oknessetId: '777', inactive: false }]
    const { deactivate, reactivate } = computeStatusChanges(tracked, activeSet(), MIN_ACTIVE_COMMITTEES)
    expect(deactivate).toEqual(['777'])
    expect(reactivate).toEqual([])
  })

  it('reactivates a tracked inactive committee when its id reappears in the active list', () => {
    const tracked = [{ oknessetId: '1003', inactive: true }]
    const { deactivate, reactivate } = computeStatusChanges(tracked, activeSet(), MIN_ACTIVE_COMMITTEES)
    expect(reactivate).toEqual(['1003'])
    expect(deactivate).toEqual([])
  })

  it('does nothing when the active list is below the safety floor', () => {
    const tracked = [{ oknessetId: '777', inactive: false }]
    const tooShort = new Set([1000, 1001, 1002]) // < MIN_ACTIVE_COMMITTEES
    const { deactivate, reactivate } = computeStatusChanges(tracked, tooShort, MIN_ACTIVE_COMMITTEES)
    expect(deactivate).toEqual([])
    expect(reactivate).toEqual([])
  })

  it('does not re-flag an already-inactive committee that is still absent', () => {
    const tracked = [{ oknessetId: '777', inactive: true }]
    const { deactivate, reactivate } = computeStatusChanges(tracked, activeSet(), MIN_ACTIVE_COMMITTEES)
    expect(deactivate).toEqual([])
    expect(reactivate).toEqual([])
  })

  it('does not re-flag an already-active committee that is still present', () => {
    const tracked = [{ oknessetId: '1005', inactive: false }]
    const { deactivate, reactivate } = computeStatusChanges(tracked, activeSet(), MIN_ACTIVE_COMMITTEES)
    expect(deactivate).toEqual([])
    expect(reactivate).toEqual([])
  })

  it('ignores committees with an empty/non-numeric oknesset_id', () => {
    const tracked = [
      { oknessetId: '', inactive: false },
      { oknessetId: 'abc', inactive: false },
    ]
    const { deactivate, reactivate } = computeStatusChanges(tracked, activeSet(), MIN_ACTIVE_COMMITTEES)
    expect(deactivate).toEqual([])
    expect(reactivate).toEqual([])
  })

  it('handles a mix of changes in one pass', () => {
    const tracked = [
      { oknessetId: '1001', inactive: true },  // present + inactive → reactivate
      { oknessetId: '888', inactive: false },  // absent + active   → deactivate
      { oknessetId: '1002', inactive: false }, // present + active   → no change
    ]
    const { deactivate, reactivate } = computeStatusChanges(tracked, activeSet(), MIN_ACTIVE_COMMITTEES)
    expect(deactivate).toEqual(['888'])
    expect(reactivate).toEqual(['1001'])
  })
})
