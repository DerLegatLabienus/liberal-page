import { render, screen, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ToastProvider, useToast } from '@/contexts/ToastContext'

function Trigger() {
  const { toast } = useToast()
  return <button onClick={() => toast('nope, not invited', 'error')}>go</button>
}

describe('ToastProvider', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('shows a toast message with alert role, then auto-dismisses', () => {
    render(<ToastProvider><Trigger /></ToastProvider>)
    expect(screen.queryByRole('alert')).toBeNull()

    act(() => { screen.getByText('go').click() })
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('nope, not invited')
    expect(alert.style.background).toBe('#dc2626') // error red

    act(() => { vi.advanceTimersByTime(5000) })
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
