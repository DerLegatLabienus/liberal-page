import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect } from 'vitest'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), signOut: vi.fn() }),
  useAuthOptional: () => null,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

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
