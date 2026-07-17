import { describe, it, expect } from 'vitest'
import { analyzeSms } from '@/lib/sms-segments'

describe('analyzeSms', () => {
  it('empty string is one empty GSM-7 segment', () => {
    const r = analyzeSms('')
    expect(r).toMatchObject({ encoding: 'gsm7', units: 0, segments: 1, perSegment: 160, remaining: 160 })
  })

  it('plain ASCII uses GSM-7 at 160/segment', () => {
    expect(analyzeSms('a'.repeat(160))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 })
    expect(analyzeSms('a'.repeat(161))).toMatchObject({ encoding: 'gsm7', segments: 2, perSegment: 153 })
  })

  it('GSM-7 extended chars ({ } [ ] ~ | ^ \\ € ) count as two units', () => {
    // 80 '€' = 160 units = still one segment (boundary), 81 tips into two
    expect(analyzeSms('€'.repeat(80))).toMatchObject({ encoding: 'gsm7', units: 160, segments: 1 })
    expect(analyzeSms('€'.repeat(81))).toMatchObject({ encoding: 'gsm7', units: 162, segments: 2 })
  })

  it('any Hebrew char forces UCS-2 at 70/segment (67 multipart)', () => {
    expect(analyzeSms('ש'.repeat(70))).toMatchObject({ encoding: 'ucs2', units: 70, segments: 1, perSegment: 70 })
    expect(analyzeSms('ש'.repeat(71))).toMatchObject({ encoding: 'ucs2', units: 71, segments: 2, perSegment: 67 })
  })

  it('mixed Hebrew + Latin still UCS-2 (one non-GSM char is enough)', () => {
    expect(analyzeSms('hello שלום').encoding).toBe('ucs2')
  })
})
