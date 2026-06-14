import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: null, loading: false, signIn: vi.fn(), signOut: vi.fn() }),
  useAuthOptional: () => null,
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
}))

import Header from '@/components/layout/Header'

const renderHeader = (props: { hasNewParliamentData: boolean; onOpenDrawer: () => void; trackerEnabled: boolean }) =>
  render(<MemoryRouter><Header {...props} /></MemoryRouter>)

describe('Header — language toggle URL sync', () => {
  beforeEach(() => {
    vi.spyOn(history, 'replaceState')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('calls history.replaceState with ?lang=en when toggling from Hebrew', async () => {
    const user = userEvent.setup()
    renderHeader({ hasNewParliamentData: false, onOpenDrawer: () => {}, trackerEnabled: true })
    await user.click(screen.getByRole('button', { name: /EN/i }))
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '?lang=en')
  })
})

describe('Header — trackerEnabled prop', () => {
  it('tracker button is enabled when trackerEnabled=true', () => {
    renderHeader({ hasNewParliamentData: false, onOpenDrawer: () => {}, trackerEnabled: true })
    const btn = screen.getAllByRole('button').find(b => b.textContent?.includes('מעקב כנסת'))
    expect(btn).not.toBeDisabled()
  })

  it('tracker button is disabled when trackerEnabled=false', () => {
    renderHeader({ hasNewParliamentData: false, onOpenDrawer: () => {}, trackerEnabled: false })
    const btn = screen.getAllByRole('button').find(b => b.textContent?.includes('מעקב כנסת'))
    expect(btn).toBeDisabled()
  })

  it('disabled tracker button has tooltip text', () => {
    renderHeader({ hasNewParliamentData: false, onOpenDrawer: () => {}, trackerEnabled: false })
    const btn = screen.getAllByRole('button').find(b => b.textContent?.includes('מעקב כנסת'))
    expect(btn).toHaveAttribute('title', 'Available in Hebrew')
  })
})
