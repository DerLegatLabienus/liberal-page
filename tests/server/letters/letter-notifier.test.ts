import { vi, describe, it, expect, beforeEach } from 'vitest'

const { batchMock, listMembers, listUnnotified, markNotified } = vi.hoisted(() => ({
  batchMock: vi.fn(), listMembers: vi.fn(), listUnnotified: vi.fn(), markNotified: vi.fn(),
}))
vi.mock('../../../server/services/email', () => ({ sendEmailsBatch: batchMock }))
vi.mock('../../../server/repositories/auth-repository', () => ({
  AuthRepository: vi.fn(() => ({ listMembersForAlerts: listMembers })),
}))
vi.mock('../../../server/repositories/letters-repository', () => ({
  LettersRepository: vi.fn(() => ({ listUnnotifiedPinned: listUnnotified, markPinNotified: markNotified })),
}))

import { notifyPinnedLetters } from '../../../server/services/letter-notifier'

describe('notifyPinnedLetters', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('does nothing when there are no unnotified pinned letters', async () => {
    listUnnotified.mockResolvedValue([])
    await notifyPinnedLetters()
    expect(listMembers).not.toHaveBeenCalled()
    expect(markNotified).not.toHaveBeenCalled()
  })

  it('does NOT stamp when there are no recipients (leaves them to retry)', async () => {
    listUnnotified.mockResolvedValue([{ id: 1, title: 'X' }])
    listMembers.mockResolvedValue([])
    await notifyPinnedLetters()
    expect(batchMock).not.toHaveBeenCalled()
    expect(markNotified).not.toHaveBeenCalled()
  })

  it('does NOT stamp when nothing was sent (email unconfigured / all failed)', async () => {
    listUnnotified.mockResolvedValue([{ id: 1, title: 'X' }])
    listMembers.mockResolvedValue([{ email: 'a@x.com', name: 'A' }])
    batchMock.mockResolvedValue({ sent: 0, failed: 0, skipped: 1 })
    await notifyPinnedLetters()
    expect(batchMock).toHaveBeenCalledTimes(1)
    expect(markNotified).not.toHaveBeenCalled()
  })

  it('stamps pin_notified_at for all pinned letters once at least one email is sent', async () => {
    listUnnotified.mockResolvedValue([{ id: 1, title: 'X' }, { id: 2, title: 'Y' }])
    listMembers.mockResolvedValue([{ email: 'a@x.com', name: 'A' }])
    batchMock.mockResolvedValue({ sent: 1, failed: 0, skipped: 0 })
    await notifyPinnedLetters()
    expect(markNotified).toHaveBeenCalledWith([1, 2])
  })
})
