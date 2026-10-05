import { describe, it, expect } from 'vitest'
import { sendSummary } from '@/lib/send-summary'

describe('sendSummary', () => {
  it('names the first contact with the number of sends', () => {
    expect(sendSummary(12, ['  Finance Committee ', 'Someone'])).toBe('Finance Committee: 12 sends')
  })

  it('falls back to the count alone when there are no contacts', () => {
    expect(sendSummary(3, [])).toBe('3 sends')
    expect(sendSummary(3, ['   '])).toBe('3 sends')
  })

  it('caps the figure above 1000 and keeps the exact figure at 1000', () => {
    expect(sendSummary(1000, ['A'])).toBe('A: 1000 sends')
    expect(sendSummary(1001, ['A'])).toBe('A and others: 1000+ sends')
    expect(sendSummary(5000, [])).toBe('1000+ sends')
  })
})
