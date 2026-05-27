import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect } from 'vitest'
import Header from '@/components/layout/Header'

describe('Header constitution link', () => {
  it('does not render a /constitution link (CTA lives in the hero)', () => {
    render(
      <MemoryRouter>
        <Header hasNewParliamentData={false} onOpenDrawer={() => {}} trackerEnabled={false} />
      </MemoryRouter>,
    )
    const links = screen.queryAllByRole('link', { name: /חוקת/i })
    const constitutionLink = links.find((l) => l.getAttribute('href') === '/constitution')
    expect(constitutionLink).toBeFalsy()
  })
})
