import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'

const useAuthMock = vi.fn()
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => useAuthMock() }))

import LettersModeTabs from '@/components/letters/LettersModeTabs'

function renderAt(path: string) {
  render(<MemoryRouter initialEntries={[path]}><LettersModeTabs /></MemoryRouter>)
}

describe('LettersModeTabs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders nothing for a member', () => {
    useAuthMock.mockReturnValue({ user: { id: 1, role: 'member' } })
    const { container } = render(<MemoryRouter><LettersModeTabs /></MemoryRouter>)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows View + Manage links for a manager, highlighting the current route', () => {
    useAuthMock.mockReturnValue({ user: { id: 1, role: 'admin' } })
    renderAt('/letters')
    const view = screen.getByRole('link', { name: 'צפייה' })
    const manage = screen.getByRole('link', { name: 'ניהול' })
    expect(view).toHaveAttribute('href', '/letters')
    expect(manage).toHaveAttribute('href', '/letters/manage')
    // active tab on /letters is View
    expect(view.className).toMatch(/border-primary/)
    expect(manage.className).not.toMatch(/border-primary/)
  })

  it('highlights Manage on /letters/manage', () => {
    useAuthMock.mockReturnValue({ user: { id: 1, role: 'admin' } })
    renderAt('/letters/manage')
    expect(screen.getByRole('link', { name: 'ניהול' }).className).toMatch(/border-primary/)
    expect(screen.getByRole('link', { name: 'צפייה' }).className).not.toMatch(/border-primary/)
  })
})
