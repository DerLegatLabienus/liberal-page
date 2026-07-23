import { describe, it, expect } from 'vitest'
import { redactEmail } from '../../../server/services/email-redaction'

describe('redactEmail', () => {
  it('keeps the local part and drops the domain', () => {
    expect(redactEmail('avivavitan63@gmail.com')).toBe('avivavitan63@…')
  })
  it('returns the ellipsis when there is no @', () => {
    expect(redactEmail('notanemail')).toBe('…')
  })
  it('returns the ellipsis for an empty string', () => {
    expect(redactEmail('')).toBe('…')
  })
})
