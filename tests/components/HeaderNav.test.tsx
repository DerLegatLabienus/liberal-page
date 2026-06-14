import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), signOut: vi.fn() }),
  useAuthOptional: () => null,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import Header from '@/components/layout/Header'

const props = { hasNewParliamentData: false, onOpenDrawer: () => {}, trackerEnabled: false }

describe('Header cross-route navigation', () => {
  it('logo links to the homepage', () => {
    render(
      <MemoryRouter initialEntries={['/constitution']}>
        <Header {...props} />
      </MemoryRouter>,
    )
    const homeLink = screen.getAllByRole('link').find((l) => l.getAttribute('href') === '/')
    expect(homeLink).toBeTruthy()
  })

  it('nav links point back to a homepage section when off the homepage', () => {
    render(
      <MemoryRouter initialEntries={['/constitution']}>
        <Header {...props} />
      </MemoryRouter>,
    )
    const href = screen.getByText('אודות').getAttribute('href')
    expect(href).toContain('#about')
    expect(href).not.toBe('#about') // prefixed back to home, not a bare in-page hash
  })

  it('nav links are in-page hashes on the homepage', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <Header {...props} />
      </MemoryRouter>,
    )
    expect(screen.getByText('אודות').getAttribute('href')).toBe('#about')
  })
})
