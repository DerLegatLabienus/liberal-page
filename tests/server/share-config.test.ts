import { describe, it, expect, afterEach } from 'vitest'
import { getShareConfig, isShareConfigured } from '../../server/services/share-config'

const KEYS = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL', 'APP_PUBLIC_URL']
const saved: Record<string, string | undefined> = {}
for (const k of KEYS) saved[k] = process.env[k]
afterEach(() => { for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k] } })

describe('share-config', () => {
  it('is not configured when R2 env vars are missing', () => {
    for (const k of KEYS) delete process.env[k]
    expect(isShareConfigured()).toBe(false)
    expect(getShareConfig().r2).toBeNull()
  })

  it('is configured when all R2 vars + public base url are set', () => {
    process.env.R2_ACCOUNT_ID = 'acct'
    process.env.R2_ACCESS_KEY_ID = 'akid'
    process.env.R2_SECRET_ACCESS_KEY = 'secret'
    process.env.R2_BUCKET = 'share'
    process.env.R2_PUBLIC_BASE_URL = 'https://share.example.org/'
    const cfg = getShareConfig()
    expect(isShareConfigured()).toBe(true)
    expect(cfg.r2).toEqual({ accountId: 'acct', accessKeyId: 'akid', secretAccessKey: 'secret', bucket: 'share' })
    expect(cfg.publicBaseUrl).toBe('https://share.example.org') // trailing slash trimmed
  })

  it('defaults appBaseUrl to the GitHub Pages URL', () => {
    delete process.env.APP_PUBLIC_URL
    expect(getShareConfig().appBaseUrl).toBe('https://derlegatlabienus.github.io/liberal-page')
  })
})
