/**
 * Pure decision logic for committee closure detection.
 *
 * A tracked committee is "closed" when its Knesset CommitteeID (oknesset_id) is
 * absent from the fresh active list (IsCurrent eq true). It is "reactivated" when
 * a previously-inactive id reappears. The match is on identical id, so a change can
 * only ever affect the exact same entity.
 *
 * Safety guard: if the active list is implausibly short (fewer than `minActive`
 * committees — a likely sign of a failed/truncated upstream fetch), no changes are
 * proposed. A flag only ever changes from positive confirmation against a
 * trustworthy list.
 */

export const MIN_ACTIVE_COMMITTEES = 10

export interface TrackedCommitteeStatus {
  oknessetId: string
  inactive: boolean
}

export interface StatusChanges {
  deactivate: string[]
  reactivate: string[]
}

export function computeStatusChanges(
  tracked: TrackedCommitteeStatus[],
  activeIds: Set<number>,
  minActive: number,
): StatusChanges {
  if (activeIds.size < minActive) {
    return { deactivate: [], reactivate: [] }
  }

  const deactivate: string[] = []
  const reactivate: string[] = []

  for (const { oknessetId, inactive } of tracked) {
    const isActive = activeIds.has(Number(oknessetId))
    if (isActive && inactive) {
      reactivate.push(oknessetId)
    } else if (!isActive && !inactive) {
      deactivate.push(oknessetId)
    }
  }

  return { deactivate, reactivate }
}
