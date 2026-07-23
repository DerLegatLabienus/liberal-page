import { describe, it, expect, beforeEach, vi } from 'vitest'

const { getResend, listPollable, setStatus } = vi.hoisted(() => ({
  getResend: vi.fn(),
  listPollable: vi.fn(),
  setStatus: vi.fn(),
}))

vi.mock('../../server/services/email', () => ({ getResend }))
vi.mock('../../server/repositories/sent-emails-repository', () => ({
  SentEmailsRepository: vi.fn().mockImplementation(() => ({ listPollable, setStatus })),
}))

import { pollDeliveryStatus, TERMINAL_STATUSES } from '../../server/services/email-delivery-poll'

function fakeResend(lastEventById: Record<string, string>) {
  return { emails: { get: vi.fn(async (id: string) => ({ data: { last_event: lastEventById[id] }, error: null })) } }
}

describe('pollDeliveryStatus', () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.EMAIL_STATUS_POLL_CAP })

  it('no-ops when RESEND_API_KEY is unset (getResend null)', async () => {
    getResend.mockReturnValue(null)
    await pollDeliveryStatus()
    expect(listPollable).not.toHaveBeenCalled()
  })

  it('advances status and logs on change', async () => {
    const client = fakeResend({ re_1: 'delivered' })
    getResend.mockReturnValue(client)
    listPollable.mockResolvedValue([{ id: 're_1', toEmail: 'avivavitan63@gmail.com', status: 'sent' }])
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})

    await pollDeliveryStatus()

    expect(listPollable).toHaveBeenCalledWith(TERMINAL_STATUSES, expect.any(Date), 101)
    expect(setStatus).toHaveBeenCalledWith('re_1', 'delivered', expect.any(Date))
    const logged = info.mock.calls.map((c) => c.join(' ')).join('\n')
    expect(logged).toContain('event=delivered')
    expect(logged).toContain('avivavitan63@…')
    expect(logged).not.toContain('gmail.com')
    info.mockRestore()
  })

  it('does not update when the status is unchanged', async () => {
    getResend.mockReturnValue(fakeResend({ re_1: 'sent' }))
    listPollable.mockResolvedValue([{ id: 're_1', toEmail: 'a@x.com', status: 'sent' }])
    await pollDeliveryStatus()
    expect(setStatus).not.toHaveBeenCalled()
  })

  it('caps the batch and warns when the backlog exceeds the cap', async () => {
    process.env.EMAIL_STATUS_POLL_CAP = '2'
    const client = fakeResend({ a: 'delivered', b: 'delivered', c: 'delivered' })
    getResend.mockReturnValue(client)
    // cap=2 → service requests limit 3; we return 3 → over cap.
    listPollable.mockResolvedValue([
      { id: 'a', toEmail: 'a@x.com', status: 'sent' },
      { id: 'b', toEmail: 'b@x.com', status: 'sent' },
      { id: 'c', toEmail: 'c@x.com', status: 'sent' },
    ])
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await pollDeliveryStatus()

    expect(listPollable).toHaveBeenCalledWith(TERMINAL_STATUSES, expect.any(Date), 3)
    expect(warn).toHaveBeenCalled()
    expect(client.emails.get).toHaveBeenCalledTimes(2) // only the first `cap` rows processed
    warn.mockRestore()
  })

  it('skips a row whose retrieve fails without throwing', async () => {
    const client = { emails: { get: vi.fn().mockRejectedValue(new Error('boom')) } }
    getResend.mockReturnValue(client)
    listPollable.mockResolvedValue([{ id: 're_1', toEmail: 'a@x.com', status: 'sent' }])
    await expect(pollDeliveryStatus()).resolves.toBeUndefined()
    expect(setStatus).not.toHaveBeenCalled()
  })
})
