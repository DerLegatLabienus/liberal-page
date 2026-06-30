import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

const sendMock = vi.fn()
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send: sendMock })),
  PutObjectCommand: vi.fn((input) => ({ __type: 'Put', input })),
  DeleteObjectCommand: vi.fn((input) => ({ __type: 'Delete', input })),
}))

import * as r2 from '../../server/services/r2-client'

const ENV = { ...process.env }
beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({})
  process.env.R2_ENDPOINT = 'https://acc.r2.cloudflarestorage.com'
  process.env.R2_ACCESS_KEY_ID = 'k'
  process.env.R2_SECRET_ACCESS_KEY = 's'
  process.env.R2_BUCKET = 'prod'
  process.env.R2_PUBLIC_BASE_URL = 'https://pub-x.r2.dev/'
})
afterEach(() => { process.env = { ...ENV } })

describe('r2-client', () => {
  it('isConfigured true when all env present, false when one missing', () => {
    expect(r2.isConfigured()).toBe(true)
    delete process.env.R2_BUCKET
    expect(r2.isConfigured()).toBe(false)
  })

  it('publicUrl joins base + key and strips a trailing slash on the base', () => {
    expect(r2.publicUrl('letters/abc.png')).toBe('https://pub-x.r2.dev/letters/abc.png')
  })

  it('putObject sends a PutObjectCommand with bucket/key/body/content-type', async () => {
    await r2.putObject('letters/abc.png', Buffer.from([1, 2, 3]), 'image/png')
    expect(sendMock).toHaveBeenCalledTimes(1)
    const cmd = sendMock.mock.calls[0][0]
    expect(cmd.input).toMatchObject({ Bucket: 'prod', Key: 'letters/abc.png', ContentType: 'image/png' })
  })

  it('throws R2NotConfiguredError when env missing', async () => {
    delete process.env.R2_ACCESS_KEY_ID
    await expect(r2.putObject('k', Buffer.from([1]), 'image/png')).rejects.toBeInstanceOf(r2.R2NotConfiguredError)
  })
})
