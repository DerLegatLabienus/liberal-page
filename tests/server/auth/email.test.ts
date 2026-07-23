import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendMock = vi.fn()
const batchMock = vi.fn()
vi.mock('resend', () => ({ Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock }, batch: { send: batchMock } })) }))

const recordMock = vi.fn()
vi.mock('../../../server/repositories/sent-emails-repository', () => ({
  SentEmailsRepository: vi.fn().mockImplementation(() => ({ record: recordMock })),
}))

vi.mock('../../../server/services/email-render', () => ({
  renderTemplate: vi.fn().mockResolvedValue({ subject: 'S', html: '<p>H</p>' }),
}))

import { sendEmail, sendEmailsThrottled, sendEmailsBatch, _resetResend } from '../../../server/services/email'

describe('sendEmail', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetResend(); delete process.env.RESEND_API_KEY; process.env.EMAIL_FROM = 'F <f@x.com>' })

  it('returns skipped (and no client/record) when RESEND_API_KEY is unset', async () => {
    const result = await sendEmail({ to: 'a@x.com', template: 'invite', params: {} })
    expect(result).toEqual({ status: 'skipped' })
    expect(sendMock).not.toHaveBeenCalled()
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('sends, records "sent", and returns the Resend id when keyed', async () => {
    process.env.RESEND_API_KEY = 're_test'
    sendMock.mockResolvedValue({ data: { id: 're_123' }, error: null })
    const result = await sendEmail({ to: 'a@x.com', template: 'invite', params: {} })
    expect(result).toEqual({ status: 'sent', id: 're_123' })
    expect(sendMock).toHaveBeenCalledWith(expect.objectContaining({ from: 'F <f@x.com>', to: 'a@x.com', subject: 'S', html: '<p>H</p>' }))
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ id: 're_123', toEmail: 'a@x.com', template: 'invite', status: 'sent' }))
  })

  it('returns failed (and records "failed") without throwing when send rejects', async () => {
    process.env.RESEND_API_KEY = 're_test'
    sendMock.mockRejectedValue(new Error('boom'))
    const result = await sendEmail({ to: 'a@x.com', template: 'invite', params: {} })
    expect(result).toMatchObject({ status: 'failed' })
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed', template: 'invite' }))
  })

  it('sendEmailsThrottled sends each message in order', async () => {
    process.env.RESEND_API_KEY = 're_test'
    sendMock.mockResolvedValue({ data: { id: 're_x' }, error: null })
    await sendEmailsThrottled([
      { to: '1@x.com', template: 'bill_digest', params: {} },
      { to: '2@x.com', template: 'bill_digest', params: {} },
    ])
    expect(sendMock).toHaveBeenCalledTimes(2)
    expect(sendMock.mock.calls[0][0].to).toBe('1@x.com')
    expect(sendMock.mock.calls[1][0].to).toBe('2@x.com')
  })
})

describe('sendEmailsBatch', () => {
  beforeEach(() => { vi.clearAllMocks(); _resetResend(); delete process.env.RESEND_API_KEY; process.env.EMAIL_FROM = 'F <f@x.com>' })

  it('skips (counts skipped, no batch call/record) when RESEND_API_KEY is unset', async () => {
    const out = await sendEmailsBatch([
      { to: '1@x.com', template: 'letter_pin', params: {} },
      { to: '2@x.com', template: 'letter_pin', params: {} },
    ])
    expect(out).toEqual({ sent: 0, failed: 0, skipped: 2 })
    expect(batchMock).not.toHaveBeenCalled()
    expect(recordMock).not.toHaveBeenCalled()
  })

  it('sends one batch request for many messages and records each as sent', async () => {
    process.env.RESEND_API_KEY = 're_test'
    batchMock.mockResolvedValue({ data: { data: [{ id: 're_a' }, { id: 're_b' }] }, error: null })
    const out = await sendEmailsBatch([
      { to: '1@x.com', template: 'letter_pin', params: {} },
      { to: '2@x.com', template: 'letter_pin', params: {} },
    ])
    expect(out).toEqual({ sent: 2, failed: 0, skipped: 0 })
    expect(batchMock).toHaveBeenCalledTimes(1)
    expect(batchMock.mock.calls[0][0]).toHaveLength(2)
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ id: 're_a', toEmail: '1@x.com', status: 'sent' }))
  })

  it('counts all as failed (and records failed) when the batch call rejects', async () => {
    process.env.RESEND_API_KEY = 're_test'
    batchMock.mockRejectedValue(new Error('boom'))
    const out = await sendEmailsBatch([{ to: '1@x.com', template: 'letter_pin', params: {} }])
    expect(out).toMatchObject({ sent: 0, failed: 1 })
    expect(recordMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('chunks into requests of at most 100', async () => {
    process.env.RESEND_API_KEY = 're_test'
    batchMock.mockResolvedValue({ data: { data: [] }, error: null })
    const msgs = Array.from({ length: 150 }, (_, i) => ({ to: `${i}@x.com`, template: 'letter_pin', params: {} }))
    await sendEmailsBatch(msgs)
    expect(batchMock).toHaveBeenCalledTimes(2)
    expect(batchMock.mock.calls[0][0]).toHaveLength(100)
    expect(batchMock.mock.calls[1][0]).toHaveLength(50)
  })
})
