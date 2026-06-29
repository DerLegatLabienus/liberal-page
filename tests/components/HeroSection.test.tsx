import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import HeroSection from '@/components/sections/HeroSection'

describe('HeroSection', () => {
  it('leads with join and keeps constitution as a secondary link, with no tracker CTA', () => {
    render(
      <MemoryRouter>
        <HeroSection />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /הצטרפו לליברלים בליכוד/ })).toHaveAttribute('href', '#join')
    expect(screen.getByRole('link', { name: /חוקת הליכוד/ })).toHaveAttribute('href', '/constitution')
    // The tracker CTA was removed from the hero (it still lives in the header).
    expect(screen.queryByRole('button', { name: /מעקב כנסת/ })).not.toBeInTheDocument()
  })
})
