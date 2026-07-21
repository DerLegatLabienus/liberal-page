import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Skeleton } from '@/components/ui/skeleton'
import PageSkeleton from '@/components/PageSkeleton'
import BackToHome from '@/components/BackToHome'

describe('loading + access primitives', () => {
  it('Skeleton is a decorative pulsing block', () => {
    const { container } = render(<Skeleton className="h-4 w-10" />)
    const el = container.firstElementChild!
    expect(el).toHaveAttribute('aria-hidden')
    expect(el.className).toMatch(/animate-pulse/)
  })

  it('PageSkeleton announces loading to screen readers', () => {
    render(<PageSkeleton />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('BackToHome links to / with a default and a custom label', () => {
    const { rerender } = render(<MemoryRouter><BackToHome /></MemoryRouter>)
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/')

    rerender(<MemoryRouter><BackToHome label="חזרה לדף הבית" /></MemoryRouter>)
    expect(screen.getByRole('link', { name: 'חזרה לדף הבית' })).toHaveAttribute('href', '/')
  })
})
