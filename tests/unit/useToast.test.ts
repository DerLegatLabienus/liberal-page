import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { useToast, useToastOptional } from '@/hooks/useToast'

describe('useToast / useToastOptional', () => {
  afterEach(() => vi.restoreAllMocks())

  it('useToast throws outside a provider', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useToast())).toThrow('useToast must be used within ToastProvider')
  })

  it('useToastOptional returns null outside a provider', () => {
    const { result } = renderHook(() => useToastOptional())
    expect(result.current).toBeNull()
  })
})
