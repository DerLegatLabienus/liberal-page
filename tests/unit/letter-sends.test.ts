import { describe, it, expect } from 'vitest'
import { splitSends } from '@/lib/letter-sends'

describe('splitSends', () => {
  it('sums member vs public buckets', () => {
    expect(splitSends({ mailto: 3, copy: 2, public_mailto: 5, public_gmail: 1, public_copy: 4 }))
      .toEqual({ member: 5, public: 10, total: 15 })
  })
  it('handles missing buckets', () => {
    expect(splitSends({ public_mailto: 2 })).toEqual({ member: 0, public: 2, total: 2 })
    expect(splitSends({})).toEqual({ member: 0, public: 0, total: 0 })
  })
})
