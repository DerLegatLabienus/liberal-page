import { renderHook } from '@testing-library/react'
import { useDirection } from '@/hooks/useDirection'

describe('useDirection', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('dir')
  })

  it('returns rtl when document dir is rtl', () => {
    document.documentElement.setAttribute('dir', 'rtl')
    const { result } = renderHook(() => useDirection())
    expect(result.current).toBe('rtl')
  })

  it('returns ltr when document dir is ltr', () => {
    document.documentElement.setAttribute('dir', 'ltr')
    const { result } = renderHook(() => useDirection())
    expect(result.current).toBe('ltr')
  })

  it('defaults to rtl when no dir attribute is set', () => {
    const { result } = renderHook(() => useDirection())
    expect(result.current).toBe('rtl')
  })
})
