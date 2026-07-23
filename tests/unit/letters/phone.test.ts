import { describe, it, expect } from 'vitest'
import { normalizePhone, phoneForWhatsapp } from '@/lib/phone'

describe('normalizePhone', () => {
  it('Israeli local mobile 05X → +9725X', () => {
    expect(normalizePhone('052-123-4567')).toBe('+972521234567')
    expect(normalizePhone('0521234567')).toBe('+972521234567')
  })
  it('Israeli local landline 0X → +972X', () => {
    expect(normalizePhone('02-123-4567')).toBe('+97221234567')
  })
  it('already-international +972 / 972 preserved', () => {
    expect(normalizePhone('+972 52 123 4567')).toBe('+972521234567')
    expect(normalizePhone('972521234567')).toBe('+972521234567')
  })
  it('rejects garbage', () => {
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone('123')).toBeNull()
    expect(normalizePhone('')).toBeNull()
  })
})

describe('phoneForWhatsapp', () => {
  it('strips the leading +', () => {
    expect(phoneForWhatsapp('+972521234567')).toBe('972521234567')
  })
})
