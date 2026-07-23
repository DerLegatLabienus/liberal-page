import { vi, describe, it, expect, beforeEach } from 'vitest'

const lookupMock = vi.fn()
vi.mock('dns/promises', () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }))

import { assertAllowedDocumentUrl, UrlNotAllowedError } from '../../../server/services/url-guard'

// Default: resolve to a real-world public address.
beforeEach(() => {
  lookupMock.mockReset()
  lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }])
})

describe('assertAllowedDocumentUrl', () => {
  it('allows an https knesset.gov.il URL resolving to a public IP', async () => {
    await expect(assertAllowedDocumentUrl('https://main.knesset.gov.il/x.pdf')).resolves.toBeInstanceOf(URL)
  })

  it('rejects a non-allowlisted host', async () => {
    await expect(assertAllowedDocumentUrl('https://evil.example/x.pdf')).rejects.toBeInstanceOf(UrlNotAllowedError)
  })

  it('rejects a look-alike host (suffix must be on a dot boundary)', async () => {
    await expect(assertAllowedDocumentUrl('https://knesset.gov.il.evil.com/x')).rejects.toBeInstanceOf(UrlNotAllowedError)
  })

  it('rejects non-http(s) schemes', async () => {
    await expect(assertAllowedDocumentUrl('file:///etc/passwd')).rejects.toBeInstanceOf(UrlNotAllowedError)
    await expect(assertAllowedDocumentUrl('ftp://main.knesset.gov.il/x')).rejects.toBeInstanceOf(UrlNotAllowedError)
  })

  // Even an allowlisted host is rejected if DNS points at an internal address (rebinding).
  it.each([
    ['loopback', '127.0.0.1'],
    ['private', '10.0.0.5'],
    ['private-172', '172.16.5.4'],
    ['link-local / metadata', '169.254.169.254'],
    ['carrier-grade NAT', '100.64.0.1'],
    ['IPv6 ULA', 'fc00::1'],
    ['IPv6 loopback', '::1'],
    ['IPv4-mapped loopback', '::ffff:127.0.0.1'],
    ['unspecified', '0.0.0.0'],
  ])('rejects allowlisted host resolving to %s (%s)', async (_label, addr) => {
    lookupMock.mockResolvedValue([{ address: addr, family: addr.includes(':') ? 6 : 4 }])
    await expect(assertAllowedDocumentUrl('https://main.knesset.gov.il/x.pdf')).rejects.toBeInstanceOf(UrlNotAllowedError)
  })

  it('rejects when ANY resolved address is internal (mixed records)', async () => {
    lookupMock.mockResolvedValue([{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.5', family: 4 }])
    await expect(assertAllowedDocumentUrl('https://main.knesset.gov.il/x.pdf')).rejects.toBeInstanceOf(UrlNotAllowedError)
  })
})
