import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import Header from '@/components/layout/Header'

describe('Header constitution link', () => {
  it('renders a link to /constitution', () => {
    render(
      <MemoryRouter>
        <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      </MemoryRouter>,
    )
    const links = screen.getAllByRole('link', { name: /חוקת/i })
    expect(links.length).toBeGreaterThan(0)
    expect(links[0]).toHaveAttribute('href', '/constitution')
  })
})
