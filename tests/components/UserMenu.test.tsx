import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { MemoryRouter, Routes, Route } from 'react-router-dom'

vi.mock('@/lib/api-client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api-client')>()
  return { ...actual, api: { auth: { updateMe: vi.fn() } } }
})

import { api } from '@/lib/api-client'
import type { AuthUser } from '@/lib/api-client'
import { ToastProvider } from '@/contexts/ToastContext'
import UserMenu from '@/components/layout/UserMenu'

const USER: AuthUser = { id: 1, email: 'a@x.com', name: 'אביב', role: 'member', emailAlerts: true }

function renderMenu(overrides: Partial<{ user: AuthUser; onSignOut: () => void; onUpdateUser: (p: Partial<AuthUser>) => void }> = {}) {
  const onSignOut = overrides.onSignOut ?? vi.fn()
  const onUpdateUser = overrides.onUpdateUser ?? vi.fn()
  render(
    // UserMenu's admin item uses useNavigate — needs a Router. The /admin route lets us assert nav.
    <MemoryRouter initialEntries={['/']}>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<UserMenu user={overrides.user ?? USER} onSignOut={onSignOut} onUpdateUser={onUpdateUser} />} />
          <Route path="/admin" element={<div>ADMIN ROUTE</div>} />
        </Routes>
      </ToastProvider>
    </MemoryRouter>,
  )
  return { onSignOut, onUpdateUser }
}

const openMenu = () => userEvent.click(screen.getByRole('button', { name: /תפריט משתמש/ }))

describe('UserMenu', () => {
  beforeEach(() => vi.clearAllMocks())

  it('opens on trigger click and closes on Escape', async () => {
    renderMenu()
    expect(screen.queryByRole('checkbox', { name: /התראות/ })).toBeNull()
    await openMenu()
    expect(screen.getByRole('checkbox', { name: /התראות/ })).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('checkbox', { name: /התראות/ })).toBeNull()
  })

  it('saves a new display name via updateMe and propagates it', async () => {
    vi.mocked(api.auth.updateMe).mockResolvedValue({ user: { ...USER, name: 'אביב חדש' } })
    const { onUpdateUser } = renderMenu()
    await openMenu()
    const input = screen.getByLabelText(/שם תצוגה/)
    await userEvent.clear(input)
    await userEvent.type(input, 'אביב חדש')
    await userEvent.click(screen.getByRole('button', { name: /שמירת שם/ }))
    expect(api.auth.updateMe).toHaveBeenCalledWith({ name: 'אביב חדש' })
    expect(onUpdateUser).toHaveBeenCalledWith({ name: 'אביב חדש' })
  })

  it('does not save when the name is unchanged (Save disabled)', async () => {
    renderMenu()
    await openMenu()
    expect(screen.getByRole('button', { name: /שמירת שם/ })).toBeDisabled()
    expect(api.auth.updateMe).not.toHaveBeenCalled()
  })

  it('toggles email alerts via updateMe', async () => {
    vi.mocked(api.auth.updateMe).mockResolvedValue({ user: { ...USER, emailAlerts: false } })
    renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('checkbox', { name: /התראות/ }))
    expect(api.auth.updateMe).toHaveBeenCalledWith({ emailAlerts: false })
  })

  it('signs out from the menu', async () => {
    const { onSignOut } = renderMenu()
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /התנתק/ }))
    expect(onSignOut).toHaveBeenCalled()
  })

  it('shows no admin item for a member', async () => {
    renderMenu()
    await openMenu()
    expect(screen.queryByRole('menuitem', { name: /ניהול/ })).toBeNull()
  })

  it('navigates an admin to /admin from the menu', async () => {
    renderMenu({ user: { ...USER, role: 'admin' } })
    await openMenu()
    await userEvent.click(screen.getByRole('menuitem', { name: /ניהול/ }))
    expect(screen.getByText('ADMIN ROUTE')).toBeInTheDocument()
  })
})
