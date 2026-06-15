import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import ErrorBoundary from '@/components/ErrorBoundary'

function Boom(): never { throw new Error('boom') }

describe('ErrorBoundary', () => {
  it('renders children when nothing throws', () => {
    render(<ErrorBoundary><div>safe content</div></ErrorBoundary>)
    expect(screen.getByText('safe content')).toBeInTheDocument()
  })

  it('renders a recoverable fallback when a child throws', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByText('אירעה שגיאה בלתי צפויה')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'רענון הדף' })).toBeInTheDocument()
    spy.mockRestore()
  })
})
