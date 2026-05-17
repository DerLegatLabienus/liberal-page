import { describe, it, expect, beforeEach } from 'vitest'
// detectInitialLanguage reads location.search at call time — static import is fine
import { detectInitialLanguage } from '@/i18n'

describe('detectInitialLanguage', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.replaceState(null, '', '/')
  })

  it('returns he by default', () => {
    expect(detectInitialLanguage()).toBe('he')
  })

  it('returns en when ?lang=en is in URL', () => {
    window.history.replaceState(null, '', '/?lang=en')
    expect(detectInitialLanguage()).toBe('en')
  })

  it('returns he when ?lang=he is in URL', () => {
    window.history.replaceState(null, '', '/?lang=he')
    expect(detectInitialLanguage()).toBe('he')
  })

  it('falls back to localStorage when no URL param', () => {
    localStorage.setItem('lang', 'en')
    expect(detectInitialLanguage()).toBe('en')
  })

  it('URL param takes priority over localStorage', () => {
    localStorage.setItem('lang', 'en')
    window.history.replaceState(null, '', '/?lang=he')
    expect(detectInitialLanguage()).toBe('he')
  })

  it('ignores invalid ?lang= values', () => {
    window.history.replaceState(null, '', '/?lang=fr')
    expect(detectInitialLanguage()).toBe('he')
  })
})
