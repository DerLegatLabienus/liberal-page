import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import HeroSection from '@/components/sections/HeroSection'

describe('HeroSection', () => {
  it('shows join, tracker, and constitution CTAs together', () => {
    render(
      <MemoryRouter>
        <HeroSection onOpenDrawer={() => {}} trackerEnabled />
      </MemoryRouter>,
    )

    expect(screen.getByRole('link', { name: /הצטרפו לליברלים בליכוד/ })).toHaveAttribute('href', '#join')
    expect(screen.getByRole('button', { name: /מעקב כנסת/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /חוקת הליכוד/ })).toHaveAttribute('href', '/constitution')
  })
})
