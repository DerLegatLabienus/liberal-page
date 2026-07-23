import { describe, it, expect } from 'vitest'
import { toVisualOrder } from '../../../server/services/bidi'

describe('toVisualOrder', () => {
  it('reverses pure Hebrew to visual order', () => {
    expect(toVisualOrder('שלום')).toBe('םולש')
  })
  it('flips Hebrew but keeps LTR digit runs intact', () => {
    expect(toVisualOrder('חוק 123 לישראל')).toBe('לארשיל 123 קוח')
  })
  it('returns an empty string unchanged', () => {
    expect(toVisualOrder('')).toBe('')
  })
})
