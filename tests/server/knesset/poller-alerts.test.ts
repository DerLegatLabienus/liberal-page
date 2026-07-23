import { describe, it, expect, beforeEach, vi } from 'vitest'

const { findAlertRecipients, renderFragment, sendEmailsBatch } = vi.hoisted(() => ({
  findAlertRecipients: vi.fn(),
  renderFragment: vi.fn().mockResolvedValue('<li>item</li>'),
  sendEmailsBatch: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../server/repositories/tracked-bills-repository', () => ({
  TrackedBillsRepository: vi.fn().mockImplementation(() => ({ findAlertRecipients })),
}))
vi.mock('../../server/services/email-render', () => ({ renderFragment }))
vi.mock('../../server/services/email', () => ({ sendEmailsBatch }))

import { sendBillAlerts } from '../../server/services/poller'

const CH = (billId: number) => ({ billId, title: `t${billId}`, oldStatus: 'a', newStatus: 'b', knessetUrl: 'u' })

describe('sendBillAlerts', () => {
  beforeEach(() => vi.clearAllMocks())

  it('sends one grouped digest per recipient user', async () => {
    findAlertRecipients.mockResolvedValue([
      { userId: 1, email: 'one@x.com', name: 'One', billId: 10 },
      { userId: 1, email: 'one@x.com', name: 'One', billId: 11 },
      { userId: 2, email: 'two@x.com', name: 'Two', billId: 10 },
    ])
    await sendBillAlerts([CH(10), CH(11)])
    expect(sendEmailsBatch).toHaveBeenCalledTimes(1)
    const messages = sendEmailsBatch.mock.calls[0][0]
    expect(messages).toHaveLength(2)
    const u1 = messages.find((m: { to: string; template: string; params: Record<string, string>; raw?: string[] }) => m.to === 'one@x.com')
    expect(u1.params.count).toBe('2')
    expect(u1.template).toBe('bill_digest')
    expect(u1.raw).toContain('bills')
  })

  it('does nothing when there are no changes', async () => {
    await sendBillAlerts([])
    expect(findAlertRecipients).not.toHaveBeenCalled()
    expect(sendEmailsBatch).not.toHaveBeenCalled()
  })

  it('does nothing when no one is tracking the changed bills', async () => {
    findAlertRecipients.mockResolvedValue([])
    await sendBillAlerts([CH(10)])
    expect(sendEmailsBatch).not.toHaveBeenCalled()
  })
})
