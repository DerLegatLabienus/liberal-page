import { describe, it, expect } from 'vitest'
import { buildWhatsappUrl, buildSmsUrl } from '@/lib/letter-urls'

describe('buildWhatsappUrl', () => {
  it('uses wa.me with digits-only phone and encoded text', () => {
    expect(buildWhatsappUrl('+972521234567', 'שלום עולם')).toBe(
      'https://wa.me/972521234567?text=' + encodeURIComponent('שלום עולם'),
    )
  })
})

describe('buildSmsUrl', () => {
  it('uses the cross-platform sms:<phone>?&body= form with the + kept', () => {
    expect(buildSmsUrl('+972521234567', 'hi there')).toBe(
      'sms:+972521234567?&body=' + encodeURIComponent('hi there'),
    )
  })
})
