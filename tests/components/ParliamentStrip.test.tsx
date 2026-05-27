import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi } from 'vitest'
import ParliamentStrip from '@/components/sections/ParliamentStrip'

describe('ParliamentStrip', () => {
  it('renders a link to the constitution in the header', () => {
    render(
      <MemoryRouter>
        <ParliamentStrip bills={[]} committees={[]} onOpenDrawer={vi.fn()} />
      </MemoryRouter>,
    )
    const link = screen.getByRole('link', { name: /חוקת/i })
    expect(link).toHaveAttribute('href', '/constitution')
  })
})
